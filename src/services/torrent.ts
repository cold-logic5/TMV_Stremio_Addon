import dgram from 'dgram';
import crypto from 'crypto';
import url from 'url';

export interface TorrentHealth {
  seeds: number;
  leechers: number;
}

// Well-known public trackers that reliably support UDP scrape
const DEFAULT_TRACKERS = [
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'http://91.217.91.21:3218/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'http://pow7.com:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.tvunderground.org.ru:3218/announce',
  'udp://tracker.yoshi210.com:6969/announce',
  'http://tracker2.itzmx.com:6961/announce',
  'udp://151.80.120.114:2710/announce',
  'udp://62.138.0.158:6969/announce',
  'udp://9.rarbg.com:2790/announce',
  'udp://9.rarbg.me:2720/announce',
  'udp://9.rarbg.to:2740/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'http://tracker.yoshi210.com:6969/announce',
  'udp://tracker.pirateparty.gr:6969/announce',
  'udp://open.demonii.si:1337/announce',
  'udp://denis.stalker.upeer.me:6969/announce',
  'http://t.nyaatracker.com:80/announce'
];

/**
 * Extract the 20-byte info hash from a magnet URI.
 */
function extractInfoHash(magnetUrl: string): Buffer | null {
  const match = magnetUrl.match(/btih:([a-fA-F0-9]{40})/);
  if (match && match[1]) {
    return Buffer.from(match[1], 'hex');
  }
  // Handle base32 encoded info hashes
  const b32Match = magnetUrl.match(/btih:([A-Z2-7]{32})/i);
  if (b32Match && b32Match[1]) {
    return base32ToBuffer(b32Match[1]);
  }
  return null;
}

/**
 * Decode base32 string to Buffer (for magnet links with base32 info hashes).
 */
function base32ToBuffer(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of str.toUpperCase()) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Extract tracker URLs from a magnet link.
 */
function extractTrackers(magnetUrl: string): string[] {
  const trackers: string[] = [];
  const trMatches = magnetUrl.matchAll(/tr=([^&]+)/gi);
  for (const m of trMatches) {
    if (m[1]) {
      try {
        trackers.push(decodeURIComponent(m[1]));
      } catch {
        // skip malformed tracker URLs
      }
    }
  }
  return trackers;
}

/**
 * Scrape a single UDP tracker for seeder/leecher counts.
 * Implements the UDP Tracker Protocol (BEP 15).
 */
function scrapeUdpTracker(
  trackerUrl: string,
  infoHash: Buffer,
  timeout: number
): Promise<TorrentHealth | null> {
  return new Promise((resolve) => {
    try {
      const parsed = new url.URL(trackerUrl);
      const host = parsed.hostname;
      const port = parseInt(parsed.port, 10);

      if (!host || !port || isNaN(port)) {
        return resolve(null);
      }

      const socket = dgram.createSocket('udp4');
      const transactionId = crypto.randomBytes(4);

      const timer = setTimeout(() => {
        socket.close();
        resolve(null);
      }, timeout);

      socket.on('error', () => {
        clearTimeout(timer);
        socket.close();
        resolve(null);
      });

      socket.on('message', (msg) => {
        try {
          const action = msg.readUInt32BE(0);

          if (action === 0 && msg.length >= 16) {
            // Connect response
            const connectionId = msg.subarray(8, 16);

            // Build scrape request
            const scrapeRequest = Buffer.alloc(36);
            connectionId.copy(scrapeRequest, 0);     // connection_id (8 bytes)
            scrapeRequest.writeUInt32BE(2, 8);        // action: scrape (4 bytes)
            transactionId.copy(scrapeRequest, 12);    // transaction_id (4 bytes)
            infoHash.copy(scrapeRequest, 16);         // info_hash (20 bytes)

            socket.send(scrapeRequest, 0, 36, port, host);

          } else if (action === 2 && msg.length >= 20) {
            // Scrape response
            clearTimeout(timer);
            const seeds = msg.readUInt32BE(8);
            // const downloaded = msg.readUInt32BE(12); // completed downloads (not needed)
            const leechers = msg.readUInt32BE(16);

            socket.close();
            resolve({ seeds, leechers });

          } else {
            // Unexpected response
            clearTimeout(timer);
            socket.close();
            resolve(null);
          }
        } catch {
          clearTimeout(timer);
          socket.close();
          resolve(null);
        }
      });

      // Build connect request (BEP 15)
      const connectRequest = Buffer.alloc(16);
      // Protocol ID (magic constant)
      connectRequest.writeUInt32BE(0x417, 0);
      connectRequest.writeUInt32BE(0x27101980, 4);
      // Action: connect
      connectRequest.writeUInt32BE(0, 8);
      // Transaction ID
      transactionId.copy(connectRequest, 12);

      socket.send(connectRequest, 0, 16, port, host);

    } catch {
      resolve(null);
    }
  });
}

