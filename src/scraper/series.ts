import axios from 'axios';
import { load as loadHtml } from 'cheerio';
import { ScrapedQuality } from '../models/movie';
import { ScrapedSeries, ScrapedEpisode } from '../models/series';
import { config } from '../services/config';

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
  'https://www.1tamilmv.capital',
  'https://www.1tamilmv.fi',
  'https://www.1tamilmv.observer',
  'https://www.1tamilmv.meme',
  'https://www.1tamilmv.rocks',
];

interface TopicConfig {
  topicId: string;
  id: string;
  name: string;
  genre: 'Tamil' | 'Telugu';
  imdbId: string;
  slug: string;
}

export const BIGG_BOSS_TOPICS: TopicConfig[] = [
  {
    topicId: '199652',
    id: 'tamilmv-series-bigg-boss-tamil',
    name: 'Bigg Boss Tamil',
    genre: 'Tamil',
    imdbId: 'tt7084920',
    slug: 'bigg-boss-tamil',
  },
  {
    topicId: '199653',
    id: 'tamilmv-series-bigg-boss-telugu',
    name: 'Bigg Boss Telugu',
    genre: 'Telugu',
    imdbId: 'tt7805494',
    slug: 'bigg-boss-telugu',
  },
];

const QUALITY_REGEXES = [
  { quality: '2160p', pattern: /2160p|4k|uhd/i },
  { quality: '1080p', pattern: /1080p/i },
  { quality: '720p', pattern: /720p/i },
  { quality: '480p', pattern: /480p|sd/i },
];

function guessQuality(text: string): string {
  for (const { quality, pattern } of QUALITY_REGEXES) {
    if (pattern.test(text)) return quality;
  }
  return 'unknown';
}

function extractStreamDetails(
  text: string,
  baseQuality: string
): { quality: string; size?: string } {
  const details = [baseQuality];

  if (/hevc|x265/i.test(text)) {
    details.push('HEVC');
  } else if (/avc|x264/i.test(text)) {
    details.push('AVC');
  }

  if (/multi[\s-]*audio/i.test(text)) {
    details.push('Multi-Audio');
  } else if (/dual[\s-]*audio/i.test(text)) {
    details.push('Dual-Audio');
  }

  let size: string | undefined;
  const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))/i);
  if (sizeMatch && sizeMatch[1]) {
    size = sizeMatch[1].replace(/\s+/g, '').toUpperCase();
  }

  return { quality: details.join(' ').trim(), size };
}

async function fetchTopicHtml(topicId: string, slug: string): Promise<{ html: string; pageUrl: string }> {
  const mirrors = Array.from(new Set(KNOWN_MIRRORS.map(m => m.replace(/\/+$/, ''))));

  let lastError: any = null;
  for (const mirror of mirrors) {
    const candidateUrls = [
      `${mirror}/index.php?/forums/topic/${topicId}-${slug}/`,
      `${mirror}/index.php?/forums/topic/${topicId}-x/`,
    ];

    for (const url of candidateUrls) {
      try {
        console.log(`[TamilMV-Series] Fetching topic ${topicId} from: ${url}`);
        const response = await axios.get(url, {
          headers: BROWSER_HEADERS,
          timeout: 15000,
          maxRedirects: 5,
        });

        const html = response.data as string;
        if (response.status === 200 && html && (html.includes('magnet:') || html.includes('ipsPagination') || html.includes('BIGG BOSS'))) {
          const finalUrl = response.request?.res?.responseUrl || url;
          console.log(`[TamilMV-Series] Successfully fetched topic ${topicId} from ${mirror} (Length: ${html.length})`);
          return { html, pageUrl: finalUrl };
        }
      } catch (err: any) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error(`Failed to fetch topic ${topicId} from all mirrors.`);
}

export async function scrapeBiggBossSeries(): Promise<ScrapedSeries[]> {
  const seriesResults: ScrapedSeries[] = [];

  for (const topic of BIGG_BOSS_TOPICS) {
    try {
      console.log(`[TamilMV-Series] Scraping ${topic.name} (Topic ${topic.topicId})...`);
      const { html, pageUrl } = await fetchTopicHtml(topic.topicId, topic.slug);
      const $ = loadHtml(html);

      const h1Title = $('h1').text().replace(/\s+/g, ' ').trim();
      console.log(`[TamilMV-Series] Topic Title: ${h1Title}`);

      const firstArticle = $('article').first();
      const episodeMap = new Map<string, ScrapedEpisode>();

      // Search all magnet links in the main post
      firstArticle.find('a[href^="magnet:"]').each((_, el) => {
        const link = $(el);
        const href = link.attr('href');
        if (!href) return;

        const dnMatch = href.match(/dn=([^&]+)/);
        let textToScan = dnMatch && dnMatch[1] ? decodeURIComponent(dnMatch[1]) : '';
        if (!textToScan) {
          const prevText = link.prevAll('strong').first().text();
          textToScan = prevText || link.text();
        }

        // Extract Season (default to 10 if not present)
        const sMatch = textToScan.match(/\bS0*(\d+)\b/i);
        const season = sMatch && sMatch[1] ? parseInt(sMatch[1], 10) : 10;

        // Extract Episode number
        const epMatch = textToScan.match(/\bEP0*(\d+)\b/i);
        if (!epMatch || !epMatch[1]) return;
        const episode = parseInt(epMatch[1], 10);

        // Extract Day number if available
        const dayMatch = textToScan.match(/\bDAY\s*0*(\d+)\b/i);
        const day = dayMatch && dayMatch[1] ? parseInt(dayMatch[1], 10) : undefined;

        // Extract Quality and details
        const baseQuality = guessQuality(textToScan);
        const { quality, size } = extractStreamDetails(textToScan, baseQuality);

        const episodeKey = `${season}:${episode}`;
        if (!episodeMap.has(episodeKey)) {
          const dayLabel = day !== undefined ? ` (Day ${day})` : '';
          episodeMap.set(episodeKey, {
            id: episodeKey,
            season,
            episode,
            day,
            title: `Episode ${episode}${dayLabel}`,
            qualities: [],
            rawText: textToScan,
          });
        }

        const existingEp = episodeMap.get(episodeKey)!;
        if (!existingEp.qualities.some(q => q.url === href)) {
          existingEp.qualities.push({
            quality,
            size,
            type: 'magnet',
            url: href,
            languages: [topic.genre],
          });
        }
      });

      // Sort episodes ascending by episode number
      const sortedEpisodes = Array.from(episodeMap.values()).sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      });

      console.log(`[TamilMV-Series] ${topic.name} total scraped episodes: ${sortedEpisodes.length}`);
      const latestEp = sortedEpisodes[sortedEpisodes.length - 1];
      if (latestEp) {
        console.log(`[TamilMV-Series] ${topic.name} latest episode: S${latestEp.season} E${latestEp.episode}${latestEp.day !== undefined ? ` (Day ${latestEp.day})` : ''} with ${latestEp.qualities.length} streams.`);
      }

      seriesResults.push({
        id: topic.id,
        name: topic.name,
        genre: topic.genre,
        pageUrl,
        topicId: topic.topicId,
        episodes: sortedEpisodes,
        languages: [topic.genre],
        rawText: h1Title,
      });
    } catch (err: any) {
      console.error(`[TamilMV-Series] Error scraping ${topic.name}:`, err.message);
    }
  }

  return seriesResults;
}
