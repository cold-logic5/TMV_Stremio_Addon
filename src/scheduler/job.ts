import cron from 'node-cron';
import { scrapeTamilMV } from '../scraper/tamilmv';
import { scrapeBiggBossSeries } from '../scraper/series';
import { enrichMoviesWithImdb } from '../services/imdb';
import { enrichSeriesWithCinemeta } from '../services/seriesEnricher';
import { saveMovies, saveSeries } from '../services/cache';
import { config } from '../services/config';
import { getBatchTorrentHealth } from '../services/torrent';

export async function runRefreshOnce(): Promise<void> {
    const scraped = await scrapeTamilMV();
    // eslint-disable-next-line no-console
    console.log(`TamilMV scraped count: ${scraped.length}`);

    const enriched = await enrichMoviesWithImdb(scraped);

    // Fetch torrent health for all qualities of all movies
    // eslint-disable-next-line no-console
    console.log('[Scheduler] Fetching torrent health for all movies...');
    for (let i = 0; i < enriched.length; i++) {
        const movie = enriched[i]!;
        if (i % 10 === 0) {
            // eslint-disable-next-line no-console
            console.log(`[Scheduler] Progress: ${i}/${enriched.length} movies processed...`);
        }
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

    await saveMovies(enriched);
    // eslint-disable-next-line no-console
    console.log(`TamilMV enriched & saved count: ${enriched.length}`);

    // 2. Scrape & enrich Bigg Boss Series (Tamil & Telugu)
    try {
        console.log('[Scheduler] Scraping Bigg Boss series...');
        const scrapedSeries = await scrapeBiggBossSeries();
        console.log(`[Scheduler] Bigg Boss series scraped count: ${scrapedSeries.length}`);

        const enrichedSeries = await enrichSeriesWithCinemeta(scrapedSeries);

        // Fetch torrent health for the latest 5 episodes of each series
        console.log('[Scheduler] Fetching torrent health for latest Bigg Boss episodes...');
        for (const s of enrichedSeries) {
            const recentEpisodes = s.episodes.slice(-5);
            for (const ep of recentEpisodes) {
                await getBatchTorrentHealth(
                    ep.qualities,
                    (q) => q.url,
                    (q, health) => {
                        q.seeders = health.seeds;
                        q.leechers = health.leechers;
                    },
                    5
                );
            }
        }

        await saveSeries(enrichedSeries);
        console.log(`[Scheduler] Bigg Boss series enriched & saved count: ${enrichedSeries.length}`);
    } catch (err: any) {
        console.error('[Scheduler] Bigg Boss series refresh failed:', err.message);
    }
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

