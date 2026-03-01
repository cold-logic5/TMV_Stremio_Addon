import axios from 'axios';
import { EnrichedMovie, ScrapedMovie } from '../models/movie';

interface CinemetaMeta {
  id: string;
  name: string;
  year?: number;
  poster?: string;
  background?: string;
  genres?: string[];
  description?: string;
  imdbRating?: number;
}

interface CinemetaResponse {
  metas?: CinemetaMeta[];
}

const CINEMETA_SEARCH_BASE =
  'https://v3-cinemeta.strem.io/catalog/movie/top/search=';

function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const aNorm = norm(a);
  const bNorm = norm(b);
  if (!aNorm || !bNorm) return 0;

  const aTokens = new Set(aNorm.split(' '));
  const bTokens = new Set(bNorm.split(' '));

  let intersection = 0;
  aTokens.forEach((t) => {
    if (bTokens.has(t)) intersection += 1;
  });

  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

async function searchCinemeta(
  cleanName: string,
  yearGuess?: number,
): Promise<CinemetaMeta | null> {
  const url = `${CINEMETA_SEARCH_BASE}${encodeURIComponent(cleanName)}.json`;
  // eslint-disable-next-line no-console
  console.log('[Cinemeta] Searching for:', cleanName, 'yearGuess:', yearGuess, 'url:', url);

  const { data } = await axios.get<CinemetaResponse>(url);
  if (!data || !Array.isArray(data.metas) || data.metas.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[Cinemeta] No metas found for:', cleanName);
    return null;
  }

  if (yearGuess) {
    const byYear = data.metas.find(
      (m) => m.year && Math.abs(m.year - yearGuess) <= 1,
    );
    if (byYear) {
      // eslint-disable-next-line no-console
      console.log('[Cinemeta] Using year-matched meta:', byYear.id, byYear.name, byYear.year);
      return byYear;
    }
  }

  const chosen = data.metas[0] ?? null;
  if (chosen) {
    // eslint-disable-next-line no-console
    console.log('[Cinemeta] Using first meta:', chosen.id, chosen.name, chosen.year);
  }
  return chosen;
}

export async function enrichMoviesWithImdb(scraped: ScrapedMovie[]): Promise<EnrichedMovie[]> {
  const result: EnrichedMovie[] = [];

  for (const movie of scraped) {
    let enriched: EnrichedMovie = { ...movie };

    try {
      const cleanName = movie.titleGuess ?? movie.rawTitle;
      if (cleanName) {
        const meta = await searchCinemeta(cleanName, movie.yearGuess);
        if (meta) {
          const score = similarity(cleanName, meta.name);
          if (score < 0.3) {
            enriched = {
              ...enriched,
              // imdbId: meta.id,
              id: movie.id,
              // name: meta.name ?? movie.titleGuess ?? movie.rawTitle,
              name: movie.rawTitle,
            };
            // eslint-disable-next-line no-console
            console.log('[Cinemeta] Rejected meta due to low title similarity:', {
              scrapedTitle: cleanName,
              metaName: meta.name,
              score,
            });
          } else {
          enriched = {
            ...enriched,
            imdbId: meta.id,
            id: movie.id,
            // name: meta.name ?? movie.titleGuess ?? movie.rawTitle,
            name: movie.rawTitle,
            year: meta.year ?? movie.yearGuess,
            poster: meta.poster ?? enriched.poster,
            thumbnail: meta.poster ?? enriched.thumbnail,
            genres: meta.genres ?? enriched.genres,
            description: meta.description ?? enriched.description,
            imdbRating: meta.imdbRating ?? enriched.imdbRating,
          };
          // eslint-disable-next-line no-console
          console.log('[Cinemeta] Enriched movie:', {
            scrapedTitle: movie.rawTitle,
            cleanName,
            imdbId: enriched.imdbId,
            // id: enriched.id,
            name: enriched.name,
            year: enriched.year,
            similarity: score,
          });
          }
        } else {
          // eslint-disable-next-line no-console
          console.log('[Cinemeta] No enrichment found for:', cleanName);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Cinemeta] Error enriching movie:', movie.rawTitle, err);
      // Ignore error and keep scraped data
    }

    result.push(enriched);
  }

  return result;
}
