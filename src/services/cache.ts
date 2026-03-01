import Redis from 'ioredis';
import { EnrichedMovie } from '../models/movie';
import { config } from './config';

export const redis = new Redis(config.redisUrl);

const MOVIE_KEY_PREFIX = 'tamilmv:movie:';
const MOVIE_LIST_KEY = 'tamilmv:movies:list';

export const getMovieKey = (id: string): string => `${MOVIE_KEY_PREFIX}${id}`;

const getExternalId = (movie: EnrichedMovie): string =>
  movie.imdbId || `tamilmv-${movie.id}`;

export async function saveMovies(movies: EnrichedMovie[]): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[Redis] Saving movies count:', movies.length);

  const pipeline = redis.pipeline();
  const ids: string[] = [];

  for (const movie of movies) {
    const id = getExternalId(movie);
    console.log('[Redis] saveMovies -> id:', id);
    ids.push(id);
    pipeline.set(getMovieKey(id), JSON.stringify(movie));
  }

  pipeline.del(MOVIE_LIST_KEY);
  if (ids.length) {
    pipeline.rpush(MOVIE_LIST_KEY, ...ids);
  }

  await pipeline.exec();
  // eslint-disable-next-line no-console
  console.log('[Redis] Saved movie IDs to list:', ids.length);
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

