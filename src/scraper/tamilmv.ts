import axios from 'axios';
import { load as loadHtml } from 'cheerio';
import crypto from 'crypto';
import { ScrapedMovie, ScrapedQuality } from '../models/movie';
import { config } from '../services/config';

// Make sure your ScrapedQuality type allows 'unknown' if you are casting it
const QUALITY_REGEXES: { quality: ScrapedQuality['quality'] | string; pattern: RegExp }[] = [
  { quality: '2160p', pattern: /2160p|4k|uhd/i },
  { quality: '1080p', pattern: /1080p/i },
  { quality: '720p', pattern: /720p/i },
  { quality: '480p', pattern: /480p|sd/i },
];

const guessQuality = (text: string): ScrapedQuality['quality'] | string => {
  for (const { quality, pattern } of QUALITY_REGEXES) {
    if (pattern.test(text)) return quality;
  }
  return 'unknown';
};

const extractStreamDetails = (
  text: string,
  baseQuality: string
): { quality: string; size?: string } => {
  const details = [baseQuality];

  // 1. Extract Codec (HEVC/x265 is highly sought after for smaller file sizes)
  if (/hevc|x265/i.test(text)) {
    details.push('HEVC');
  } else if (/avc|x264/i.test(text)) {
    details.push('AVC');
  }

  // 2. Extract Audio details (Very common on TamilMV)
  if (/multi[\s-]*audio/i.test(text)) {
    details.push('Multi-Audio');
  } else if (/dual[\s-]*audio/i.test(text)) {
    details.push('Dual-Audio');
  }

  // 3. Extract File Size (e.g., 1.4GB, 700MB, 2.5 GB)
  let size: string | undefined;
  const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))/i);
  if (sizeMatch && sizeMatch[1]) {
    size = sizeMatch[1].replace(/\s+/g, '').toUpperCase();
  }

  return { quality: details.join(' ').trim(), size };
};

