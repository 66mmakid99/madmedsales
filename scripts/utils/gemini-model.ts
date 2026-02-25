/**
 * Gemini 모델 설정 유틸
 * 환경변수 GEMINI_MODEL로 모델을 지정하고, 폴백 로직을 제공한다.
 *
 * v1.1 - 2026-02-25: API Key 모드 지원
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { isApiKeyMode, getApiKey } from '../analysis/gemini-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** 현재 설정된 Gemini 모델명 */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/** Gemini API 엔드포인트 URL 생성 (API Key 모드면 ?key= 파라미터 포함) */
export function getGeminiEndpoint(model?: string): string {
  const m = model ?? getGeminiModel();
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
  if (isApiKeyMode()) {
    return `${base}?key=${getApiKey()}`;
  }
  return base;
}
