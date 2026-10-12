import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Redis from 'ioredis';
import { EnrichedMovie } from '../models/movie';
import { makeId } from '../scraper/tamilmv';
import { config } from './config';

// Initialize Redis only if REDIS_URL is provided
export const redis = config.redisUrl
  ? new Redis(config.redisUrl, {
      tls: config.redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      family: 0,
      connectTimeout: 5000,
      maxRetriesPerRequest: 3,
    })
  : null;

if (redis) {
  let lastLoggedErrorTime = 0;
  redis.on('error', (err) => {
    const now = Date.now();
    if (now - lastLoggedErrorTime > 60000) {
      console.error('[Redis Error]', err.message);
      lastLoggedErrorTime = now;
    }
  });
}

const MOVIE_KEY_PREFIX = 'tamilmv:movie:';
const MOVIE_LIST_KEY = 'tamilmv:movies:list';
export const getMovieKey = (id: string): string => `${MOVIE_KEY_PREFIX}${id}`;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'movies.json');

const getExternalId = (movie: EnrichedMovie): string =>
  movie.imdbId || `tamilmv-${movie.id}`;

// In-memory data store
const inMemoryMovies = new Map<string, EnrichedMovie>();
let inMemoryMovieIds: string[] = [];
let isInitialized = false;

function populateInMemoryStore(movies: EnrichedMovie[]): void {
  const movieMap = new Map<string, EnrichedMovie>();

  for (const movie of movies) {
    if (!movie.imdbId && movie.rawTitle) {
      movie.id = makeId(movie.rawTitle);
    }
    const id = getExternalId(movie);
    if (movieMap.has(id)) {
      const existing = movieMap.get(id)!;
      
      // Merge qualities without duplicate URLs
      const seenUrls = new Set(existing.qualities.map(q => q.url));
      for (const q of movie.qualities) {
        if (!seenUrls.has(q.url)) {
          seenUrls.add(q.url);
          existing.qualities.push(q);
        }
      }

      if (movie.languages) {
        existing.languages = Array.from(new Set([...(existing.languages || []), ...movie.languages]));
        if (existing.languages.length > 1 && !existing.languages.includes('Multi-Lang')) {
          existing.languages.push('Multi-Lang');
        }
      }

      if (movie.rawText && existing.rawText !== movie.rawText && !existing.rawText?.includes(movie.rawText)) {
        existing.rawText = (existing.rawText ? existing.rawText + '\n\n' : '') + movie.rawText;
      }
    } else {
      if (movie.languages && movie.languages.length > 1 && !movie.languages.includes('Multi-Lang')) {
        movie.languages.push('Multi-Lang');
      }
      movieMap.set(id, { ...movie, qualities: [...movie.qualities] });
    }
  }

  inMemoryMovies.clear();
  inMemoryMovieIds = [];

  for (const [id, mergedMovie] of movieMap.entries()) {
    inMemoryMovieIds.push(id);
    inMemoryMovies.set(id, mergedMovie);
  }

  console.log(`[Cache] In-memory store ready with ${inMemoryMovieIds.length} movies.`);
}

export async function saveMovies(movies: EnrichedMovie[]): Promise<void> {
  console.log('[Cache] Saving movies count:', movies.length);

  // 1. Update in-memory store
  populateInMemoryStore(movies);
  const allMovies = Array.from(inMemoryMovies.values());

  // 2. Save locally to data/movies.json
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(allMovies, null, 2), 'utf-8');
    console.log(`[Cache] Successfully wrote ${allMovies.length} movies to local file: ${DATA_FILE}`);
  } catch (err: any) {
    console.error('[Cache] Failed to write local JSON file:', err.message);
  }

  // 3. If GitHub Gist is configured, update the remote Gist
  if (config.gistId && config.githubToken) {
    try {
      console.log('[Cache] Uploading movies.json to GitHub Gist...');
      await axios.patch(
        `https://api.github.com/gists/${config.gistId}`,
        {
          description: `TamilMV Movies Catalog Cache (Updated: ${new Date().toISOString()})`,
          files: {
            'movies.json': {
              content: JSON.stringify(allMovies, null, 2),
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'Stremio-Addon-Tamil',
          },
          timeout: 15000,
        }
      );
      console.log(`[Cache] Successfully updated GitHub Gist (${config.gistId})!`);
    } catch (err: any) {
      console.error('[Cache] Failed to update GitHub Gist:', err.response?.data || err.message);
    }
  }

  // 4. Optional: Update Redis if available
  if (redis) {
    try {
      const setPipeline = redis.pipeline();
      for (const [id, mergedMovie] of inMemoryMovies.entries()) {
        setPipeline.set(getMovieKey(id), JSON.stringify(mergedMovie));
      }
      await setPipeline.exec();

      const existingIds = await redis.lrange(MOVIE_LIST_KEY, 0, -1);
      const newIdsSet = new Set(inMemoryMovieIds);
      const idsToRemove = existingIds.filter((id) => !newIdsSet.has(id));

      const updatePipeline = redis.pipeline();
      updatePipeline.del(MOVIE_LIST_KEY);
      if (inMemoryMovieIds.length > 0) {
        updatePipeline.rpush(MOVIE_LIST_KEY, ...inMemoryMovieIds);
      }
      if (idsToRemove.length > 0) {
        const keysToRemove = idsToRemove.map(getMovieKey);
        updatePipeline.del(...keysToRemove);
      }
      await updatePipeline.exec();
      console.log(`[Redis] Synced ${inMemoryMovieIds.length} movies to Redis.`);
    } catch (err: any) {
      console.warn(`[Redis] Failed to sync to Redis (${err.message}). In-memory / file cache is active.`);
    }
  }
}

