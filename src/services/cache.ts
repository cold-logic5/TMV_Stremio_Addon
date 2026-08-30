import fs from 'fs';
import path from 'path';
import axios from 'axios';
import Redis from 'ioredis';
import { EnrichedMovie, ScrapedQuality } from '../models/movie';
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

export const getExternalId = (movie: EnrichedMovie): string =>
  movie.imdbId || `tamilmv-${movie.id}`;

export const normalizeTitle = (title?: string): string =>
  (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

function getMergeKey(movie: EnrichedMovie): string {
  if (movie.imdbId) return `imdb:${movie.imdbId}`;
  const cleanTitle = normalizeTitle(movie.name || movie.titleGuess || movie.rawTitle);
  const year = movie.year || movie.yearGuess || '';
  if (cleanTitle) return `title:${cleanTitle}_${year}`;
  return `id:${movie.id}`;
}

// In-memory data store
const inMemoryMovies = new Map<string, EnrichedMovie>();
let inMemoryMovieIds: string[] = [];
let isInitialized = false;

function extractMagnetHash(magnetUrl: string): string {
  const match = magnetUrl.match(/xt=urn:btih:([a-zA-Z0-9]{32,40})/i);
  return match && match[1] ? match[1].toLowerCase() : magnetUrl;
}

function mergeQualities(existingQualities: ScrapedQuality[], newQualities: ScrapedQuality[]): ScrapedQuality[] {
  const qualityMap = new Map<string, ScrapedQuality>();

  // New qualities first (newer scrapes take priority)
  for (const q of newQualities) {
    const key = extractMagnetHash(q.url);
    qualityMap.set(key, { ...q });
  }

  // Preserve existing qualities if hash is not present in new batch
  for (const q of existingQualities) {
    const key = extractMagnetHash(q.url);
    if (!qualityMap.has(key)) {
      qualityMap.set(key, { ...q });
    }
  }

  return Array.from(qualityMap.values());
}

function mergeLanguages(existingLangs: string[] = [], newLangs: string[] = []): string[] {
  const combined = Array.from(new Set([...existingLangs, ...newLangs]));
  if (combined.length > 1 && !combined.includes('Multi-Lang')) {
    combined.push('Multi-Lang');
  }
  return combined;
}

export function mergeAndTrimMovies(
  newMovies: EnrichedMovie[],
  existingMovies: EnrichedMovie[] = [],
  maxLimit: number = config.maxDatabaseLimit
): EnrichedMovie[] {
  const mergedMap = new Map<string, EnrichedMovie>();
  const orderedIds: string[] = [];

  // Helper to add or merge movie
  const processMovie = (movie: EnrichedMovie, isNew: boolean) => {
    const key = getMergeKey(movie);
    const externalId = getExternalId(movie);

    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key)!;
      // Merge qualities (new qualities prepended/prioritized)
      existing.qualities = isNew
        ? mergeQualities(existing.qualities, movie.qualities)
        : mergeQualities(movie.qualities, existing.qualities);

      // Merge language tags
      existing.languages = mergeLanguages(existing.languages, movie.languages);

      // Update metadata if new movie has richer data
      if (isNew) {
        if (movie.imdbId && !existing.imdbId) existing.imdbId = movie.imdbId;
        if (movie.poster && !existing.poster) existing.poster = movie.poster;
        if (movie.thumbnail && !existing.thumbnail) existing.thumbnail = movie.thumbnail;
        if (movie.imdbRating) existing.imdbRating = movie.imdbRating;
        if (movie.description && (!existing.description || movie.description.length > existing.description.length)) {
          existing.description = movie.description;
        }
      }

      if (movie.rawText && existing.rawText && !existing.rawText.includes(movie.rawText)) {
        existing.rawText += '\n\n' + movie.rawText;
      }
    } else {
      mergedMap.set(key, { ...movie });
      if (!orderedIds.includes(externalId)) {
        orderedIds.push(externalId);
      }
    }
  };

  // 1. Process NEW movies first so they appear at the top of the catalog
  for (const m of newMovies) {
    processMovie(m, true);
  }

  // 2. Process EXISTING movies
  for (const m of existingMovies) {
    processMovie(m, false);
  }

  // Build final array in ordered sequence
  const result: EnrichedMovie[] = [];
  const processedKeys = new Set<string>();

  for (const m of Array.from(mergedMap.values())) {
    const externalId = getExternalId(m);
    if (!processedKeys.has(externalId)) {
      processedKeys.add(externalId);
      result.push(m);
    }
  }

  // Slice strictly to maxDatabaseLimit (e.g. 500)
  const trimmed = result.slice(0, maxLimit);
  console.log(`[Cache] Database merged: ${newMovies.length} new + ${existingMovies.length} existing -> ${trimmed.length} total (Limit: ${maxLimit}).`);
  return trimmed;
}

function populateInMemoryStore(movies: EnrichedMovie[]): void {
  inMemoryMovies.clear();
  inMemoryMovieIds = [];

  for (const movie of movies) {
    const id = getExternalId(movie);
    inMemoryMovieIds.push(id);
    inMemoryMovies.set(id, movie);
  }

  console.log(`[Cache] In-memory store populated with ${inMemoryMovieIds.length} movies.`);
}

export async function saveMovies(
  newMovies: EnrichedMovie[],
  existingMovies?: EnrichedMovie[]
): Promise<void> {
  console.log('[Cache] saveMovies called with new items count:', newMovies.length);

  // If existingMovies was not provided, load current database
  let baseExisting = existingMovies;
  if (!baseExisting) {
    baseExisting = await getAllCachedMovies();
  }

  // Merge new items into existing database and trim to 500
  const finalMovies = mergeAndTrimMovies(newMovies, baseExisting, config.maxDatabaseLimit);

  // 1. Update in-memory store
  populateInMemoryStore(finalMovies);

  // 2. Save locally to data/movies.json
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(finalMovies, null, 2), 'utf-8');
    console.log(`[Cache] Successfully wrote ${finalMovies.length} movies to local file: ${DATA_FILE}`);
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
              content: JSON.stringify(finalMovies, null, 2),
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

export async function getAllCachedMovies(): Promise<EnrichedMovie[]> {
  if (!isInitialized || inMemoryMovieIds.length === 0) {
    await initCache();
  }
  return inMemoryMovieIds.map((id) => inMemoryMovies.get(id)!).filter(Boolean);
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
        try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
  if (!isInitialized || inMemoryMovieIds.length === 0) {
    await initCache();
  }
  return inMemoryMovieIds;
}

export async function getMovieById(id: string): Promise<EnrichedMovie | null> {
  if (!isInitialized || inMemoryMovieIds.length === 0) {
    await initCache();
  }
  return inMemoryMovies.get(id) ?? null;
}

export async function getMoviesByIds(ids: string[]): Promise<EnrichedMovie[]> {
  if (!ids.length) return [];
  if (!isInitialized || inMemoryMovieIds.length === 0) {
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
