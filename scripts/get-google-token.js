/**
 * Run this once to get your Google OAuth refresh token.
 * Usage: node scripts/get-google-token.js
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:4000/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in your .env file.');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.modify',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n=== Google OAuth Setup ===\n');
console.log('Opening browser for Google sign-in...');
console.log('\nIf it does not open automatically, visit this URL:\n');
console.log(authUrl);
console.log('\nWaiting for you to approve access...\n');

// Start a temporary local server to catch the redirect
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/oauth2callback') return;

  const code = parsed.query.code;
  if (!code) {
    res.end('No code received. Please try again.');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.end('<h2>Success! You can close this tab and go back to Terminal.</h2>');
    server.close();

    console.log('=== SUCCESS ===\n');
    console.log('Add this to your .env file:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nDone! You only need to do this once.');
  } catch (err) {
    res.end('Error getting token: ' + err.message);
    server.close();
    console.error('\nERROR:', err.message);
  }
});

server.listen(4000, () => {
  // Try to open the browser automatically
  const { exec } = require('child_process');
  exec(`open "${authUrl}"`);
});
