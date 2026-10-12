import axios from 'axios';
import { ScrapedSeries, EnrichedSeries } from '../models/series';
import { BIGG_BOSS_TOPICS } from '../scraper/series';

interface CinemetaVideo {
  id: string;
  name?: string;
  title?: string;
  season: number;
  episode?: number;
  number?: number;
  thumbnail?: string;
  overview?: string;
  released?: string;
}

interface CinemetaSeriesMeta {
  id: string;
  name: string;
  genres?: string[];
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  imdbRating?: number;
  releaseInfo?: string;
  year?: number;
  videos?: CinemetaVideo[];
}

export async function enrichSeriesWithCinemeta(seriesList: ScrapedSeries[]): Promise<EnrichedSeries[]> {
  const enrichedList: EnrichedSeries[] = [];

  for (const s of seriesList) {
    const topicConfig = BIGG_BOSS_TOPICS.find(t => t.id === s.id || t.genre === s.genre);
    const imdbId = topicConfig?.imdbId;

    let enriched: EnrichedSeries = {
      ...s,
      imdbId,
      genres: [s.genre, 'Reality-TV'],
    };

    if (imdbId) {
      try {
        console.log(`[SeriesEnricher] Fetching Cinemeta metadata for ${s.name} (${imdbId})...`);
        const res = await axios.get<{ meta?: CinemetaSeriesMeta }>(
          `https://v3-cinemeta.strem.io/meta/series/${imdbId}.json`,
          { timeout: 10000 }
        );

        const meta = res.data?.meta;
        if (meta) {
          const allGenres = Array.from(new Set([s.genre, ...(meta.genres || []), 'Reality-TV']));
          enriched = {
            ...enriched,
            name: meta.name || s.name,
            poster: meta.poster,
            thumbnail: meta.poster,
            background: meta.background,
            logo: meta.logo,
            description: meta.description,
            imdbRating: meta.imdbRating,
            releaseInfo: meta.releaseInfo,
            year: meta.year,
            genres: allGenres,
          };

          // Enrich individual episodes if Cinemeta provides video details
          const baseTimestamp = Date.now();
          for (const ep of enriched.episodes) {
            let matchedVideo: CinemetaVideo | undefined;
            if (meta.videos && Array.isArray(meta.videos)) {
              matchedVideo = meta.videos.find(
                v => v.season === ep.season && (v.episode === ep.episode || v.number === ep.episode)
              );
            }
            if (matchedVideo) {
              if (matchedVideo.name || matchedVideo.title) {
                const daySuffix = ep.day !== undefined ? ` (Day ${ep.day})` : '';
                ep.title = `${matchedVideo.name || matchedVideo.title}${daySuffix}`;
              }
              if (matchedVideo.released) {
                ep.released = matchedVideo.released;
              }
            }
            if (!ep.released) {
              // Approximate daily release dating backward from today based on episode count
              const daysAgo = Math.max(0, enriched.episodes.length - ep.episode);
              ep.released = new Date(baseTimestamp - daysAgo * 86400000).toISOString();
            }
          }
          console.log(`[SeriesEnricher] Successfully enriched ${s.name} with Cinemeta metadata.`);
        }
      } catch (err: any) {
        console.warn(`[SeriesEnricher] Failed to fetch Cinemeta for ${s.name}:`, err.message);
      }
    }

    enrichedList.push(enriched);
  }

  return enrichedList;
}
