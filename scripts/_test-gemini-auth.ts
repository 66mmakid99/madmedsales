import { getGeminiEndpoint, getGeminiModel } from './utils/gemini-model.js';
import { isApiKeyMode, getAccessToken } from './analysis/gemini-auth.js';

async function main(): Promise<void> {
  console.log('=== Gemini 인증 테스트 ===');
  console.log('모델:', getGeminiModel());
  console.log('isApiKeyMode:', isApiKeyMode());
  console.log('endpoint:', getGeminiEndpoint());

  const token = await getAccessToken();
  console.log('token:', token.substring(0, 20) + '...');

  const endpoint = getGeminiEndpoint();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${token}`;

  console.log('headers keys:', Object.keys(headers));
  console.log('URL has ?key=:', endpoint.includes('?key='));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contents: [{ parts: [{ text: 'hello' }] }] }),
  });
  console.log('status:', res.status);
  if (res.ok) {
    const data = await res.json() as Record<string, unknown>;
    console.log('✅ 성공! response preview:', JSON.stringify(data).substring(0, 150));
  } else {
    const err = await res.text();
    console.log('❌ 실패:', err.substring(0, 300));
  }
}

main().catch(console.error);
