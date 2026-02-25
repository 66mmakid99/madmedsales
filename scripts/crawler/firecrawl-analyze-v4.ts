/**
 * Firecrawl 4차 E2E: Phase 2 Gemini 분석
 * 3차 대비 변경: maxOutputTokens 8000 → 16000 (JSON 잘림 방지)
 *
 * 실행: npx tsx scripts/crawler/firecrawl-analyze-v4.ts
 * 단일: npx tsx scripts/crawler/firecrawl-analyze-v4.ts --name "815의원"
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getGeminiEndpoint, getGeminiModel } from '../utils/gemini-model.js';
import { getAccessToken } from '../analysis/gemini-auth.js';
import {
  getEquipmentPromptSection,
  getTreatmentPromptSection,
  getPricePromptSection,
  getExcludePromptSection,
} from './dictionary-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SNAPSHOTS_DIR = path.resolve(__dirname, '../../snapshots');
const MAX_TEXT = 200000;
const MAX_OUTPUT_TOKENS = 16000; // 3차: 8000 → 4차: 16000

interface AnalysisResult {
  hospitalName: string;
  success: boolean;
  equipments: Array<{
    equipment_name: string;
    equipment_brand?: string;
    equipment_category?: string;
    manufacturer?: string;
  }>;
  treatments: Array<{
    treatment_name: string;
    treatment_category?: string;
    price?: number;
    price_min?: number;
    price_max?: number;
    is_promoted?: boolean;
  }>;
  doctors: Array<{
    name: string;
    title?: string;
    specialty?: string;
  }>;
  prices: number;
  operatingHours?: string;
  events: string[];
  specialties: string[];
  hospitalInfo: {
    main_focus?: string;
    target_audience?: string;
    sns_channels?: string[];
  };
  markdownLength: number;
  pagesUsed: number;
  elapsed: number;
  geminiTokensIn: number;
  geminiTokensOut: number;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function findV4SnapshotDir(): Promise<string> {
  const entries = await fs.readdir(SNAPSHOTS_DIR);
  // v4 스냅샷 폴더 우선 (YYYY-MM-DD-v4), 없으면 최신 날짜
  const v4Dirs = entries.filter((e) => e.endsWith('-v4')).sort().reverse();
  if (v4Dirs.length > 0) {
    return path.join(SNAPSHOTS_DIR, v4Dirs[0]);
  }
  const dates = entries.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort().reverse();
  if (dates.length === 0) {
    throw new Error('snapshots/ 폴더에 캡처 데이터가 없습니다.');
  }
  return path.join(SNAPSHOTS_DIR, dates[0]);
}

async function readMarkdowns(hospitalDir: string): Promise<{ combined: string; pageCount: number }> {
  const entries = await fs.readdir(hospitalDir);
  const pageDirs = entries.filter((e) => e.startsWith('page-')).sort();

  const parts: string[] = [];
  let pageCount = 0;

  for (const pd of pageDirs) {
    const mdPath = path.join(hospitalDir, pd, 'content.md');
    try {
      const md = await fs.readFile(mdPath, 'utf-8');
      if (md.trim().length > 50) {
        let sourceUrl = '';
        try {
          const metaStr = await fs.readFile(path.join(hospitalDir, pd, 'metadata.json'), 'utf-8');
          const meta = JSON.parse(metaStr) as Record<string, unknown>;
          sourceUrl = (meta.sourceURL ?? meta.url ?? '') as string;
        } catch { /* ignore */ }

        parts.push(`\n=== PAGE: ${sourceUrl || pd} ===\n${md}`);
        pageCount++;
      }
    } catch { /* no markdown file */ }
  }

  return { combined: parts.join('\n\n').slice(0, MAX_TEXT), pageCount };
}

