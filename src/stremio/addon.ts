import { addonBuilder, type Manifest, type Stream } from 'stremio-addon-sdk';
import { listMovieIds, getMovieById, getMoviesByIds, listSeries, getSeriesById } from '../services/cache';
import { EnrichedMovie, ScrapedQuality } from '../models/movie';
import { EnrichedSeries } from '../models/series';

const MANIFEST: Manifest = {
  id: 'org.tamilmv.recent',
  version: '1.2.1',
  name: 'InMax',
  description: 'Trending Indian Movies with multi-language streams & Bigg Boss Series.',
  logo: 'https://cold-logic5.github.io/TMV_Stremio_Addon_img/InMax%20Logo4.png',
  catalogs: [
    {
      type: 'movie',
      id: 'tamilmv-now',
      name: 'Tamilmv Latest',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'limit', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Tamil', 'Malayalam', 'Telugu', 'Kannada', 'Hindi', 'Multi-Lang'] }
      ],
    },
    {
      type: 'series',
      id: 'tamilmv-series',
      name: 'Big Boss',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'limit', isRequired: false },
        { name: 'genre', isRequired: false, options: ['Tamil', 'Telugu'] }
      ],
    },
  ],
  resources: [
    'catalog',
    {
      name: 'meta',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tamilmv-'],
    },
    {
      name: 'stream',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tamilmv-'],
    },
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tamilmv-'],
};

const builder = new addonBuilder(MANIFEST);

builder.defineCatalogHandler(async (args: any) => {
  if (args.type === 'movie' && args.id === 'tamilmv-now') {
    const skip = Number(args.extra?.skip ?? 0);
    const limit = Number(args.extra?.limit ?? 50);
    const genre = args.extra?.genre;

    const ids = await listMovieIds();
    let movies = await getMoviesByIds(ids);

    if (genre) {
      movies = movies.filter(m => m.languages && m.languages.includes(genre));
    }

    const requestedCount = movies.length;
    movies = movies.slice(skip, skip + limit);

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
      genres: m.genres && m.genres.length > 0
        ? Array.from(new Set([...m.genres, ...(m.languages || [])]))
        : (m.languages || []),
      description: m.description
        ? `${m.description}\n\nOriginal TamilMV Title: ${m.rawText || m.rawTitle}`
        : `Original TamilMV Title: ${m.rawText || m.rawTitle}`,
      imdbRating: m.imdbRating,
    }));

    return {
      metas,
      cacheMaxAge: 60,
      staleRevalidate: 30,
      staleError: 3600
    };
  }

  if (args.type === 'series' && args.id === 'tamilmv-series') {
    const genre = args.extra?.genre;
    let allSeries = await listSeries();

    if (genre) {
      allSeries = allSeries.filter(s => s.genre === genre || s.genres?.includes(genre));
    }

    const metas = allSeries.map((s: EnrichedSeries) => ({
      id: s.imdbId || s.id,
      type: 'series' as const,
      name: s.name,
      poster: s.poster,
      thumbnail: s.thumbnail || s.poster,
      background: s.background,
      genres: s.genres || [s.genre],
      description: s.description || `${s.name} - Latest daily episodes scraped directly from TamilMV.`,
      imdbRating: s.imdbRating,
      releaseInfo: s.releaseInfo || (s.year ? `${s.year}` : undefined),
    }));

    console.log(`[Stremio] Serving ${metas.length} series in 'Big Boss' catalog (Genre: ${genre || 'All'})`);

    return {
      metas,
      cacheMaxAge: 60,
      staleRevalidate: 30,
      staleError: 3600
    };
  }

  return { metas: [] };
});

// High-performance active public trackers to speed up peer discovery
const BEST_TRACKERS = [
  'udp://tracker.publictracker.xyz:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.wildkat.net:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.peerfect.org:6969/announce',
  'udp://tracker.opentrackr.com:6969/announce',
  'udp://tracker.opentorrent.top:6969/announce',
  'udp://tracker.ilibr.org:6969/announce',
  'udp://tracker.filemail.com:6969/announce',
  'udp://tracker.ducks.party:1984/announce',
  'udp://tracker.corpscorp.online:80/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker.auctor.tv:6969/announce',
  'udp://tracker.0x7c0.com:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://tr4ck3r.duckdns.org:6969/announce',
  'udp://torrentclub.online:54123/announce',
  'udp://torrentclub.online:1984/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.filebase.online:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.dler.org:6969/announce'
];

function extractInfoHash(magnetUrl: string): string | null {
  const hexMatch = magnetUrl.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  if (hexMatch && hexMatch[1]) {
    return hexMatch[1].toLowerCase();
  }
  const b32Match = magnetUrl.match(/xt=urn:btih:([a-zA-Z2-7]{32})/i);
  if (b32Match && b32Match[1]) {
    return b32Match[1].toLowerCase();
  }
  return null;
}

