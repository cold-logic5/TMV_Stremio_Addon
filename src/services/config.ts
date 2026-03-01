import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  port: parseInt(process.env.PORT ?? '7000', 10),
  redisUrl: requiredEnv('REDIS_URL', 'redis://127.0.0.1:6379'),
  imdbApiKey: process.env.IMDB_API_KEY ?? '',
  cinemataApiKey: process.env.CINEMATA_API_KEY ?? '',
  tamilmvBaseUrl: process.env.TAMILMV_BASE_URL ?? 'https://www.tamilmv.vin',
  dailyCron: process.env.DAILY_CRON ?? '0 3 * * *',
};

