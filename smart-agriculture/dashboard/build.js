/**
 * Simple build script — injects env variables into app.js
 * Reads from .env (local) or Vercel environment variables (production)
 */
require('dotenv').config();
const fs = require('fs');

const API_URL  = process.env.VITE_API_URL  || 'http://localhost:3000/api';
const WS_URL   = process.env.VITE_WS_URL   || 'ws://localhost:3000';
const PASSWORD = process.env.VITE_PASSWORD || 'agri2024';

let appJs = fs.readFileSync('./app.js', 'utf8');

// Replace placeholders
appJs = appJs
  .replace('__WS_URL__',   WS_URL)
  .replace('__API_URL__',  API_URL)
  .replace('__PASSWORD__', PASSWORD);

fs.writeFileSync('./app.dist.js', appJs);

// Update index.html to use app.dist.js
let html = fs.readFileSync('./index.html', 'utf8');
html = html.replace('src="app.js"', 'src="app.dist.js"');
fs.writeFileSync('./index.dist.html', html);

console.log(`Built with:
  WS_URL:   ${WS_URL}
  API_URL:  ${API_URL}
  PASSWORD: ${'*'.repeat(PASSWORD.length)}`);
