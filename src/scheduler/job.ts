import cron from 'node-cron';
import { scrapeTamilMV, extractTopicIdentifier } from '../scraper/tamilmv';
import { enrichMoviesWithImdb } from '../services/imdb';
import { saveMovies, getAllCachedMovies } from '../services/cache';
import { config } from '../services/config';
import { getBatchTorrentHealth } from '../services/torrent';

export async function runRefreshOnce(): Promise<void> {
    console.log('[Scheduler] Loading existing movies from database...');
    const existingMovies = await getAllCachedMovies();
    console.log(`[Scheduler] Existing catalog has ${existingMovies.length} movies.`);

    // Build a Set of all known topic identifiers and URLs
    const knownTopics = new Set<string>();
    for (const m of existingMovies) {
        if (m.pageUrl) {
            knownTopics.add(extractTopicIdentifier(m.pageUrl));
            knownTopics.add(m.pageUrl);
        }
    }

    // Scrape only NEW topics from TamilMV
    const scraped = await scrapeTamilMV(knownTopics);
    console.log(`[Scheduler] Scraped ${scraped.length} NEW movies from TamilMV.`);

    if (scraped.length === 0) {
        console.log('[Scheduler] No new movies found on TamilMV homepage. Database is up to date.');
        return;
    }

    // Enrich ONLY the new movies with IMDb metadata (saving 95%+ of API quota)
    console.log(`[Scheduler] Enriching ${scraped.length} new movies with IMDb metadata...`);
    const enriched = await enrichMoviesWithImdb(scraped);

    // Fetch torrent health for all qualities of the NEW movies
    console.log(`[Scheduler] Fetching torrent health for ${enriched.length} new movies...`);
    for (let i = 0; i < enriched.length; i++) {
        const movie = enriched[i]!;
        await getBatchTorrentHealth(
            movie.qualities,
            (q) => q.url,
            (q, health) => {
                q.seeders = health.seeds;
                q.leechers = health.leechers;
            },
            5
        );
    }

    // Merge new movies into existing catalog, deduplicate, and trim to max limit (e.g. 500)
    await saveMovies(enriched, existingMovies);
    console.log(`[Scheduler] Refresh completed successfully.`);
}

export function scheduleDailyRefresh(): void {
    cron.schedule(config.dailyCron, () => {
        void runRefreshOnce();
    });
}

// When this file is run directly via `npm run scrape:once`,
// execute a single refresh and then exit.
if (require.main === module) {
    void runRefreshOnce()
        .then(() => {
            // eslint-disable-next-line no-console
            console.log('TamilMV refresh completed.');
            process.exit(0);
        })
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('TamilMV refresh failed:', err);
            process.exit(1);
        });
}