async function analyzeWithGemini(
  hospitalName: string,
  combinedMarkdown: string
): Promise<{ data: Record<string, unknown> | null; tokensIn: number; tokensOut: number }> {
  const token = await getAccessToken();
  const url = getGeminiEndpoint();

  const prompt = `당신은 한국 피부과/미용의원 웹사이트 분석 전문가입니다.
아래는 "${hospitalName}" 병원 웹사이트의 여러 페이지를 크롤링한 markdown 텍스트입니다.

## 분석 요청
아래 10개 카테고리 모두 빠짐없이 추출하세요:

### 1. 보유 장비 (equipments)
- 장비명, 브랜드, 카테고리(리프팅/레이저/바디/스킨부스터/기타), 제조사
- 한국 피부과 장비 이중분류: 장비명 = 시술명. 장비명이 시술/이벤트/가격표 어디에든 등장하면 equipments에 반드시 포함.
- 사전에 없는 장비도 발견하면 반드시 추출 (unregistered_equipment에 추가).

${getEquipmentPromptSection()}

### 2. 시술 메뉴 (treatments)
- 시술명, 카테고리, 가격 (있으면)
- is_promoted: 이벤트/할인 여부
- 사전에 없는 시술도 추출 (unregistered_treatments에 추가).

${getTreatmentPromptSection()}

### 3. 가격 정보 (prices)
- 한국 가격 패턴: "55만원"=550000, "39만"=390000, "5.5만"=55000
- 이벤트 가격도 포함

${getPricePromptSection()}

### 4. 의료진 (doctors)
- 이름, 직함 (원장/부원장/전문의), 전문분야

### 5. 진료시간 (operating_hours)
- 평일, 토요일, 일요일, 공휴일, 점심시간

### 6. 이벤트/프로모션 (events)
- 현재 진행 중인 이벤트, 할인, 특가

### 7. 전문 분야 (specialties)
- 병원의 주요 시술 분야 (리프팅, 피부질환, 바디, 안티에이징 등)

### 8. 병원 기본 정보 (hospital_info)
- 주소, 전화번호, 이메일
- 개원년도 (추정 가능하면)
- 체인/프랜차이즈 여부

### 9. SNS 채널 (sns_channels)
- 인스타그램, 유튜브, 블로그, 카카오톡 등 URL

### 10. 병원 프로필 (hospital_profile)
- main_focus: 주력 시술 분야
- target_audience: 주요 타겟 고객층
- investment_level: 장비 투자 수준 (high/medium/low)

## 응답 형식 (JSON)
\`\`\`json
{
  "equipments": [
    {"equipment_name": "써마지FLX", "equipment_brand": "Solta Medical", "equipment_category": "리프팅/타이트닝", "manufacturer": "Bausch+Lomb"}
  ],
  "treatments": [
    {"treatment_name": "써마지FLX", "treatment_category": "리프팅", "price": 550000, "price_min": null, "price_max": null, "is_promoted": false}
  ],
  "doctors": [
    {"name": "홍길동", "title": "원장", "specialty": "피부과전문의"}
  ],
  "operating_hours": "평일 10:00-19:00, 토 10:00-15:00, 일·공휴일 휴진, 점심 13:00-14:00",
  "events": ["써마지 50만원 특가", "첫방문 10% 할인"],
  "specialties": ["리프팅", "안티에이징", "피부질환"],
  "hospital_info": {
    "address": "서울시 강남구...",
    "phone": "02-1234-5678",
    "email": "info@example.com",
    "is_franchise": false,
    "estimated_year": 2015
  },
  "sns_channels": ["https://instagram.com/...", "https://youtube.com/..."],
  "hospital_profile": {
    "main_focus": "안티에이징 리프팅",
    "target_audience": "30-50대 여성",
    "investment_level": "high"
  },
  "unregistered_equipment": ["사전에 없는 장비명 원문"],
  "unregistered_treatments": ["사전에 없는 시술명 원문"],
  "raw_price_texts": ["파싱 실패한 가격 원문 텍스트"]
}
\`\`\`

반드시 위 JSON 형식만 출력하세요. 설명 텍스트 없이 JSON만.

## 웹사이트 텍스트
${combinedMarkdown}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const tokensIn = json.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = json.usageMetadata?.candidatesTokenCount ?? 0;
  const finishReason = json.candidates?.[0]?.finishReason ?? 'unknown';
  console.log(`  Gemini tokens: in=${tokensIn}, out=${tokensOut}, finish=${finishReason}`);

  if (finishReason === 'MAX_TOKENS') {
    console.warn(`  ⚠️ MAX_TOKENS 도달! maxOutputTokens=${MAX_OUTPUT_TOKENS} 여전히 부족`);
  }

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { data: null, tokensIn, tokensOut };

  try {
    return { data: JSON.parse(text) as Record<string, unknown>, tokensIn, tokensOut };
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return { data: JSON.parse(jsonMatch[0]) as Record<string, unknown>, tokensIn, tokensOut };
      } catch {
        // fall through
      }
    }
    console.error(`  JSON 파싱 실패 (${text.length}자): ${text.slice(0, 200)}...${text.slice(-100)}`);
    return { data: null, tokensIn, tokensOut };
  }
}

async function analyzeHospital(hospitalDir: string, hospitalName: string): Promise<AnalysisResult> {
  const startTime = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== ${hospitalName} Gemini 분석 (4차, maxTokens=${MAX_OUTPUT_TOKENS}) ===`);

  try {
    const { combined, pageCount } = await readMarkdowns(hospitalDir);
    console.log(`  Markdown: ${combined.length.toLocaleString()}자, ${pageCount}페이지`);

    if (combined.length < 100) {
      console.log(`  ⚠️ 텍스트 부족 (${combined.length}자) — 분석 건너뜀`);
      return {
        hospitalName, success: false, equipments: [], treatments: [], doctors: [],
        prices: 0, events: [], specialties: [], hospitalInfo: {},
        markdownLength: combined.length, pagesUsed: pageCount,
        elapsed: (Date.now() - startTime) / 1000,
        geminiTokensIn: 0, geminiTokensOut: 0,
        error: '텍스트 부족',
      };
    }

    const { data: result, tokensIn, tokensOut } = await analyzeWithGemini(hospitalName, combined);
    if (!result) {
      return {
        hospitalName, success: false, equipments: [], treatments: [], doctors: [],
        prices: 0, events: [], specialties: [], hospitalInfo: {},
        markdownLength: combined.length, pagesUsed: pageCount,
        elapsed: (Date.now() - startTime) / 1000,
        geminiTokensIn: tokensIn, geminiTokensOut: tokensOut,
        error: 'Gemini JSON 파싱 실패',
      };
    }

    const equipments = (result.equipments ?? []) as AnalysisResult['equipments'];
    const treatments = (result.treatments ?? []) as AnalysisResult['treatments'];
    const doctors = (result.doctors ?? []) as AnalysisResult['doctors'];
    const events = (result.events ?? []) as string[];
    const specialties = (result.specialties ?? []) as string[];

    const priceCount = treatments.filter(
      (t) => (t.price && t.price > 0) || (t.price_min && t.price_min > 0)
    ).length;

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`  ✅ 장비=${equipments.length}, 시술=${treatments.length}, 가격=${priceCount}, 의사=${doctors.length} (${elapsed.toFixed(1)}초)`);

    // 장비 상세 출력
    if (equipments.length > 0) {
      console.log('  장비 목록:');
      equipments.forEach((e) => console.log(`    - ${e.equipment_name} (${e.equipment_category ?? '?'})`));
    }

    // Save analysis result
    const outputPath = path.join(hospitalDir, 'gemini-analysis-v4.json');
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

    return {
      hospitalName, success: true,
      equipments, treatments, doctors,
      prices: priceCount,
      operatingHours: (result.operating_hours as string) ?? undefined,
      events, specialties,
      hospitalInfo: (result.hospital_profile ?? {}) as AnalysisResult['hospitalInfo'],
      markdownLength: combined.length,
      pagesUsed: pageCount,
      elapsed,
      geminiTokensIn: tokensIn,
      geminiTokensOut: tokensOut,
    };
  } catch (err) {
    const elapsed = (Date.now() - startTime) / 1000;
    console.error(`  ❌ ${hospitalName} 실패: ${err instanceof Error ? err.message : String(err)}`);
    return {
      hospitalName, success: false, equipments: [], treatments: [], doctors: [],
      prices: 0, events: [], specialties: [], hospitalInfo: {},
      markdownLength: 0, pagesUsed: 0, elapsed,
      geminiTokensIn: 0, geminiTokensOut: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  console.log('═'.repeat(60));
  console.log(`Firecrawl 4차 E2E: Phase 2 Gemini 분석 (maxTokens=${MAX_OUTPUT_TOKENS})`);
  console.log('═'.repeat(60));

  const dateDir = await findV4SnapshotDir();
  console.log(`스냅샷 폴더: ${dateDir}`);

  const nameArg = process.argv.indexOf('--name');
  const targetName = nameArg !== -1 && process.argv[nameArg + 1]
    ? process.argv[nameArg + 1]
    : null;

  const allDirs = await fs.readdir(dateDir);
  const hospitalDirs = targetName
    ? allDirs.filter((d) => d.includes(targetName))
    : allDirs.filter((d) => !d.startsWith('.') && !d.endsWith('.json'));

  console.log(`분석 대상: ${hospitalDirs.length}개 병원`);

  const results: AnalysisResult[] = [];

  for (const dir of hospitalDirs) {
    const fullPath = path.join(dateDir, dir);
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) continue;

    const result = await analyzeHospital(fullPath, dir);
    results.push(result);

    if (dir !== hospitalDirs[hospitalDirs.length - 1]) {
      console.log('  --- 5초 대기 ---');
      await delay(5000);
    }
  }

  // 종합 보고
  console.log(`\n${'═'.repeat(60)}`);
  console.log('=== 4차 Phase 2 Gemini 분석 종합 결과 ===');
  console.log('═'.repeat(60));

  console.log('\n| 병원 | 장비 | 시술 | 가격 | 의사 | Markdown | Tokens(in/out) | 소요 |');
  console.log('|---|---|---|---|---|---|---|---|');

  for (const r of results) {
    if (r.success) {
      console.log(
        `| ${r.hospitalName} | ${r.equipments.length} | ${r.treatments.length} | ${r.prices} | ${r.doctors.length} | ${r.markdownLength.toLocaleString()}자 | ${r.geminiTokensIn}/${r.geminiTokensOut} | ${r.elapsed.toFixed(1)}초 |`
      );
    } else {
      console.log(`| ${r.hospitalName} | ❌ ${r.error} | - | - | - | - | - | ${r.elapsed.toFixed(1)}초 |`);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const totalEq = results.reduce((s, r) => s + r.equipments.length, 0);
  const totalTr = results.reduce((s, r) => s + r.treatments.length, 0);
  const totalPr = results.reduce((s, r) => s + r.prices, 0);
  const totalDr = results.reduce((s, r) => s + r.doctors.length, 0);
  const totalTokensIn = results.reduce((s, r) => s + r.geminiTokensIn, 0);
  const totalTokensOut = results.reduce((s, r) => s + r.geminiTokensOut, 0);

  console.log(`\n성공: ${successCount}/${results.length}`);
  console.log(`총 장비: ${totalEq}, 총 시술: ${totalTr}, 총 가격: ${totalPr}, 총 의사: ${totalDr}`);
  console.log(`총 Gemini 토큰: in=${totalTokensIn}, out=${totalTokensOut}`);

  // Save summary
  const summaryPath = path.join(dateDir, 'analysis-summary-v4.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    date: new Date().toISOString(),
    config: { maxOutputTokens: MAX_OUTPUT_TOKENS, maxText: MAX_TEXT },
    results: results.map((r) => ({
      name: r.hospitalName,
      success: r.success,
      equipments: r.equipments.length,
      treatments: r.treatments.length,
      prices: r.prices,
      doctors: r.doctors.length,
      markdownLength: r.markdownLength,
      pagesUsed: r.pagesUsed,
      geminiTokensIn: r.geminiTokensIn,
      geminiTokensOut: r.geminiTokensOut,
      elapsed: r.elapsed,
      error: r.error,
    })),
    totals: { equipments: totalEq, treatments: totalTr, prices: totalPr, doctors: totalDr, tokensIn: totalTokensIn, tokensOut: totalTokensOut },
  }, null, 2));

  console.log(`\n분석 결과: ${summaryPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
