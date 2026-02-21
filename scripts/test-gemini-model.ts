/**
 * Gemini 모델 연결 테스트
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { getAccessToken } from './analysis/gemini-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
console.log('Model:', model);

const token = await getAccessToken();
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

try {
  const resp = await axios.post(url, {
    contents: [{ parts: [{ text: 'Say hello in one word' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 20 },
  }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
  console.log('SUCCESS:', resp.data.candidates?.[0]?.content?.parts?.[0]?.text);
  console.log('ModelVersion:', resp.data.modelVersion);
} catch (e: unknown) {
  const err = e as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
  console.log('ERROR:', err.response?.status, err.response?.data?.error?.message || err.message);
}
