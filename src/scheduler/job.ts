// import cron from 'node-cron';
// import { scrapeTamilMV } from '../scraper/tamilmv';
// import { enrichMoviesWithImdb } from '../services/imdb';
// import { saveMovies } from '../services/cache';
// import { config } from '../services/config';

// export async function runRefreshOnce(): Promise<void> {
//   const scraped = await scrapeTamilMV();
//   // Limit for testing: only keep the first 10 scraped movies
//   // const limited = scraped.slice(0, 10);
//   // eslint-disable-next-line no-console
//   console.log(`TamilMV scraped count: ${scraped.length}`);

//   const enriched = await enrichMoviesWithImdb(scraped);
//   await saveMovies(enriched);
//   // eslint-disable-next-line no-console
//   console.log(`TamilMV enriched & saved count: ${enriched.length}`);
// }

// export function scheduleDailyRefresh(): void {
//   cron.schedule(config.dailyCron, () => {
//     void runRefreshOnce();
//   });
// }

// // When this file is run directly via `npm run scrape:once`,
// // execute a single refresh and then exit.
// if (require.main === module) {
//   void runRefreshOnce()
//     .then(() => {
//       // eslint-disable-next-line no-console
//       console.log('TamilMV refresh completed.');
//       process.exit(0);
//     })
//     .catch((err) => {
//       // eslint-disable-next-line no-console
//       console.error('TamilMV refresh failed:', err);
//       process.exit(1);
//     });
// }

