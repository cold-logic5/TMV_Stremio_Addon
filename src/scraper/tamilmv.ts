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

const extractStreamDetails = (text: string, baseQuality: string): string => {
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
  const sizeMatch = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB))/i);
  if (sizeMatch && sizeMatch[1]) {
    // Add size in parentheses at the end
    details.push(`(${sizeMatch[1].replace(/\s+/g, '').toUpperCase()})`);
  }

  return details.join(' ').trim();
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

const makeId = (rawTitle: string): string =>
  crypto.createHash('md5').update(rawTitle.toLowerCase()).digest('hex');

export async function fetchTamilMVHomepageHtml(): Promise<string> {
  // eslint-disable-next-line no-console
  console.log('[TamilMV] Fetching homepage:', config.tamilmvBaseUrl);

  const response = await axios.get(config.tamilmvBaseUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
    },
  });
  const html = response.data as string;
  // eslint-disable-next-line no-console
  console.log('[TamilMV] Homepage length:', html.length);
  return html;
}

export async function scrapeTamilMV(): Promise<ScrapedMovie[]> {
  const html = await fetchTamilMVHomepageHtml();
  const movies: ScrapedMovie[] = [];

  // The HTML structure separates entries with <br> tags. 
  // Splitting by <br> gives us isolated strings containing one movie and one link each.
  const chunks = html.split(/<br\s*\/?>/i);
  // eslint-disable-next-line no-console
  console.log('[TamilMV] Chunk count:', chunks.length);

  for (const chunk of chunks) {
    // Skip chunks that don't contain a forum topic link
    if (!chunk.includes('/index.php?/forums/topic/')) continue;

    const $chunk = loadHtml(chunk);
    const linkNode = $chunk('a[href*="/index.php?/forums/topic/"]').first();

    let pageUrl = linkNode.attr('href');
    if (!pageUrl) continue;

    // Ensure the URL is absolute
    if (!pageUrl.startsWith('http')) {
      pageUrl = `${config.tamilmvBaseUrl.replace(/\/+$/, '')}/${pageUrl.replace(/^\/+/, '')}`;
    }

    // Getting text from the chunk automatically strips the HTML tags, leaving clean text
    // Example: "Kshetrapati (2023) Kannada HD - [1080p & 720p - AVC...]"
    const rawText = $chunk.text().replace(/\s+/g, ' ').trim();

    // Skip TV-season/episode range entries like "EP (05-08) and telegram links"
    if (/\bS\d{2}\b/i.test(rawText) ||
      /EP\s*\(\d+(?:\s*-\s*\d+)?\)/i.test(rawText) ||
      /Telegram/i.test(rawText)) {
      // eslint-disable-next-line no-console
      console.log('[TamilMV] Skipping episode range entry:', rawText);
      continue;
    }

    const { titleGuess, yearGuess } = parseTitleAndYear(rawText);
    if (!titleGuess) continue;

    const rawTitle = `${titleGuess} ${yearGuess ? `(${yearGuess})` : ''}`.trim();
    const id = makeId(rawTitle);

    const movie: ScrapedMovie = {
      id,
      rawTitle,
      titleGuess,
      yearGuess,
      pageUrl,
      qualities: [], // We will populate this in the next step
      rawText,
    };

    // eslint-disable-next-line no-console
    console.log('[TamilMV] Scraped basic movie:', {
      id: movie.id,
      rawTitle: movie.rawTitle,
      pageUrl: movie.pageUrl,
    });

    movies.push(movie);

    // For testing: only collect the first 10 movies from homepage
    if (movies.length >= 25) {
      console.log('[TamilMV] Reached homepage scrape limit of 50 movies, stopping.');
      break;
    }
  }

  // Fetch magnets for all scraped movie pages
  // Note: Using a for-of loop ensures we process them sequentially to avoid rate-limiting.
  for (const movie of movies) {
    if (movie.pageUrl) {
      movie.qualities = await scrapeMoviePageForMagnets(movie.pageUrl);
      // eslint-disable-next-line no-console
      console.log('[TamilMV] Magnets for movie:', movie.rawTitle, '->', movie.qualities.length);
    }
  }

  // Filter out any entries that ended up having no magnets
  return movies.filter(m => m.qualities && m.qualities.length > 0);
}

export async function scrapeMoviePageForMagnets(url: string): Promise<ScrapedQuality[]> {
  try {
    // eslint-disable-next-line no-console
    console.log('[TamilMV] Fetching movie page:', url);

    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      },
      timeout: 10000,
    });

    const $ = loadHtml(response.data);
    const results: ScrapedQuality[] = [];

    // Select all magnet links
    $('a[href^="magnet:"]').each((_, el) => {
      const link = $(el);
      const href = link.attr('href');
      if (!href) return;

      // STRATEGY 1: Extract quality from the Magnet "dn" (Display Name) parameter
      // Example dn: "www.1TamilMV.gs - Kshetrapati (2023)... 1080p..."
      const dnMatch = href.match(/dn=([^&]+)/);
      let textToScan =
        dnMatch && dnMatch[1] !== undefined ? decodeURIComponent(dnMatch[1]) : '';

      // STRATEGY 2: Fallback to the text of the element immediately before the magnet link
      // (The structure is usually <br> -> <strong>Description</strong> -> <br> -> Magnet)
      if (!textToScan) {
        // Look at the previous 3 siblings to find a <strong> tag with text
        const prevText = link.prevAll('strong').first().text();
        textToScan = prevText || link.text();
      }
      // Get the base 1080p/720p/etc.
      const baseQuality = guessQuality(textToScan) as string;

      // Enhance it with size, codec, and audio details
      const enhancedQuality = extractStreamDetails(textToScan, baseQuality);

      results.push({
        quality: enhancedQuality,
        type: 'magnet',
        url: href,
      });
      // const quality = guessQuality(textToScan) as ScrapedQuality['quality'];

      // // Optional: If you want to capture the file size (e.g. "3.5GB"), you can add a regex for that here.

      // results.push({
      //   quality,
      //   type: 'magnet',
      //   url: href,
      // });
    });

    // eslint-disable-next-line no-console
    console.log('[TamilMV] Found magnet links on page:', url, 'count:', results.length);

    return results;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[TamilMV] Error fetching movie page:', url, error);
    return [];
  }
}