/**
 * Gemini 모델 설정 유틸
 * 환경변수 GEMINI_MODEL로 모델을 지정하고, 폴백 로직을 제공한다.
 *
 * v1.0 - 2026-02-22
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_MODEL = 'gemini-2.5-pro';

/** 현재 설정된 Gemini 모델명 */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

/** Gemini API 엔드포인트 URL 생성 */
export function getGeminiEndpoint(model?: string): string {
  const m = model ?? getGeminiModel();
  return `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
}
