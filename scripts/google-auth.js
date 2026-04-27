/**
 * One-time script to generate a Google OAuth2 refresh token.
 * Run this ONCE on your local machine:
 *   node scripts/google-auth.js
 *
 * Prerequisites:
 *   1. Go to console.cloud.google.com → New Project → "marketing-bot-pcg"
 *   2. APIs & Services → Enable: Gmail API, Google Drive API
 *   3. OAuth consent screen → External → add your email as test user
 *   4. Credentials → Create OAuth Client ID → Desktop app
 *   5. Download the client secret JSON → copy CLIENT_ID and CLIENT_SECRET below
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

// ── Fill these in before running ──────────────────────────────────────────────
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
// ─────────────────────────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first.');
  process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3333/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });

console.log('\n────────────────────────────────────────────');
console.log('Open this URL in your browser to authorize:');
console.log('\n' + authUrl + '\n');
console.log('────────────────────────────────────────────\n');

// Temporary local server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3333');
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code received.'); return; }

  try {
    const { tokens } = await auth.getToken(code);
    res.end('<h2>✅ Authorized! Check your terminal for the refresh token.</h2>');
    server.close();

    console.log('────────────────────────────────────────────');
    console.log('✅ SUCCESS — Add this to your Railway env vars (or .env):');
    console.log('');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('────────────────────────────────────────────\n');
  } catch (err) {
    res.end('Error getting tokens: ' + err.message);
    server.close();
  }
});

server.listen(3333, () => console.log('Waiting for Google authorization on http://localhost:3333...'));
