import { ScrapedQuality } from './movie';

export interface ScrapedEpisode {
  id: string; // e.g. '10:36'
  season: number;
  episode: number;
  day?: number;
  title: string;
  released?: string;
  qualities: ScrapedQuality[];
  rawText?: string;
}

export interface ScrapedSeries {
  id: string; // e.g. 'tamilmv-series-bigg-boss-tamil'
  name: string;
  genre: 'Tamil' | 'Telugu';
  pageUrl: string;
  topicId: string;
  episodes: ScrapedEpisode[];
  languages?: string[];
  rawText?: string;
}

export interface EnrichedSeries extends ScrapedSeries {
  imdbId?: string; // e.g. 'tt7084920'
  poster?: string;
  thumbnail?: string;
  background?: string;
  logo?: string;
  imdbRating?: number;
  genres?: string[];
  description?: string;
  year?: number;
  releaseInfo?: string;
}