function getScrapeUrl(trackerUrl: string, infoHash: Buffer): string | null {
  try {
    const urlObj = new url.URL(trackerUrl);
    const match = urlObj.pathname.lastIndexOf('announce');
    if (match === -1) return null;

    urlObj.pathname = urlObj.pathname.substring(0, match) + 'scrape' + urlObj.pathname.substring(match + 8);
    
    let result = '';
    for (let i = 0; i < infoHash.length; i++) {
        result += '%' + infoHash[i].toString(16).padStart(2, '0');
    }
    
    return `${urlObj.toString()}?info_hash=${result}`;
  } catch {
    return null;
  }
}

async function scrapeHttpTracker(
  trackerUrl: string,
  infoHash: Buffer,
  timeout: number
): Promise<TorrentHealth | null> {
  const scrapeUrl = getScrapeUrl(trackerUrl, infoHash);
  if (!scrapeUrl) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(scrapeUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const data = Buffer.from(buffer).toString('ascii');

    const completeMatch = data.match(/8:completei(\d+)e/);
    const incompleteMatch = data.match(/10:incompletei(\d+)e/);

    if (completeMatch !== null || incompleteMatch !== null) {
      return {
        seeds: completeMatch ? parseInt(completeMatch[1], 10) : 0,
        leechers: incompleteMatch ? parseInt(incompleteMatch[1], 10) : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches the number of seeders and leechers for a given magnet link.
 * Tries multiple trackers and returns the best (highest seeder count) result.
 */
export async function getTorrentHealth(
  magnetUrl: string,
  timeout = 3000
): Promise<TorrentHealth | null> {
  const infoHash = extractInfoHash(magnetUrl);
  if (!infoHash || infoHash.length !== 20) {
    return null;
  }

  // Gather trackers from the magnet link + defaults
  const magnetTrackers = extractTrackers(magnetUrl);
  // Deduplicate and filter for both udp and http
  const validTrackers = [...new Set([...magnetTrackers, ...DEFAULT_TRACKERS])]
    .filter(t => t.startsWith('udp://') || t.startsWith('http://'))
    .slice(0, 10); // Limit to 10 trackers for better coverage

  if (validTrackers.length === 0) {
    return { seeds: 0, leechers: 0 };
  }

  // Query all trackers in parallel, take the best result
  const results = await Promise.all(
    validTrackers.map(tracker => {
      if (tracker.startsWith('udp://')) {
        return scrapeUdpTracker(tracker, infoHash, timeout);
      } else {
        return scrapeHttpTracker(tracker, infoHash, timeout);
      }
    })
  );

  let best: TorrentHealth = { seeds: 0, leechers: 0 };
  for (const result of results) {
    if (result && result.seeds > best.seeds) {
      best = result;
    }
  }

  return best;
}

/**
 * Fetches health for a batch of magnet links with a concurrency limit.
 */
export async function getBatchTorrentHealth<T>(
  items: T[],
  getMagnet: (item: T) => string | undefined,
  setHealth: (item: T, health: TorrentHealth) => void,
  concurrency = 5
): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (item) => {
        const magnet = getMagnet(item);
        if (magnet) {
          const healthData = await getTorrentHealth(magnet);
          if (healthData) {
            setHealth(item, healthData);
          }
        }
      })
    );
  }
}
