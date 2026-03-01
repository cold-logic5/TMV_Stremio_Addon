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

// Create the Stremio handler
const stremioHandler = serveHTTP(addonInterface);

const server = http.createServer((req, res) => {
  // 1. Intercept the /scrape route
  // We use a query parameter secret to prevent abuse
  if (req.url === '/scrape?secret=MY_SUPER_SECRET_KEY') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Scrape triggered in the background.\n');

    // Run the scrape in the background without making the HTTP request wait
    console.log('External scrape triggered!');
    runRefreshOnce().catch((err: any) => console.error('Scrape failed:', err));
    return;
  }

  // 2. Otherwise, let Stremio handle the request
  stremioHandler(req, res);
});

server.listen(config.port, () => {
  console.log(`TamilMV Stremio addon running on http://localhost:${config.port}/manifest.json`);
});