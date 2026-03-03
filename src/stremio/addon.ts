import { addonBuilder, type Manifest, type Stream } from 'stremio-addon-sdk';
import { listMovieIds, getMovieById, getMoviesByIds } from '../services/cache';
import { EnrichedMovie } from '../models/movie';

const MANIFEST: Manifest = {
  id: 'org.tamilmv.recent',
  version: '1.0.0',
  name: 'InMax',
  description: 'Recently updated movies from TamilMV with multi-quality streams.',
  logo: 'https://freeimage.host/i/inmax-logo.qBunX1f',
  catalogs: [
    {
      type: 'movie',
      id: 'tamilmv-recent',
      name: 'TamilMV Recent',
      extra: [{ name: 'skip', isRequired: false }, { name: 'limit', isRequired: false }],
    },
  ],
  resources: ['catalog', 'stream', 'meta'],
  types: ['movie'],
  idPrefixes: ['tt', 'tamilmv-'],
};

const builder = new addonBuilder(MANIFEST);

builder.defineCatalogHandler(async (args: any) => {
  if (args.type !== 'movie' || args.id !== 'tamilmv-recent') {
    return { metas: [] };
  }

  const skip = Number(args.extra?.skip ?? 0);
  const limit = Number(args.extra?.limit ?? 50);

  const ids = await listMovieIds();
  const slice = ids.slice(skip, skip + limit);
  const movies = await getMoviesByIds(slice);

  const metas = movies.map((m: EnrichedMovie) => ({
    id: m.imdbId || `tamilmv-${m.id}`,
    type: 'movie' as const,
    name: m.name || m.titleGuess || m.rawTitle,
    poster: m.poster,
    thumbnail: m.thumbnail,
    year: m.year ?? m.yearGuess,
    genres: m.genres,
    description: m.description
      ? `${m.description}\n\nOriginal TamilMV Title: ${m.rawText || m.rawTitle}`
      : `Original TamilMV Title: ${m.rawText || m.rawTitle}`,
    imdbRating: m.imdbRating,
  }));

  return {
    metas,
    cacheMaxAge: 21600,       // Tells Stremio: "Only cache this for 6 hour (3600 seconds)"
    staleRevalidate: 10800,   // Tells Stremio: "Check for updates in the background after 3 hours"
    staleError: 21600         // Tells Stremio: "If my server crashes, use the old list for up to 6 hour"
  };
});

builder.defineStreamHandler(async (args: any) => {
  const movie = await getMovieById(args.id);
  // console.log('[Stremio] Stream handler -> args:', args);
  // console.log('[Stremio] Stream handler -> id:', args.id);
  // console.log('[Stremio] Stream handler -> movie:', movie?.name);
  if (!movie) return { streams: [] };

  const streams: Stream[] = movie.qualities.map((q) => ({
    title: `TamilMV ${q.quality}`,
    url: q.url,
    behaviorHints: {
      bingeGroup: 'tamilmv',
    },
  }));

  return { streams };
});

builder.defineMetaHandler(async (args: any) => {
  // For 'tt' IDs, Stremio's default Cinemeta addon will handle it automatically.
  if (args.type === 'movie' && args.id.startsWith('tamilmv-')) {
    const movie = await getMovieById(args.id);

    if (movie) {
      return {
        meta: {
          id: args.id,
          type: 'movie' as const,
          name: movie.name || movie.titleGuess || movie.rawTitle,
          poster: movie.poster,
          background: movie.thumbnail,
          year: movie.year ?? movie.yearGuess,
          genres: movie.genres,
          description: movie.description
            ? `${movie.description}\n\nOriginal TamilMV Title: ${movie.rawText || movie.rawTitle}`
            : `No IMDB metadata found, but streams are available.\n\nOriginal TamilMV Title: ${movie.rawText || movie.rawTitle}`,
        }
      };
    }
  }

  // Return empty if we don't have it, letting other addons try
  return Promise.resolve({ meta: {} as any });
});

export const addonInterface = builder.getInterface();
export const manifest = MANIFEST;

