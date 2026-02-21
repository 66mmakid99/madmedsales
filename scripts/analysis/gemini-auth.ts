/**
 * Google Service Account JWT authentication for Gemini API.
 * Extracted from analyze-web.ts for reuse across analysis modules.
 */
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SA_KEY_PATH = process.env.GOOGLE_SA_KEY_PATH;
if (!SA_KEY_PATH) {
  throw new Error('Missing GOOGLE_SA_KEY_PATH in scripts/.env');
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

const saKey: ServiceAccountKey = JSON.parse(
  await fs.readFile(path.resolve(__dirname, '..', SA_KEY_PATH), 'utf-8')
);

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: saKey.client_email,
    scope: 'https://www.googleapis.com/auth/generative-language',
    aud: saKey.token_uri,
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), saKey.private_key);
  const jwt = `${header}.${payload}.${signature.toString('base64url')}`;

  const res = await axios.post(saKey.token_uri, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

  cachedToken = { token: res.data.access_token, expiresAt: Date.now() + res.data.expires_in * 1000 };
  return cachedToken.token;
}
