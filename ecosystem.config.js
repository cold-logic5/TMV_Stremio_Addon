// PM2 process definition for running the addon 24/7 on a VPS (Oracle Cloud, etc.)
// Usage: pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'inmax-addon',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: 7000,
        // Catalog is pulled from GitHub (updated by the GitHub Actions scraper) every 15 minutes
        DATA_URL: 'https://raw.githubusercontent.com/cold-logic5/TMV_Stremio_Addon/main/data/movies.json',
        DATA_REFRESH_MINUTES: 15,
        TAMILMV_BASE_URL: 'https://www.1tamilmv.fi/',
      },
    },
  ],
};
