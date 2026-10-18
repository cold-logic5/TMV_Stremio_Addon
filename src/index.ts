import http from 'http';
import { serveHTTP } from 'stremio-addon-sdk';
import { addonInterface, manifest } from './stremio/addon';
import { config } from './services/config';
// import { scheduleDailyRefresh } from './scheduler/job';

// const server = http
//   .createServer(serveHTTP(addonInterface))
//   .on('listening', () => {
//     // eslint-disable-next-line no-console
//     console.log(`TamilMV Stremio addon running on http://localhost:${config.port}/manifest.json`);
//   });

// server.listen(config.port);

// scheduleDailyRefresh();

// export { manifest };

import { runRefreshOnce } from './scheduler/job'; // Import the direct run function
import { initCache } from './services/cache';
import { getRouter } from 'stremio-addon-sdk';
import express, { Request, Response } from 'express';

const app = express();

// 1. Intercept the /scrape route
// We use a query parameter secret to prevent abuse
app.get('/scrape', (req: Request, res: Response) => {
  if (req.query.secret === 'MY_SUPER_SECRET_KEY') {
    if (req.query.reload === 'true') {
      initCache()
        .then(() => console.log('[HTTP] Cache reloaded successfully via /scrape.'))
        .catch((err) => console.error('[HTTP] Cache reload failed:', err));
      res.status(200).send('Cache reload triggered.\n');
      return;
    }

    res.status(200).send('Scrape triggered in the background.\n');

    // Run the scrape in the background without making the HTTP request wait
    console.log('External scrape triggered!');
    runRefreshOnce().catch((err: any) => console.error('Scrape failed:', err));
  } else {
    res.status(401).send('Unauthorized');
  }
});

// 2. Fast cache reload endpoint to re-sync data/movies.json from GitHub without running full scrape
app.get('/reload', async (req: Request, res: Response) => {
  try {
    console.log('[HTTP] Manual cache reload triggered');
    await initCache();
    res.status(200).send('Cache reloaded from DATA_URL successfully.\n');
  } catch (err: any) {
    res.status(500).send(`Cache reload failed: ${err.message}\n`);
  }
});

// 3. Health check for Render.com / monitoring
app.get('/health', (req, res) => res.status(200).send('OK'));

// Log all incoming requests to help debug Stremio connection
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// 3. Otherwise, let Stremio (Express router) handle the request
const stremioRouter = getRouter(addonInterface);
app.use(stremioRouter);

// 4. Keep-Alive logic for Render's Free Tier
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
if (EXTERNAL_URL) {
  const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes
  setInterval(() => {
    import('axios').then(axios => {
        axios.default.get(`${EXTERNAL_URL}/manifest.json`)
          .then(() => console.log('[Keep-Alive] Pinged self successfully'))
          .catch(err => console.error('[Keep-Alive] Self-ping failed:', err.message));
    });
  }, PING_INTERVAL);
  console.log(`[Keep-Alive] Pinging self every 10 minutes at: ${EXTERNAL_URL}`);
}

// Initialize in-memory cache from remote CDN / Gist / local disk
void initCache();

app.listen(config.port, () => {
  console.log(`TamilMV Stremio addon running on http://localhost:${config.port}/manifest.json`);
});