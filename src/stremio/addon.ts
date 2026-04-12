import { addonBuilder, type Manifest, type Stream } from 'stremio-addon-sdk';
import { listMovieIds, getMovieById, getMoviesByIds } from '../services/cache';
import { EnrichedMovie } from '../models/movie';

const MANIFEST: Manifest = {
  id: 'org.tamilmv.recent',
  version: '1.1.0',
  name: 'InMax',
  description: 'Recently updated movies from TamilMV with multi-quality streams.',
  logo: 'https://cold-logic5.github.io/TMV_Stremio_Addon_img/InMax%20Logo4.png',
  catalogs: [
    {
      type: 'movie',
      id: 'tamilmv-now',
      name: 'Tamilmv Recent',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'limit', isRequired: false },
        // { name: 'genre', isRequired: false, options: ['All', 'Tamil', 'Malayalam', 'Telugu', 'Kannada', 'Hindi', 'Multi-Lang'] }
        { name: 'genre', isRequired: false, options: ['Tamil', 'Malayalam', 'Telugu', 'Kannada', 'Hindi', 'Multi-Lang'] }

      ],
    },
  ],
  resources: ['catalog', 'stream', 'meta'],
  types: ['movie'],
  idPrefixes: ['tt', 'tamilmv-'],
  stremioAddonsConfig: {
    "issuer": "https://stremio-addons.net",
    "signature": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..cRYD4CgiXYy97pB2a10sug.EGnamjOef66h3f9rFBdTarLsvequuRlT10-0tFIGqPRXiMUv7n_CY1ehgfS3nPN2xTLXwY1SlXehsjFh0PsCl6hN6Jz_BXc3gvtvB3TotC8GUgIyjiD0E3iPr4LK2eD1.Ht5wJLt9h-WFNnG2LUUOtw"
  }
};

const builder = new addonBuilder(MANIFEST);

builder.defineCatalogHandler(async (args: any) => {
  if (args.type !== 'movie' || args.id !== 'tamilmv-now') {
    return { metas: [] };
  }

  const skip = Number(args.extra?.skip ?? 0);
  const limit = Number(args.extra?.limit ?? 50);
  const genre = args.extra?.genre;

  const ids = await listMovieIds();
  let movies = await getMoviesByIds(ids);

  // if (genre && genre !== 'All') {
  if (genre) {
    movies = movies.filter(m => m.languages && m.languages.includes(genre));
  }

  const requestedCount = movies.length;
  // Apply pagination after filtering
  movies = movies.slice(skip, skip + limit);

  // VIBRANT LOG FOR VISIBILITY
  console.log('********************************************');
  console.log(`🚀 STREMIO IS REQUESTING ${movies.length} MOVIES (Genre: ${genre || 'All'} | Total found: ${requestedCount})`);
  console.log('********************************************');

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
    cacheMaxAge: 60,          // Refresh every minute
    staleRevalidate: 30,      // Check for updates every 30 seconds
    staleError: 3600          // Use old data for 1 hour if server is down
  };
});

// High-performance public trackers to speed up peer discovery
const BEST_TRACKERS = [
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.moeking.me:6969/announce'
];

builder.defineStreamHandler(async (args: any) => {
  const movie = await getMovieById(args.id);
  if (!movie) return { streams: [] };

  const streams: Stream[] = movie.qualities.map((q) => {
    const health = q.seeders !== undefined ? `\n👤 ${q.seeders} 👥 ${q.leechers || 0}` : '';

    // Inject trackers into the magnet links for faster startup
    let finalUrl = q.url;
    if (finalUrl.startsWith('magnet:')) {
      const trackerString = BEST_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
      finalUrl += trackerString;
    }

    return {
      title: `TamilMV ${q.quality}${health}`,
      url: finalUrl,
      behaviorHints: {
        bingeGroup: 'tamilmv',
      },
    };
  });

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

