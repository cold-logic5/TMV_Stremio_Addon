import dotenv from 'dotenv';

dotenv.config();

export const config = { 
  port: parseInt(process.env.PORT ?? '7000', 10),
  redisUrl: process.env.REDIS_URL ?? '',
  dataUrl: process.env.DATA_URL ?? '',
  gistId: process.env.GIST_ID ?? process.env.GITHUB_GIST_ID ?? '',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  dataRefreshMinutes: parseInt(process.env.DATA_REFRESH_MINUTES ?? '15', 10),
  imdbApiKey: process.env.IMDB_API_KEY ?? '',
  cinemataApiKey: process.env.CINEMATA_API_KEY ?? '',
  tamilmvBaseUrl: process.env.TAMILMV_BASE_URL ?? 'https://www.1tamilmv.observer',
  dailyCron: process.env.DAILY_CRON ?? '0 3 * * *',
  maxScrapeLimit: parseInt(process.env.MAX_SCRAPE_LIMIT ?? '200', 10),
};