export async function initCache(): Promise<void> {
  console.log('[Cache] Initializing cache...');

  // 1. Try fetching from remote Static URL / CDN
  if (config.dataUrl) {
    try {
      console.log(`[Cache] Fetching movies from remote DATA_URL: ${config.dataUrl}`);
      const fetchUrl = config.dataUrl.includes('?')
        ? `${config.dataUrl}&_t=${Date.now()}`
        : `${config.dataUrl}?_t=${Date.now()}`;

      const response = await axios.get(fetchUrl, {
        timeout: 10000,
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Stremio-Addon-Tamil',
        },
      });
      let data = response.data;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
      if (Array.isArray(data) && data.length > 0) {
        populateInMemoryStore(data);
        isInitialized = true;
        // Also save local deduplicated copy
        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          const allMovies = Array.from(inMemoryMovies.values());
          fs.writeFileSync(DATA_FILE, JSON.stringify(allMovies, null, 2), 'utf-8');
        } catch {
          // ignore local save error
        }
        setupPeriodicRefresh();
        return;
      }
    } catch (err: any) {
      console.warn(`[Cache] Failed to fetch from DATA_URL (${err.message}). Trying next fallback...`);
    }
  }

  // 2. Try fetching from GitHub Gist
  if (config.gistId) {
    try {
      console.log(`[Cache] Fetching movies from GitHub Gist: ${config.gistId}`);
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Stremio-Addon-Tamil',
      };
      if (config.githubToken) {
        headers.Authorization = `Bearer ${config.githubToken}`;
      }
      const response = await axios.get(`https://api.github.com/gists/${config.gistId}`, {
        headers,
        timeout: 10000,
      });
      const fileContent = response.data?.files?.['movies.json']?.content;
      if (fileContent) {
        const data = JSON.parse(fileContent);
        if (Array.isArray(data) && data.length > 0) {
          populateInMemoryStore(data);
          isInitialized = true;
          setupPeriodicRefresh();
          return;
        }
      }
    } catch (err: any) {
      console.warn(`[Cache] Failed to fetch from GitHub Gist (${err.message}). Trying local file...`);
    }
  }

  // 3. Try reading local data/movies.json file
  if (fs.existsSync(DATA_FILE)) {
    try {
      console.log(`[Cache] Loading movies from local file: ${DATA_FILE}`);
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        populateInMemoryStore(data);
        isInitialized = true;
        setupPeriodicRefresh();
        return;
      }
    } catch (err: any) {
      console.warn(`[Cache] Failed to read local JSON file (${err.message}). Trying Redis...`);
    }
  }

  // 4. Try loading from Redis as fallback
  if (redis) {
    try {
      const ids = await redis.lrange(MOVIE_LIST_KEY, 0, -1);
      if (ids && ids.length > 0) {
        const keys = ids.map(getMovieKey);
        const raw = await redis.mget(keys);
        const movies: EnrichedMovie[] = [];
        raw.forEach((item) => {
          if (item) movies.push(JSON.parse(item) as EnrichedMovie);
        });
        if (movies.length > 0) {
          populateInMemoryStore(movies);
          isInitialized = true;
          setupPeriodicRefresh();
          return;
        }
      }
    } catch (err: any) {
      console.warn(`[Cache] Failed to load from Redis (${err.message}).`);
    }
  }

  console.log('[Cache] No pre-existing movie data found. Will populate after first scrape.');
  isInitialized = true;
  setupPeriodicRefresh();
}

let refreshIntervalTimer: NodeJS.Timeout | null = null;
function setupPeriodicRefresh(): void {
  if (refreshIntervalTimer || (!config.dataUrl && !config.gistId)) return;

  const intervalMs = Math.max(1, config.dataRefreshMinutes) * 60 * 1000;
  console.log(`[Cache] Periodic remote cache refresh enabled (every ${config.dataRefreshMinutes} minutes).`);

  refreshIntervalTimer = setInterval(() => {
    console.log('[Cache] Running periodic remote data refresh...');
    void initCache();
  }, intervalMs);
}

export async function listMovieIds(): Promise<string[]> {
  if (!isInitialized && inMemoryMovieIds.length === 0) {
    await initCache();
  }
  return inMemoryMovieIds;
}

export async function getMovieById(id: string): Promise<EnrichedMovie | null> {
  if (!isInitialized && inMemoryMovieIds.length === 0) {
    await initCache();
  }
  return inMemoryMovies.get(id) ?? null;
}

export async function getMoviesByIds(ids: string[]): Promise<EnrichedMovie[]> {
  if (!ids.length) return [];
  if (!isInitialized && inMemoryMovieIds.length === 0) {
    await initCache();
  }

  const result: EnrichedMovie[] = [];
  for (const id of ids) {
    const item = inMemoryMovies.get(id);
    if (item) {
      result.push(item);
    }
  }
  return result;
}
