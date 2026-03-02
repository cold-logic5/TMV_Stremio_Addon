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

  for (const movie of movies) {
    const id = getExternalId(movie);
    // eslint-disable-next-line no-console
    console.log('[Redis] saveMovies -> id:', id);
    newIds.push(id);
    setPipeline.set(getMovieKey(id), JSON.stringify(movie));
  }
  await setPipeline.exec();

  // Get current list of IDs
  const existingIds = await redis.lrange(MOVIE_LIST_KEY, 0, -1);

  // Merge new IDs at the front, then existing ones, and deduplicate
  const uniqueIds = Array.from(new Set([...newIds, ...existingIds]));

  // Keep only up to 1500 items
  const MAX_ENTRIES = 1500;
  const idsToKeep = uniqueIds.slice(0, MAX_ENTRIES);
  const idsToRemove = uniqueIds.slice(MAX_ENTRIES);

  // Update the master list and remove old data
  const updatePipeline = redis.pipeline();

  updatePipeline.del(MOVIE_LIST_KEY);
  if (idsToKeep.length > 0) {
    updatePipeline.rpush(MOVIE_LIST_KEY, ...idsToKeep);
  }

  if (idsToRemove.length > 0) {
    const keysToRemove = idsToRemove.map(getMovieKey);
    updatePipeline.del(...keysToRemove);
  }

  await updatePipeline.exec();

  // eslint-disable-next-line no-console
  console.log(`[Redis] Saved ${idsToKeep.length} movie IDs to list. Evicted ${idsToRemove.length} old movies.`);
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

