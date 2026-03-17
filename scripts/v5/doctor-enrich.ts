/**
 * doctor-enrich.ts
 *
 * 데이터 미비 의사를 웹 검색(Puppeteer Google)으로 보강
 * Gemini를 사용해 검색 결과에서 education/career/academic 구조화 추출
 *
 * v1.0 - 2026-03-02
 */

import puppeteer, { type Browser, type Page } from 'puppeteer';
import { getAccessToken, isApiKeyMode } from '../analysis/gemini-auth.js';
import { getGeminiEndpoint } from '../utils/gemini-model.js';
import type { StructuredAcademic, AcademicType } from './types.js';
import { normalizeDoctorFields } from './doctor-normalize.js';

// ============================================================
// 설정
// ============================================================

const MAX_ENRICH_PER_HOSPITAL = 10;
const SEARCH_DELAY_MS = 2000;
const GEMINI_TIMEOUT = 30000;

// ============================================================
// 보강 필요 여부 판정
// ============================================================

export function needsEnrichment(doctor: {
  education?: string | string[] | null;
  career?: string | string[] | null;
  academic_activity?: string | null;
}): boolean {
  const isEmpty = (val: string | string[] | null | undefined): boolean => {
    if (!val) return true;
    if (Array.isArray(val)) return val.length === 0;
    return val.trim().length === 0;
  };

  let emptyCount = 0;
  if (isEmpty(doctor.education)) emptyCount++;
  if (isEmpty(doctor.career)) emptyCount++;
  if (isEmpty(doctor.academic_activity)) emptyCount++;

  return emptyCount >= 2;
}

// ============================================================
// 웹 검색 + Gemini 추출
// ============================================================

interface EnrichResult {
  education: string[];
  career: string[];
  academic_activities: StructuredAcademic[];
  source: 'web_search';
}

