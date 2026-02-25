/**
 * Gemini API 인증 모듈
 *
 * v5.4: API Key 방식 (우선) + Service Account JWT (fallback)
 *
 * 환경변수:
 * - GEMINI_API_KEY: API Key (우선 사용)
 * - GOOGLE_SA_KEY_PATH: Service Account JSON 경로 (fallback)
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

// ============================================================
// API Key 모드 감지
// ============================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/** API Key 모드인지 여부 */
export function isApiKeyMode(): boolean {
  return !!GEMINI_API_KEY;
}

/** API Key 반환 (API Key 모드일 때만) */
export function getApiKey(): string {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  return GEMINI_API_KEY;
}

// ============================================================
// Service Account JWT (legacy fallback)
// ============================================================
interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

let saKey: ServiceAccountKey | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function loadSaKey(): Promise<ServiceAccountKey> {
  if (saKey) return saKey;
  const saKeyPath = process.env.GOOGLE_SA_KEY_PATH;
  if (!saKeyPath) throw new Error('Neither GEMINI_API_KEY nor GOOGLE_SA_KEY_PATH is set');
  saKey = JSON.parse(await fs.readFile(path.resolve(__dirname, '..', saKeyPath), 'utf-8'));
  return saKey!;
}

/**
 * 액세스 토큰 반환
 * - API Key 모드면 API Key를 그대로 반환 (호출부에서 구분)
 * - SA 모드면 JWT로 access_token 발급
 */
export async function getAccessToken(): Promise<string> {
  // API Key 모드: 더미 토큰 반환 (실제로는 사용 안됨, 엔드포인트에 ?key= 붙이기 때문)
  if (GEMINI_API_KEY) return 'api_key_mode';

  // SA 모드
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const key = await loadSaKey();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/generative-language',
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key.private_key);
  const jwt = `${header}.${payload}.${signature.toString('base64url')}`;

  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });

  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}
