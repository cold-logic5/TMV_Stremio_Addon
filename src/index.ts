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

import { getRouter } from 'stremio-addon-sdk';
import express, { Request, Response } from 'express';

const app = express();

// 1. Intercept the /scrape route
// We use a query parameter secret to prevent abuse
app.get('/scrape', (req: Request, res: Response) => {
  if (req.query.secret === 'MY_SUPER_SECRET_KEY') {
    res.status(200).send('Scrape triggered in the background.\n');

    // Run the scrape in the background without making the HTTP request wait
    console.log('External scrape triggered!');
    runRefreshOnce().catch((err: any) => console.error('Scrape failed:', err));
  } else {
    res.status(401).send('Unauthorized');
  }
});

// Log all incoming requests to help debug Stremio connection
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

// 2. Otherwise, let Stremio (Express router) handle the request
const stremioRouter = getRouter(addonInterface);
app.use(stremioRouter);

app.listen(config.port, () => {
  console.log(`TamilMV Stremio addon running on http://localhost:${config.port}/manifest.json`);
});