const parseTitleAndYear = (
  rawTitle: string,
): { titleGuess: string; yearGuess: number | undefined } => {
  const yearMatch = rawTitle.match(/\b(19|20)\d{2}\b/);
  const yearGuess = yearMatch ? parseInt(yearMatch[0], 10) : undefined;

  let titleGuess = rawTitle;

  // Clean up the title by taking everything before the year to drop trailing quality tags
  if (yearMatch && yearMatch.index) {
    titleGuess = rawTitle.substring(0, yearMatch.index);
  } else {
    // Fallback if no year: split by dash or bracket
    titleGuess = rawTitle.split(/-|\[/)[0] || rawTitle;
  }

  // Remove trailing parentheses, brackets, or extra spaces
  titleGuess = titleGuess.replace(/[\(\[\-]/g, '').replace(/\s+/g, ' ').trim();

  return { titleGuess, yearGuess };
};

const detectLanguages = (rawText: string): string[] => {
  const found: string[] = [];

  if (/Tamil/i.test(rawText)) found.push('Tamil');
  if (/Malayalam/i.test(rawText)) found.push('Malayalam');
  if (/Telugu/i.test(rawText)) found.push('Telugu');
  if (/Kannada|Kanada/i.test(rawText)) found.push('Kannada');
  if (/Hindi/i.test(rawText)) found.push('Hindi');

  // If there are multiple languages explicitly mentioned, or "Multi/Dual Audio", categorize as Multi-Lang
  if (/(multi|dual)[\s-]*audio/i.test(rawText)) {
    if (!found.includes('Multi-Lang')) found.push('Multi-Lang');
  }

  if (found.length > 1 && !found.includes('Multi-Lang')) {
    found.push('Multi-Lang');
  }

  return found;
};

// Use the URL in the hash to ensure different versions (Tamil/Telugu) of the same movie have unique IDs
const makeId = (rawTitle: string, url: string): string =>
  crypto.createHash('md5').update(`${rawTitle.toLowerCase()}-${url}`).digest('hex');

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'max-age=0',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

const KNOWN_MIRRORS = [
  config.tamilmvBaseUrl,
  'https://www.1tamilmv.fi',
  'https://www.1tamilmv.observer',
  'https://www.1tamilmv.meme',
];

let workingBaseUrl = config.tamilmvBaseUrl;

export async function fetchTamilMVHomepageHtml(): Promise<{ html: string; activeBaseUrl: string }> {
  // Deduplicate mirrors list
  const mirrors = Array.from(new Set(KNOWN_MIRRORS.map(m => m.replace(/\/+$/, ''))));

  let lastError: any = null;
  for (const mirror of mirrors) {
    try {
      console.log(`[TamilMV] Attempting to fetch homepage from: ${mirror}`);
      const response = await axios.get(mirror, {
        headers: BROWSER_HEADERS,
        timeout: 12000,
        maxRedirects: 5,
      });

      const html = response.data as string;
      if (response.status === 200 && html && html.includes('forums/topic/')) {
        console.log(`[TamilMV] Successfully fetched homepage from ${mirror} (Length: ${html.length})`);
        workingBaseUrl = mirror;
        return { html, activeBaseUrl: mirror };
      }
    } catch (err: any) {
      console.warn(`[TamilMV] Mirror ${mirror} failed (${err.response?.status || err.message}). Trying next mirror...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All TamilMV mirrors failed to respond.');
}

export function extractTopicIdentifier(url: string): string {
  const match = url.match(/\/topic\/(\d+)/i);
  if (match && match[1]) {
    return match[1];
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

export async function scrapeTamilMV(knownTopicIdentifiers?: Set<string>): Promise<ScrapedMovie[]> {
  const { html, activeBaseUrl } = await fetchTamilMVHomepageHtml();
  const movies: ScrapedMovie[] = [];
  let skippedCount = 0;

  // 1. Split the raw HTML into layout blocks. 
  // By splitting on <br>, <p>, <div>, etc. BEFORE parsing DOM, we prevent multiple movies 
  // inside the same tag from being merged into one giant string.
  const chunks = html.split(/<br\s*\/?>|<\/?p[^>]*>|<\/?div[^>]*>|<\/?tr[^>]*>|<\/?li[^>]*>/i);

  // eslint-disable-next-line no-console
  console.log('[TamilMV] Chunk count:', chunks.length);

  for (const chunk of chunks) {
    if (!chunk.includes('/index.php?/forums/topic/')) continue;

    const $chunk = loadHtml(chunk);

    // In rare cases a single line without breaks has multiple links, we process the first.
    // The previous split guarantees each movie is on its own line if formatted normally.
    const linkNode = $chunk('a[href*="/index.php?/forums/topic/"]').first();

    let pageUrl = linkNode.attr('href');
    if (!pageUrl) continue;

    // Ensure link is absolute using the active working mirror
    if (!pageUrl.startsWith('http')) {
      pageUrl = `${activeBaseUrl.replace(/\/+$/, '')}/${pageUrl.replace(/^\/+/, '')}`;
    }

    // Check if this topic was already scraped in existing database
    const topicId = extractTopicIdentifier(pageUrl);
    if (knownTopicIdentifiers && (knownTopicIdentifiers.has(topicId) || knownTopicIdentifiers.has(pageUrl))) {
      skippedCount++;
      continue;
    }

    // Since chunk is isolated, the text is exactly what belongs to this movie
    const rawText = $chunk.text().replace(/\s+/g, ' ').trim();

    if (rawText.length < 10) continue;

    if (/\bS\d{2}\b/i.test(rawText) ||
      /EP\s*\(\d+(?:\s*-\s*\d+)?\)/i.test(rawText) ||
      /Telegram/i.test(rawText)) {
      continue;
    }

    const { titleGuess, yearGuess } = parseTitleAndYear(rawText);
    if (!titleGuess) continue;

    const rawTitle = `${titleGuess} ${yearGuess ? `(${yearGuess})` : ''}`.trim();
    const id = makeId(rawTitle, pageUrl);

    if (!movies.find(m => m.pageUrl === pageUrl)) {
      movies.push({
        id,
        rawTitle,
        titleGuess,
        yearGuess,
        pageUrl,
        qualities: [],
        rawText,
        languages: detectLanguages(rawText),
      });
    }

    if (movies.length >= config.maxScrapeLimit) {
      console.log(`[TamilMV] Reached limit of ${config.maxScrapeLimit} movies, stopping scan.`);
      break;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[TamilMV] Skipped ${skippedCount} already-cached topics. Found ${movies.length} NEW movies to scrape.`);

  for (const movie of movies) {
    if (movie.pageUrl) {
      movie.qualities = await scrapeMoviePageForMagnets(movie.pageUrl);
      // Assign the movie's languages to its individual streams
      movie.qualities.forEach(q => q.languages = movie.languages);
      // eslint-disable-next-line no-console
      console.log(`[TamilMV] Magnets for movie: ${movie.titleGuess} -> ${movie.qualities.length}`);
    }
  }

  // Filter out any entries that ended up having no magnets
  return movies.filter(m => m.qualities && m.qualities.length > 0);
}

export async function scrapeMoviePageForMagnets(targetUrl: string): Promise<ScrapedQuality[]> {
  const tryFetch = async (fetchUrl: string) => {
    return await axios.get(fetchUrl, {
      headers: BROWSER_HEADERS,
      timeout: 10000,
      maxRedirects: 5,
    });
  };

  try {
    let response: any;
    try {
      response = await tryFetch(targetUrl);
    } catch (err: any) {
      // If 403 or network error, attempt to rewrite domain to workingBaseUrl
      const urlObj = new URL(targetUrl);
      const activeObj = new URL(workingBaseUrl);
      if (urlObj.hostname !== activeObj.hostname) {
        urlObj.hostname = activeObj.hostname;
        urlObj.protocol = activeObj.protocol;
        urlObj.port = activeObj.port;
        const fallbackUrl = urlObj.toString();
        console.log(`[TamilMV] Retrying movie page with active mirror: ${fallbackUrl}`);
        response = await tryFetch(fallbackUrl);
      } else {
        throw err;
      }
    }

    const $ = loadHtml(response.data);
    const results: ScrapedQuality[] = [];

    // Select all magnet links
    $('a[href^="magnet:"]').each((_, el) => {
      const link = $(el);
      const href = link.attr('href');
      if (!href) return;

      // STRATEGY 1: Extract quality from the Magnet "dn" (Display Name) parameter
      const dnMatch = href.match(/dn=([^&]+)/);
      let textToScan =
        dnMatch && dnMatch[1] !== undefined ? decodeURIComponent(dnMatch[1]) : '';

      // STRATEGY 2: Fallback to the text of the element immediately before the magnet link
      if (!textToScan) {
        const prevText = link.prevAll('strong').first().text();
        textToScan = prevText || link.text();
      }
      const baseQuality = guessQuality(textToScan) as string;
      const { quality, size } = extractStreamDetails(textToScan, baseQuality);

      results.push({
        quality,
        size,
        type: 'magnet',
        url: href,
      });
    });

    console.log('[TamilMV] Found magnet links on page:', targetUrl, 'count:', results.length);
    return results;
  } catch (error: any) {
    console.error(`[TamilMV] Error fetching movie page (${targetUrl}):`, error.response?.status || error.message);
    return [];
  }
}