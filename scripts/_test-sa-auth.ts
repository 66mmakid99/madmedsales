import { getAccessToken, isApiKeyMode } from './analysis/gemini-auth.js';

// 강제로 GEMINI_API_KEY 제거
delete process.env.GEMINI_API_KEY;

console.log('API Key 모드:', isApiKeyMode());
const token = await getAccessToken();
console.log('SA 토큰 길이:', token.length);
console.log('SA 인증 OK');