async function searchGoogle(
  page: Page,
  query: string,
): Promise<string> {
  try {
    const encoded = encodeURIComponent(query);
    await page.goto(`https://www.google.com/search?q=${encoded}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await new Promise(r => setTimeout(r, 1500));
    const text = await page.evaluate(() => document.body.innerText);
    return text.substring(0, 8000); // 토큰 절약
  } catch {
    return '';
  }
}

function buildEnrichPrompt(doctorName: string, hospitalName: string, searchText: string): string {
  return `다음은 "${hospitalName}" 소속 의사 "${doctorName}"에 대한 웹 검색 결과입니다.

검색 결과에서 해당 의사의 정보만 정확히 추출하세요.
동명이인이나 다른 병원 소속 정보는 제외하세요.

## 추출 규칙
1. education: 대학 졸업, 인턴, 레지던트, 전공의, 전문의 취득, 석사/박사
2. career: (전)/(현) 병원 원장/과장, 교수, 군의관
3. academic_activities: 아래 type으로 분류
   - 학회정회원: ~학회 정회원/종신회원
   - 학회임원: ~학회 회장/이사/위원장
   - 논문: SCI/SCIE/KCI 논문
   - 수상: 학술상/최우수상 수상
   - 교과서집필: 교과서 집필/저자
   - 편집위원: 편집위원/reviewer
   - 강연: 초청강연/연자/좌장
   - 임상연구: 임상연구/PI
   - 기타: 위에 해당하지 않는 학술활동

## 출력 형식 (JSON만 출력, 다른 텍스트 없음)
{
  "education": ["문자열 배열"],
  "career": ["문자열 배열"],
  "academic_activities": [
    { "type": "학회정회원", "title": "대한피부과학회 정회원", "year": "2020" }
  ]
}

확인되지 않는 정보는 빈 배열로 두세요. 추측하지 마세요.

검색 결과:
${searchText}`;
}

async function callGeminiForEnrich(prompt: string): Promise<EnrichResult | null> {
  try {
    const accessToken = await getAccessToken();
    const endpoint = getGeminiEndpoint();

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    if (!text) return null;

    const parsed = JSON.parse(text) as {
      education?: string[];
      career?: string[];
      academic_activities?: Array<{ type: string; title: string; year?: string }>;
    };

    const academics: StructuredAcademic[] = (parsed.academic_activities || []).map(a => ({
      type: (a.type || '기타') as AcademicType,
      title: a.title,
      year: a.year || null,
      source_text: a.title,
    }));

    return {
      education: parsed.education || [],
      career: parsed.career || [],
      academic_activities: academics,
      source: 'web_search',
    };
  } catch {
    return null;
  }
}

// ============================================================
// 배치 보강 실행
// ============================================================

interface DoctorForEnrich {
  name: string;
  education?: string | string[] | null;
  career?: string | string[] | null;
  academic_activity?: string | null;
  structured_academic?: StructuredAcademic[];
  [key: string]: unknown;
}

export async function enrichDoctorBatch(
  doctors: DoctorForEnrich[],
  hospitalName: string,
  hospitalId: string,
): Promise<{ enrichedNames: string[] }> {
  const toEnrich = doctors.filter(d => needsEnrichment(d) && d.name !== '원장 (이름 미확인)');
  if (toEnrich.length === 0) return { enrichedNames: [] };

  const batch = toEnrich.slice(0, MAX_ENRICH_PER_HOSPITAL);
  console.log(`  🔍 [v5.6] 의사 데이터 웹 보강 (${batch.length}/${toEnrich.length}명)...`);

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log(`    ⚠️ Puppeteer 실행 실패: ${err}`);
    return { enrichedNames: [] };
  }

  const enrichedNames: string[] = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    for (const doctor of batch) {
      try {
        // 1차 검색: 병원명 + 의사명 + 약력
        const query1 = `${hospitalName} ${doctor.name} 약력 학력 경력`;
        let searchText = await searchGoogle(page, query1);
        await new Promise(r => setTimeout(r, SEARCH_DELAY_MS));

        // 검색 결과가 부족하면 2차 검색
        if (searchText.length < 500) {
          const query2 = `${doctor.name} 의사 논문 학회`;
          const text2 = await searchGoogle(page, query2);
          searchText = searchText + '\n\n' + text2;
          await new Promise(r => setTimeout(r, SEARCH_DELAY_MS));
        }

        if (searchText.length < 200) {
          console.log(`    ⚠️ ${doctor.name}: 검색 결과 부족 — skip`);
          continue;
        }

        // Gemini로 구조화 추출
        const prompt = buildEnrichPrompt(doctor.name, hospitalName, searchText);
        const enriched = await callGeminiForEnrich(prompt);

        if (!enriched) {
          console.log(`    ⚠️ ${doctor.name}: Gemini 추출 실패 — skip`);
          continue;
        }

        // 기존 데이터와 병합
        const existingEdu = toArray(doctor.education);
        const existingCareer = toArray(doctor.career);
        const existingAcademic = doctor.structured_academic || [];

        const mergedEdu = [...existingEdu, ...enriched.education];
        const mergedCareer = [...existingCareer, ...enriched.career];
        const mergedAcademic = [...existingAcademic, ...enriched.academic_activities];

        // 정규화 + 중복제거
        const normalized = normalizeDoctorFields({
          education: mergedEdu.join('\n'),
          career: mergedCareer.join('\n'),
          academic_activity: mergedAcademic.map(a => `[${a.type}] ${a.title}`).join(', '),
        });

        doctor.education = normalized.education.join('\n') || null;
        doctor.career = normalized.career.join('\n') || null;
        doctor.structured_academic = normalized.academic_activities;
        if (normalized.academic_activities.length > 0) {
          doctor.academic_activity = normalized.academic_activities
            .map(a => `[${a.type}] ${a.title}`)
            .join(', ');
        }

        (doctor as Record<string, unknown>).enrichment_source = 'web_search';
        enrichedNames.push(doctor.name);
        console.log(`    ✅ ${doctor.name}: 보강 완료 (edu=${normalized.education.length}, career=${normalized.career.length}, academic=${normalized.academic_activities.length})`);
      } catch (err) {
        console.log(`    ⚠️ ${doctor.name} 보강 실패: ${(err as Error).message}`);
      }
    }

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    console.log(`    ❌ 웹 보강 중단: ${(err as Error).message}`);
  }

  return { enrichedNames };
}

// ============================================================
// 유틸
// ============================================================

function toArray(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split(/\n|,\s*/).map(v => v.trim()).filter(Boolean);
}