function extractSize(q: ScrapedQuality): string | undefined {
  if (q.size) return q.size.replace(/[\(\)]/g, '').trim();
  const match = (q.quality + ' ' + decodeURIComponent(q.url)).match(/(\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB))/i);
  if (match && match[1]) {
    return match[1].replace(/\s+/g, '').toUpperCase();
  }
  return undefined;
}

function cleanQualityString(quality: string): string {
  return quality.replace(/\s*\(?\d+(?:\.\d+)?\s*(?:GB|MB|GiB|MiB)\)?/i, '').trim();
}

function formatQualitiesToStreams(qualities: ScrapedQuality[], bingeGroup = 'tamilmv'): Stream[] {
  return qualities.map((q) => {
    const sizeStr = extractSize(q);
    const cleanedQuality = cleanQualityString(q.quality);
    const languageName = q.languages && q.languages.length > 0 ? q.languages.join('/') : 'Unknown';
    const infoHash = extractInfoHash(q.url);

    const infoParts: string[] = [];
    if (q.seeders !== undefined) {
      infoParts.push(`👤 ${q.seeders} 👥 ${q.leechers || 0}`);
    }
    if (sizeStr) {
      infoParts.push(`💾 ${sizeStr}`);
    }

    const health = infoParts.length > 0 ? `\n${infoParts.join(' ')}` : '';

    if (infoHash) {
      return {
        title: `${languageName} ${cleanedQuality}${health}`,
        infoHash: infoHash,
        sources: BEST_TRACKERS.map(tr => `tracker:${tr}`),
        behaviorHints: {
          bingeGroup,
        },
      } as Stream;
    }

    // Fallback if magnet URL lacks valid btih hash
    let finalUrl = q.url;
    if (finalUrl.startsWith('magnet:')) {
      const trackerString = BEST_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
      finalUrl += trackerString;
    }

    return {
      title: `${languageName} ${cleanedQuality}${health}`,
      url: finalUrl,
      behaviorHints: {
        bingeGroup,
      },
    };
  });
}

builder.defineStreamHandler(async (args: any) => {
  // 1. Handle series streams (ID format: '<seriesId>:<season>:<episode>')
  if (args.type === 'series' || (typeof args.id === 'string' && args.id.includes(':'))) {
    const parts = args.id.split(':');
    const seriesId = parts[0];
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);

    const series = await getSeriesById(seriesId);
    if (!series) {
      console.log(`[Stream] Series not found for id: ${seriesId}`);
      return { streams: [] };
    }

    const matchedEpisode = series.episodes.find(
      (e) => e.season === season && e.episode === episode
    );

    if (!matchedEpisode || !matchedEpisode.qualities.length) {
      console.log(`[Stream] No episode found for ${series.name} S${season}E${episode}`);
      return { streams: [] };
    }

    console.log(`[Stream] Serving ${matchedEpisode.qualities.length} streams for ${series.name} S${season}E${episode}`);
    return {
      streams: formatQualitiesToStreams(matchedEpisode.qualities, `tamilmv-${series.id}`)
    };
  }

  // 2. Handle movie streams
  const movie = await getMovieById(args.id);
  if (!movie) return { streams: [] };

  return {
    streams: formatQualitiesToStreams(movie.qualities, 'tamilmv')
  };
});

builder.defineMetaHandler(async (args: any) => {
  // Handle Series metadata
  if (args.type === 'series') {
    const series = await getSeriesById(args.id);
    if (series) {
      const canonicalId = series.imdbId || args.id;
      const baseTimestamp = Date.now();
      const videos = series.episodes.map((ep) => {
        const daysAgo = Math.max(0, series.episodes.length - ep.episode);
        const fallbackDate = new Date(baseTimestamp - daysAgo * 86400000).toISOString();
        return {
          id: `${canonicalId}:${ep.season}:${ep.episode}`,
          title: ep.title || `Episode ${ep.episode}`,
          name: ep.title || `Episode ${ep.episode}`,
          season: ep.season,
          episode: ep.episode,
          number: ep.episode,
          released: ep.released || fallbackDate,
          thumbnail: series.background || series.poster,
        };
      });

      return {
        meta: {
          id: args.id,
          imdb_id: series.imdbId,
          type: 'series' as const,
          name: series.name,
          poster: series.poster,
          background: series.background,
          logo: series.logo,
          genres: series.genres || [series.genre],
          description: series.description
            ? `${series.description}\n\nOriginal TamilMV Series: ${series.rawText || series.name}`
            : `Original TamilMV Series: ${series.rawText || series.name}`,
          imdbRating: series.imdbRating,
          releaseInfo: series.releaseInfo,
          videos,
        }
      };
    }
  }

  // For 'tt' IDs for movies, Stremio's default Cinemeta addon will handle it automatically.
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
          genres: movie.genres && movie.genres.length > 0
            ? Array.from(new Set([...movie.genres, ...(movie.languages || [])]))
            : (movie.languages || []),
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

