import Redis from 'ioredis';
import { EnrichedMovie } from '../models/movie';
import { config } from './config';

export const redis = new Redis(config.redisUrl, {
  tls: config.redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
  family: 0, // Helps with IPv6 resolution for upstash
  connectTimeout: 5000, // Fail if it takes more than 5 seconds to connect
  maxRetriesPerRequest: 3, // Don't hang forever
});

const MOVIE_KEY_PREFIX = 'tamilmv:movie:';
const MOVIE_LIST_KEY = 'tamilmv:movies:list';

export const getMovieKey = (id: string): string => `${MOVIE_KEY_PREFIX}${id}`;

const getExternalId = (movie: EnrichedMovie): string =>
  movie.imdbId || `tamilmv-${movie.id}`;

export async function saveMovies(movies: EnrichedMovie[]): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[Redis] Saving movies count:', movies.length);

  const newIds: string[] = [];
  const setPipeline = redis.pipeline();

  const movieMap = new Map<string, EnrichedMovie>();

  for (const movie of movies) {
    const id = getExternalId(movie);
    if (movieMap.has(id)) {
      const existing = movieMap.get(id)!;
      existing.qualities.push(...movie.qualities);
      
      if (movie.languages) {
        existing.languages = Array.from(new Set([...(existing.languages || []), ...movie.languages]));
      }
      
      if (movie.rawText && existing.rawText !== movie.rawText) {
        existing.rawText += '\n\n' + movie.rawText;
      }
    } else {
      movieMap.set(id, movie);
    }
  }

  for (const [id, mergedMovie] of movieMap.entries()) {
    newIds.push(id);
    setPipeline.set(getMovieKey(id), JSON.stringify(mergedMovie));
  }
  await setPipeline.exec();

  // Get current list of IDs to identify what needs to be removed
  const existingIds = await redis.lrange(MOVIE_LIST_KEY, 0, -1);

  // Find IDs that are in the old list but NOT in the new batch
  const newIdsSet = new Set(newIds);
  const idsToRemove = existingIds.filter(id => !newIdsSet.has(id));

  // Update the master list: replace entirely with the new 200
  const updatePipeline = redis.pipeline();

  updatePipeline.del(MOVIE_LIST_KEY);
  if (newIds.length > 0) {
    updatePipeline.rpush(MOVIE_LIST_KEY, ...newIds);
  }

  // Delete individual movie data for evicted items to keep cache clean
  if (idsToRemove.length > 0) {
    const keysToRemove = idsToRemove.map(getMovieKey);
    // Batch delete in chunks if needed, but for 1500 it's fine
    updatePipeline.del(...keysToRemove);
  }

  await updatePipeline.exec();

  // eslint-disable-next-line no-console
  console.log(`[Redis] Replaced list with ${newIds.length} current movies. Evicted ${idsToRemove.length} obsolete items.`);
}

export async function listMovieIds(): Promise<string[]> {
  const ids = await redis.lrange(MOVIE_LIST_KEY, 0, -1);
  // eslint-disable-next-line no-console
  console.log('[Redis] listMovieIds -> count:', ids.length);
  return ids;
}

export async function getMovieById(id: string): Promise<EnrichedMovie | null> {
  console.log('[Redis] getMovieById -> id:', id);
  const raw = await redis.get(getMovieKey(id));
  if (!raw) return null;
  // eslint-disable-next-line no-console
  console.log('[Redis] getMovieById -> cache hit for id:', id);
  return JSON.parse(raw) as EnrichedMovie;
}

export async function getMoviesByIds(ids: string[]): Promise<EnrichedMovie[]> {
  if (!ids.length) return [];
  const keys = ids.map(getMovieKey);
  const raw = await redis.mget(keys);
  const result: EnrichedMovie[] = [];
  raw.forEach((item) => {
    if (item) {
      result.push(JSON.parse(item) as EnrichedMovie);
    }
  });
  // eslint-disable-next-line no-console
  console.log('[Redis] getMoviesByIds -> requested:', ids.length, 'found:', result.length);
  return result;
}

