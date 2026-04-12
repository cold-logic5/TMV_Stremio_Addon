export interface ScrapedQuality {
  quality: '2160p' | '1080p' | '720p' | '480p' | string;
  type: 'magnet';
  url: string;
  seeders?: number;
  leechers?: number;
  languages?: string[];
}

export interface ScrapedMovie {
  id: string;
  rawTitle: string;
  titleGuess?: string;
  yearGuess?: number;
  pageUrl: string;
  qualities: ScrapedQuality[];
  rawText?: string;
  languages?: string[];
}

export interface EnrichedMovie extends ScrapedMovie {
  imdbId?: string;
  name?: string;
  year?: number;
  poster?: string;
  thumbnail?: string;
  imdbRating?: number;
  genres?: string[];
  description?: string;
}

export interface CatalogMovie {
  id: string;
  type: 'movie';
  name: string;
  poster?: string;
  thumbnail?: string;
  year?: number;
  genres?: string[];
  description?: string;
  imdbRating?: number;
}

