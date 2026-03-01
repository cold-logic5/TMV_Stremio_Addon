# Stremio Addon Tamil

A Stremio addon for Tamil movies and content, built with Node.js and TypeScript. It features a web scraper, IMDb integration, and Redis caching.

## Features
- Scrapes Tamil movies and serves them to Stremio.
- Integrates with IMDb for metadata.
- Redis caching to improve performance and avoid rate limits.
- Automated scraping jobs.

## Prerequisites
- Node.js (v18+ recommended)
- Redis Server (for caching)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file in the root directory and add your required environment variables (like Redis connection details).

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Start the production server:**
   ```bash
   npm start
   ```

## Available Scripts
- `npm run dev`: Starts the development server with auto-reload (`ts-node-dev`).
- `npm run build`: Compiles the TypeScript code to JavaScript in the `dist/` folder.
- `npm start`: Runs the compiled JavaScript.
- `npm run scrape:once`: Runs the scraping job once manually.

## License
This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for details.
