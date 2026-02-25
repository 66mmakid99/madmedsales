/**
 * recrawl-v4.ts
 *
 * TORR RF 재크롤링 v4: v3 + Firecrawl screenshot + Gemini Vision
 * 1. 원본 마크다운 + 스크린샷 Supabase 저장
 * 2. 페이지별 개별 Gemini 분석 (텍스트 or Vision)
 * 3. 텍스트 500자 미만 → 스크린샷 Vision 분석으로 대체
 * 4. 결과 병합 + 중복 제거
 *
 * 실행: npx tsx scripts/recrawl-v4.ts --limit 3
 * 옵션: --dry-run | --limit N | --start-from N | --skip-gemini | --only-gemini
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import sharp from 'sharp';
import { supabase } from './utils/supabase.js';
import { getAccessToken } from './analysis/gemini-auth.js';
import { getGeminiModel, getGeminiEndpoint } from './utils/gemini-model.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SOURCE_TAG = 'firecrawl_gemini_v4';

// ============================================================
// 설정
// ============================================================
const MAX_PAGES_PER_HOSPITAL = 20;
const DELAY_BETWEEN_HOSPITALS = 3000;
const DELAY_BETWEEN_PAGES = 1000;
const DELAY_BETWEEN_GEMINI = 1500;
const GEMINI_TIMEOUT = 60000;
const CHUNK_SIZE = 25000;
const MIN_PAGE_CHARS = 500;

// ============================================================
// Firecrawl 초기화
// ============================================================
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
if (!firecrawlApiKey) {
  console.error('❌ FIRECRAWL_API_KEY 미설정');
  process.exit(1);
}
const firecrawlApp = new FirecrawlApp({ apiKey: firecrawlApiKey });
const firecrawl = firecrawlApp.v1;

// ============================================================
// URL 필터 패턴
// ============================================================
const INCLUDE_PATTERNS = [
  /시술|프로그램|장비|기기|의료진|원장|대표원장|doctor|staff/i,
  /이벤트|event|할인|가격|price|비용|menu/i,
  /리프팅|피부|레이저|rf|hifu|바디|보톡스|필러/i,
  /주사|부스터|스킨|케어|토닝|제모|탈모/i,
  /info|about|introduce|소개|진료/i,
];

const EXCLUDE_PATTERNS = [
  /blog|후기|리뷰|review|공지|notice|개인정보|privacy/i,
  /채용|recruit|오시는길|map|location|contact/i,
  /\.pdf|\.jpg|\.png|login|admin|board|gallery/i,
  /예약|booking|reservation|sitemap/i,
];

function isRelevantUrl(url: string, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url);
    if (base.hostname !== target.hostname) return false;
  } catch { return false; }

  if (EXCLUDE_PATTERNS.some(p => p.test(url))) return false;
  return INCLUDE_PATTERNS.some(p => p.test(url));
}

// ============================================================
// 페이지 타입 자동 분류
// ============================================================
function classifyPageType(url: string, baseUrl: string): string {
  if (url === baseUrl || url === baseUrl + '/' || url + '/' === baseUrl) return 'main';
  const u = url.toLowerCase();
  if (/의료진|원장|doctor|staff|대표/.test(u)) return 'doctor';
  if (/장비|기기|equipment|device/.test(u)) return 'equipment';
  if (/시술|프로그램|treatment|menu|진료/.test(u)) return 'treatment';
  if (/이벤트|event|할인|special|가격|price|비용/.test(u)) return 'event';
  return 'other';
}

// ============================================================
// 스크린샷 최적화 + Storage 업로드
// ============================================================
async function optimizeScreenshot(imageBuffer: Buffer): Promise<Buffer> {
  return await sharp(imageBuffer)
    .resize(1280, null, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

async function uploadScreenshot(
  hospitalId: string,
  pageType: string,
  url: string,
  imageBuffer: Buffer,
): Promise<string | null> {
  try {
    const optimized = await optimizeScreenshot(imageBuffer);
    const slug = new URL(url).pathname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filePath = `${hospitalId}/${pageType}_${slug}_${timestamp}.webp`;

    const { error } = await supabase.storage
      .from('hospital-screenshots')
      .upload(filePath, optimized, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (error) {
      console.log(`    ⚠️ Storage 업로드 실패: ${error.message}`);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('hospital-screenshots')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (err) {
    console.log(`    ⚠️ 스크린샷 최적화/업로드 실패: ${err}`);
    return null;
  }
}

// ============================================================
// 크롤 대상 빌드 (37 기존 + 12 DONE)
// ============================================================
interface CrawlTarget {
  no: number;
  name: string;
  region: string;
  url: string;
  source: string;
}

function buildTargets(): CrawlTarget[] {
  const targetsPath = path.resolve(__dirname, 'data', 'step2-crawl-targets.json');
  const existing: CrawlTarget[] = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
  const existingNos = new Set(existing.map(t => t.no));

  const masterPath = path.resolve(__dirname, '..', 'torr-rf-master-71-v2.json');
  interface MasterEntry {
    no: number;
    name: string;
    region: string;
    website: string | null;
    phase: string;
  }
  const master: MasterEntry[] = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));

  const doneHospitals = master.filter(
    m => m.phase === 'DONE' && m.website && !existingNos.has(m.no)
  );

  for (const h of doneHospitals) {
    existing.push({
      no: h.no,
      name: h.name,
      region: h.region,
      url: h.website!,
      source: 'done_recrawl',
    });
  }

  console.log(`📋 대상: 기존 ${existingNos.size}개 + DONE ${doneHospitals.length}개 = ${existing.length}개`);
  return existing;
}

// ============================================================
// Step 1: Firecrawl 크롤링 (markdown + screenshot) + DB 저장
// ============================================================
interface CrawlPageResult {
  url: string;
  pageType: string;
  markdown: string;
  charCount: number;
  screenshotUrl: string | null;
  screenshotBuffer: Buffer | null;
}

async function crawlAndSave(hospitalId: string, name: string, url: string): Promise<{
  pages: CrawlPageResult[];
  credits: number;
}> {
  console.log(`\n🏥 [${name}] 크롤링: ${url}`);
  let credits = 0;
  const pages: CrawlPageResult[] = [];

  try {
    // 1. 사이트맵 추출
    let urlsToCrawl = [url];
    try {
      console.log('  📍 사이트맵 추출...');
      const mapResult = await firecrawl.mapUrl(url, { limit: 50 });
      credits += 1;

      if (mapResult.success && mapResult.links && mapResult.links.length > 0) {
        const allLinks = mapResult.links as string[];
        console.log(`  📄 총 ${allLinks.length}개 URL`);

        const relevant = allLinks.filter(link => isRelevantUrl(link, url));
        console.log(`  🎯 관련 URL: ${relevant.length}개`);

        urlsToCrawl = [url, ...relevant.slice(0, MAX_PAGES_PER_HOSPITAL - 1)];
        urlsToCrawl = [...new Set(urlsToCrawl)];
      }
    } catch {
      console.log(`  ⚠️ 사이트맵 실패, 메인만 크롤`);
    }

    console.log(`  🔄 ${urlsToCrawl.length}페이지 크롤 (markdown + screenshot)...`);

    // 2. 기존 crawl_pages 삭제
    await supabase.from('hospital_crawl_pages').delete().eq('hospital_id', hospitalId);

    // 3. 각 페이지 scrape + 즉시 DB 저장
    for (const targetUrl of urlsToCrawl) {
      try {
        const shortUrl = targetUrl.length > 70 ? targetUrl.substring(0, 70) + '...' : targetUrl;
        console.log(`    → ${shortUrl}`);

        const result = await firecrawl.scrapeUrl(targetUrl, {
          formats: ['markdown', 'screenshot'] as string[],
          waitFor: 3000,
          timeout: 30000,
        });
        credits += 1;

        if (!result.success) {
          console.log(`    ⚠️ scrape 실패`);
          continue;
        }

        const md = (result.markdown as string) || '';
        const pageType = classifyPageType(targetUrl, url);

        // 스크린샷 처리
        let screenshotBuffer: Buffer | null = null;
        let screenshotUrl: string | null = null;
        const ssRaw = (result as Record<string, unknown>).screenshot;

        if (ssRaw && typeof ssRaw === 'string') {
          try {
            if (ssRaw.startsWith('http')) {
              // URL → 다운로드
              const resp = await fetch(ssRaw);
              screenshotBuffer = Buffer.from(await resp.arrayBuffer());
            } else if (ssRaw.startsWith('data:image')) {
              const base64Part = ssRaw.split(',')[1];
              screenshotBuffer = Buffer.from(base64Part, 'base64');
            } else {
              screenshotBuffer = Buffer.from(ssRaw, 'base64');
            }

            // 최적화 + Storage 업로드
            if (screenshotBuffer) {
              screenshotUrl = await uploadScreenshot(hospitalId, pageType, targetUrl, screenshotBuffer);
            }
          } catch (ssErr) {
            console.log(`    ⚠️ 스크린샷 처리 실패: ${ssErr}`);
          }
        }

        // DB 저장
        const { error: insertErr } = await supabase.from('hospital_crawl_pages').insert({
          hospital_id: hospitalId,
          url: targetUrl,
          page_type: pageType,
          markdown: md,
          char_count: md.length,
          screenshot_url: screenshotUrl,
          analysis_method: 'pending',
          tenant_id: TENANT_ID,
          gemini_analyzed: false,
        });

        if (insertErr) {
          console.log(`    ⚠️ DB 저장 실패: ${insertErr.message}`);
        } else {
          const ssLabel = screenshotUrl ? '📸' : '';
          pages.push({ url: targetUrl, pageType, markdown: md, charCount: md.length, screenshotUrl, screenshotBuffer });
          console.log(`    ✅ ${md.length.toLocaleString()}자 [${pageType}] ${ssLabel}`);
        }
      } catch (scrapeErr) {
        console.log(`    ❌ ${scrapeErr}`);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
    }

    console.log(`  📊 ${pages.length}페이지 저장 | ${credits}크레딧 | 스크린샷 ${pages.filter(p => p.screenshotUrl).length}개`);
    return { pages, credits };
  } catch (err) {
    console.error(`  ❌ 크롤링 실패: ${err}`);
    return { pages, credits };
  }
}

// ============================================================
// 마크다운 정제
// ============================================================
function cleanMarkdown(md: string): string {
  let text = md;
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  text = text.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '');
  text = text.replace(/^.*(\[[^\]]+\]\([^)]+\).*){5,}$/gm, '');
  text = text.replace(/^\s*[-*]\s*\[!\[.*$/gm, '');
  text = text.replace(/^\|\s*\|\s*$/gm, '');
  text = text.replace(/^\|\s*---\s*\|\s*$/gm, '');
  text = text.replace(/^[-*]\s*$/gm, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ============================================================
// 청크 분할
// ============================================================
function splitIntoChunks(text: string, maxChars: number = CHUNK_SIZE): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n\n', end);
      if (lastNewline > start + maxChars * 0.7) end = lastNewline;
      else {
        const lastSentence = text.lastIndexOf('. ', end);
        if (lastSentence > start + maxChars * 0.7) end = lastSentence + 1;
      }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

// ============================================================
// Gemini 분석 (텍스트 + Vision)
// ============================================================
interface AnalysisResult {
  equipments: Array<{ name: string; category: string; manufacturer?: string }>;
  treatments: Array<{ name: string; category: string; price?: number | null; price_note?: string | null; is_promoted?: boolean; combo_with?: string | null }>;
  doctors: Array<{ name: string; title: string; specialty?: string; education?: string; career?: string; academic_activity?: string }>;
  events: Array<{ title: string; description?: string; discount_type?: string; discount_value?: string; related_treatments?: string[] }>;
}

const EMPTY_RESULT: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

function buildPrompt(name: string, pageType: string, contentDesc: string, chunkInfo?: string): string {
  const chunkNote = chunkInfo ? `\n(이 텍스트는 전체의 ${chunkInfo}입니다)` : '';

  return `이 ${contentDesc}는 "${name}" 병원 웹사이트의 ${pageType} 페이지입니다.${chunkNote}
아래 정보를 빠짐없이 JSON으로 추출하세요.

{
  "equipments": [{
    "name": "정규화된 장비명",
    "category": "laser|rf|hifu|body|lifting|booster|skin|other",
    "manufacturer": "제조사명 (알 수 있으면)"
  }],
  "treatments": [{
    "name": "시술명",
    "category": "lifting|laser|body|booster|filler_botox|skin|hair|other",
    "price": 숫자(원 단위, 없으면 null),
    "price_note": "가격 부가설명 (1회 기준, 이벤트가, ~부터 등)",
    "is_promoted": true/false,
    "combo_with": "같이 시술하는 콤보가 있으면 기재"
  }],
  "doctors": [{
    "name": "의사 이름",
    "title": "직함 (대표원장, 원장, 부원장 등)",
    "specialty": "전문분야",
    "education": "학력 (의대, 수련병원 등)",
    "career": "주요경력 (학회 활동, 전임의 등)",
    "academic_activity": "논문, 학회 발표, 저서, KOL 활동 등"
  }],
  "events": [{
    "title": "이벤트/할인 제목",
    "description": "상세 내용",
    "discount_type": "percent|fixed|package|free_add|other",
    "discount_value": "30%, 50000원, 1+1 등",
    "related_treatments": ["관련 시술명"]
  }]
}

장비명 정규화 규칙:
- 써마지/써마지FLX → "Thermage FLX"
- 울쎄라/울쎄라프라임 → "Ulthera" / "Ulthera Prime"
- 슈링크/슈링크유니버스 → "Shrink Universe"
- 인모드 → "InMode"
- 토르/토르RF/TORR → "TORR RF"
- 토르 컴포트 듀얼/컴포트듀얼 → "TORR Comfort Dual"

★ "토르", "TORR", "컴포트듀얼" 관련 언급은 반드시 포함.
★ 가격 정보가 있으면 반드시 추출. "~부터", "VAT별도" 등 조건도 price_note에.
★ 의사 학력/경력은 텍스트에 있는 그대로 추출.
★ 이벤트/할인 정보가 있으면 반드시 추출.

없는 항목은 빈 배열로. JSON만 응답 (마크다운 없이).`;
}

/** Gemini 텍스트 분석 */
async function callGeminiText(prompt: string, text: string): Promise<AnalysisResult> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt + '\n\n웹사이트 텍스트:\n' + text }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT),
  });

  if (res.status === 429) {
    console.log(`    ⏳ 429 Rate Limit — 30초 대기 후 재시도`);
    await new Promise(r => setTimeout(r, 30000));
    const retryRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt + '\n\n웹사이트 텍스트:\n' + text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      }),
    });
    if (!retryRes.ok) throw new Error(`Gemini retry failed: ${retryRes.status}`);
    const data = await retryRes.json();
    const t = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return safeJsonParse(t);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const responseText = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return safeJsonParse(responseText);
}

/** Gemini Vision 분석 (이미지 기반) */
async function callGeminiVision(prompt: string, imageBuffer: Buffer): Promise<AnalysisResult> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();
  const base64Image = imageBuffer.toString('base64');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/webp', data: base64Image } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT),
  });

  if (res.status === 429) {
    console.log(`    ⏳ 429 Rate Limit — 30초 대기 후 재시도`);
    await new Promise(r => setTimeout(r, 30000));
    const retryRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: 'image/webp', data: base64Image } },
            { text: prompt },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      }),
    });
    if (!retryRes.ok) throw new Error(`Gemini Vision retry failed: ${retryRes.status}`);
    const data = await retryRes.json();
    const t = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return safeJsonParse(t);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini Vision ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const responseText = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return safeJsonParse(responseText);
}

/** JSON 파싱 + 복구 시도 */
function safeJsonParse(text: string): AnalysisResult {
  try { return JSON.parse(text); } catch {
    try {
      const fixed = text.replace(/(?<=: *"[^"]*)\n(?=[^"]*")/g, '\\n');
      return JSON.parse(fixed);
    } catch {
      try {
        const lastBracket = text.lastIndexOf(']');
        if (lastBracket > 0) return JSON.parse(text.substring(0, lastBracket + 1) + '}');
      } catch { /* fall through */ }
      console.log(`    ⚠️ JSON 복구 실패, 빈 결과 사용`);
      return EMPTY_RESULT;
    }
  }
}

// ============================================================
// 페이지 분석 (텍스트 or Vision 자동 결정)
// ============================================================
async function analyzePage(
  name: string,
  pageUrl: string,
  pageType: string,
  markdown: string,
  screenshotBuffer: Buffer | null,
): Promise<{ result: AnalysisResult; method: string; geminiCalls: number }> {
  const cleaned = cleanMarkdown(markdown);
  const hasText = cleaned.length >= MIN_PAGE_CHARS;
  const hasScreenshot = screenshotBuffer !== null && screenshotBuffer.length > 0;

  // 분석 방법 결정
  let method: string;
  if (hasText) {
    method = 'text';
  } else if (hasScreenshot) {
    method = 'vision';
  } else {
    console.log(`    ⏭️ 스킵 (텍스트 ${cleaned.length}자, 스크린샷 ${hasScreenshot ? '있음' : '없음'})`);
    return { result: EMPTY_RESULT, method: 'skipped', geminiCalls: 0 };
  }

  if (method === 'text') {
    if (cleaned.length < markdown.length * 0.5) {
      console.log(`    🧹 정제: ${markdown.length.toLocaleString()}자 → ${cleaned.length.toLocaleString()}자`);
    }

    const chunks = splitIntoChunks(cleaned);
    const results: AnalysisResult[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkInfo = chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined;
      const prompt = buildPrompt(name, pageType, '텍스트', chunkInfo);

      try {
        const result = await callGeminiText(prompt, chunks[i]);
        results.push(result);
        if (chunks.length > 1) console.log(`    📄 청크 ${i + 1}/${chunks.length} 분석 완료`);
      } catch (err) {
        console.log(`    ❌ Gemini 텍스트 에러: ${err}`);
        results.push(EMPTY_RESULT);
      }

      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
    }

    // 텍스트 결과 합치기
    const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };
    for (const r of results) {
      if (r.equipments) merged.equipments.push(...r.equipments);
      if (r.treatments) merged.treatments.push(...r.treatments);
      if (r.doctors) merged.doctors.push(...r.doctors);
      if (r.events) merged.events.push(...r.events);
    }

    // 텍스트로 결과 거의 없고 스크린샷 있으면 Vision도 시도
    const totalItems = merged.equipments.length + merged.treatments.length + merged.doctors.length + merged.events.length;
    if (totalItems === 0 && hasScreenshot) {
      console.log(`    🔄 텍스트 분석 0건 → Vision 추가 시도`);
      method = 'both';
      try {
        const optimized = await optimizeScreenshot(screenshotBuffer!);
        const prompt = buildPrompt(name, pageType, '이미지');
        const visionResult = await callGeminiVision(prompt, optimized);
        merged.equipments.push(...(visionResult.equipments || []));
        merged.treatments.push(...(visionResult.treatments || []));
        merged.doctors.push(...(visionResult.doctors || []));
        merged.events.push(...(visionResult.events || []));
        return { result: merged, method, geminiCalls: chunks.length + 1 };
      } catch (err) {
        console.log(`    ❌ Vision 추가 분석 실패: ${err}`);
      }
    }

    return { result: merged, method, geminiCalls: chunks.length };
  }

  // Vision 분석
  console.log(`    👁️ Vision 분석 (텍스트 ${cleaned.length}자 < ${MIN_PAGE_CHARS}자)`);
  try {
    const optimized = await optimizeScreenshot(screenshotBuffer!);
    const prompt = buildPrompt(name, pageType, '이미지');
    const result = await callGeminiVision(prompt, optimized);
    return { result, method: 'vision', geminiCalls: 1 };
  } catch (err) {
    console.log(`    ❌ Vision 분석 실패: ${err}`);
    return { result: EMPTY_RESULT, method: 'vision_failed', geminiCalls: 1 };
  }
}

// ============================================================
// 결과 병합 + 중복 제거
// ============================================================
function mergeAndDeduplicate(results: AnalysisResult[]): AnalysisResult {
  const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

  for (const r of results) {
    merged.equipments.push(...(r.equipments || []));
    merged.treatments.push(...(r.treatments || []));
    merged.doctors.push(...(r.doctors || []));
    merged.events.push(...(r.events || []));
  }

  // 장비 중복 제거
  const eqMap = new Map<string, typeof merged.equipments[0]>();
  for (const eq of merged.equipments) {
    const key = eq.name.toLowerCase().trim();
    if (!eqMap.has(key) || (!eqMap.get(key)!.manufacturer && eq.manufacturer)) {
      eqMap.set(key, eq);
    }
  }
  merged.equipments = [...eqMap.values()];

  // 시술 중복 제거
  const trMap = new Map<string, typeof merged.treatments[0]>();
  for (const tr of merged.treatments) {
    const key = tr.name.toLowerCase().trim();
    if (!trMap.has(key) || (!trMap.get(key)!.price && tr.price)) {
      trMap.set(key, tr);
    }
  }
  merged.treatments = [...trMap.values()];

  // 의사 중복 제거
  const drMap = new Map<string, typeof merged.doctors[0]>();
  for (const dr of merged.doctors) {
    const key = dr.name.trim();
    if (!drMap.has(key)) {
      drMap.set(key, dr);
    } else {
      const existing = drMap.get(key)!;
      const existingFields = [existing.education, existing.career, existing.academic_activity].filter(Boolean).length;
      const newFields = [dr.education, dr.career, dr.academic_activity].filter(Boolean).length;
      if (newFields > existingFields) drMap.set(key, { ...existing, ...dr });
    }
  }
  merged.doctors = [...drMap.values()];

  // 이벤트 중복 제거
  const evMap = new Map<string, typeof merged.events[0]>();
  for (const ev of merged.events) {
    const key = ev.title.toLowerCase().trim();
    if (!evMap.has(key)) evMap.set(key, ev);
  }
  merged.events = [...evMap.values()];

  return merged;
}

// ============================================================
// DB 저장
// ============================================================
async function saveAnalysis(
  hospitalId: string,
  analysis: AnalysisResult,
  sourceUrl: string,
): Promise<void> {
  await supabase.from('hospital_equipments').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_treatments').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_doctors').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_events').delete().eq('hospital_id', hospitalId);

  if (analysis.equipments.length > 0) {
    const rows = analysis.equipments.map(eq => ({
      hospital_id: hospitalId,
      equipment_name: eq.name,
      equipment_category: eq.category || 'other',
      manufacturer: eq.manufacturer || null,
      source: SOURCE_TAG,
    }));
    const { error } = await supabase.from('hospital_equipments').insert(rows);
    if (error) console.log(`  ⚠️ 장비 INSERT: ${error.message}`);
  }

  if (analysis.treatments.length > 0) {
    const rows = analysis.treatments.map(tr => ({
      hospital_id: hospitalId,
      treatment_name: tr.name,
      treatment_category: tr.category || 'other',
      price: tr.price || null,
      price_note: tr.price_note || null,
      is_promoted: tr.is_promoted || false,
      combo_with: tr.combo_with || null,
      source: SOURCE_TAG,
    }));
    const { error } = await supabase.from('hospital_treatments').insert(rows);
    if (error) console.log(`  ⚠️ 시술 INSERT: ${error.message}`);
  }

  if (analysis.doctors.length > 0) {
    const toArray = (s: string | undefined | null): string[] => {
      if (!s) return [];
      return s.split(/\n|,\s*/).map(v => v.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    };
    const toText = (s: string | undefined | null): string | null => {
      if (!s) return null;
      return s.replace(/\n/g, ', ').replace(/\s{2,}/g, ' ').trim();
    };
    const rows = analysis.doctors.map(dr => ({
      hospital_id: hospitalId,
      name: dr.name.trim(),
      title: (dr.title || '원장').trim(),
      specialty: toText(dr.specialty),
      education: toArray(dr.education),
      career: toArray(dr.career),
      academic_activity: toText(dr.academic_activity),
    }));
    const { error } = await supabase.from('hospital_doctors').insert(rows);
    if (error) console.log(`  ⚠️ 의사 INSERT: ${error.message}`);
  }

  if (analysis.events.length > 0) {
    const rows = analysis.events.map(ev => ({
      hospital_id: hospitalId,
      title: ev.title,
      description: ev.description || null,
      discount_type: ev.discount_type || null,
      discount_value: ev.discount_value || null,
      related_treatments: ev.related_treatments || [],
      source_url: sourceUrl,
      source: SOURCE_TAG,
      tenant_id: TENANT_ID,
    }));
    const { error } = await supabase.from('hospital_events').insert(rows);
    if (error) console.log(`  ⚠️ 이벤트 INSERT: ${error.message}`);
  }

  // gemini_analyzed + analysis_method 업데이트는 페이지별로 이미 처리
  await supabase
    .from('hospital_crawl_pages')
    .update({ gemini_analyzed: true })
    .eq('hospital_id', hospitalId);
}

// ============================================================
// Hospital ID 조회/생성
// ============================================================
async function resolveHospitalId(name: string, url: string): Promise<string | null> {
  const { data: crmH } = await supabase
    .from('crm_hospitals')
    .select('id, sales_hospital_id')
    .eq('name', name)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (!crmH) {
    console.log(`  ⚠️ CRM에서 "${name}" 못 찾음`);
    return null;
  }

  let hospitalId = crmH.sales_hospital_id;

  if (!hospitalId) {
    const { data: existing } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', name)
      .limit(1)
      .single();

    if (existing) {
      hospitalId = existing.id;
    } else {
      const { data: newH, error } = await supabase
        .from('hospitals')
        .insert({ name, website: url, crawled_at: new Date().toISOString() })
        .select('id')
        .single();

      if (error || !newH) {
        console.log(`  ❌ hospital INSERT 실패: ${error?.message}`);
        return null;
      }
      hospitalId = newH.id;
    }

    await supabase.from('crm_hospitals').update({ sales_hospital_id: hospitalId }).eq('id', crmH.id);
    console.log(`  🔗 hospital 연결: ${hospitalId}`);
  }

  await supabase
    .from('hospitals')
    .update({ website: url, crawled_at: new Date().toISOString() })
    .eq('id', hospitalId);

  return hospitalId;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipGemini = args.includes('--skip-gemini');
  const onlyGemini = args.includes('--only-gemini');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;
  const startIdx = args.indexOf('--start-from');
  const startFrom = startIdx >= 0 ? parseInt(args[startIdx + 1]) : 0;

  console.log('═══════════════════════════════════════════════════');
  console.log('  Recrawl v4: Firecrawl + Screenshot + Gemini Vision');
  console.log('═══════════════════════════════════════════════════\n');

  const allTargets = buildTargets();
  const targets = allTargets.slice(startFrom, startFrom + limit);

  console.log(`📋 이번 실행: ${targets.length}개 (${startFrom}번째부터)`);
  console.log(`🔧 모드: ${dryRun ? 'DRY RUN' : skipGemini ? '크롤링만' : onlyGemini ? 'Gemini분석만' : '크롤링 + AI 분석'}`);
  console.log(`📐 Gemini 모델: ${getGeminiModel()}`);
  console.log(`💳 예상 크레딧: ~${targets.length * 8} (max ${targets.length * (MAX_PAGES_PER_HOSPITAL + 1)})\n`);

  if (dryRun) {
    for (const t of targets) {
      console.log(`  No.${t.no} ${t.name} (${t.region}): ${t.url} [${t.source}]`);
    }
    return;
  }

  // Gemini 연결 테스트
  if (!skipGemini) {
    try {
      const token = await getAccessToken();
      console.log(`✅ Gemini SA 인증 확인 (토큰 길이: ${token.length})\n`);
    } catch (err) {
      console.error(`❌ Gemini 인증 실패: ${err}`);
      process.exit(1);
    }
  }

  let totalCredits = 0;
  let totalGeminiCalls = 0;
  let totalPages = 0;
  let totalVisionCalls = 0;
  const summary: Array<{
    no: number; name: string; pages: number; credits: number;
    geminiCalls: number; visionCalls: number;
    equip: number; treat: number; doctors: number; events: number;
    error?: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`\n───── [${i + 1}/${targets.length}] No.${t.no} ${t.name} ─────`);

    const hospitalId = await resolveHospitalId(t.name, t.url);
    if (!hospitalId) {
      summary.push({ no: t.no, name: t.name, pages: 0, credits: 0, geminiCalls: 0, visionCalls: 0, equip: 0, treat: 0, doctors: 0, events: 0, error: 'CRM not found' });
      continue;
    }

    let pages: CrawlPageResult[] = [];
    let credits = 0;

    if (!onlyGemini) {
      const crawlResult = await crawlAndSave(hospitalId, t.name, t.url);
      pages = crawlResult.pages;
      credits = crawlResult.credits;
      totalCredits += credits;
      totalPages += pages.length;
    } else {
      // only-gemini: DB에서 기존 페이지 + 스크린샷 다시 로드
      const { data: dbPages } = await supabase
        .from('hospital_crawl_pages')
        .select('url, page_type, markdown, char_count, screenshot_url')
        .eq('hospital_id', hospitalId)
        .order('crawled_at');

      if (dbPages && dbPages.length > 0) {
        // 스크린샷 URL에서 다시 다운로드 (Vision용)
        for (const p of dbPages) {
          let ssBuffer: Buffer | null = null;
          if (p.screenshot_url) {
            try {
              const resp = await fetch(p.screenshot_url);
              ssBuffer = Buffer.from(await resp.arrayBuffer());
            } catch { /* 스크린샷 다운로드 실패 무시 */ }
          }
          pages.push({
            url: p.url,
            pageType: p.page_type,
            markdown: p.markdown,
            charCount: p.char_count,
            screenshotUrl: p.screenshot_url,
            screenshotBuffer: ssBuffer,
          });
        }
        console.log(`  📂 DB에서 ${pages.length}페이지 로드 (스크린샷 ${pages.filter(p => p.screenshotBuffer).length}개)`);
      } else {
        console.log(`  ⚠️ DB에 저장된 페이지 없음`);
      }
    }

    if (pages.length === 0) {
      summary.push({ no: t.no, name: t.name, pages: 0, credits, geminiCalls: 0, visionCalls: 0, equip: 0, treat: 0, doctors: 0, events: 0, error: 'no pages' });
      continue;
    }

    // 페이지별 분석
    let geminiCalls = 0;
    let visionCalls = 0;
    const analysis: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

    if (!skipGemini) {
      const pageResults: AnalysisResult[] = [];

      for (let j = 0; j < pages.length; j++) {
        const p = pages[j];
        const shortUrl = p.url.length > 50 ? p.url.substring(0, 50) + '...' : p.url;
        console.log(`  🤖 [${j + 1}/${pages.length}] ${p.pageType} (${p.charCount.toLocaleString()}자) ${shortUrl}`);

        const { result, method, geminiCalls: calls } = await analyzePage(
          t.name, p.url, p.pageType, p.markdown, p.screenshotBuffer,
        );
        pageResults.push(result);
        geminiCalls += calls;
        if (method === 'vision' || method === 'both') visionCalls++;

        // analysis_method 업데이트
        await supabase.from('hospital_crawl_pages')
          .update({ analysis_method: method })
          .eq('hospital_id', hospitalId)
          .eq('url', p.url);

        const items = result.equipments.length + result.treatments.length + result.doctors.length + result.events.length;
        console.log(`    → ${method} | ${items}건`);

        if (j < pages.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
      }

      const merged = mergeAndDeduplicate(pageResults);
      analysis.equipments = merged.equipments;
      analysis.treatments = merged.treatments;
      analysis.doctors = merged.doctors;
      analysis.events = merged.events;

      console.log(`  📊 결과: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length} (Gemini ${geminiCalls}회, Vision ${visionCalls}회)`);

      await saveAnalysis(hospitalId, analysis, t.url);
      console.log(`  💾 저장 완료`);
    }

    totalGeminiCalls += geminiCalls;
    totalVisionCalls += visionCalls;
    summary.push({
      no: t.no, name: t.name, pages: pages.length, credits, geminiCalls, visionCalls,
      equip: analysis.equipments.length, treat: analysis.treatments.length,
      doctors: analysis.doctors.length, events: analysis.events.length,
    });

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
  }

  // 결과 저장
  const outputPath = path.resolve(__dirname, 'data', 'recrawl-v4-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  const totals = summary.reduce(
    (acc, s) => ({ equip: acc.equip + s.equip, treat: acc.treat + s.treat, doctors: acc.doctors + s.doctors, events: acc.events + s.events }),
    { equip: 0, treat: 0, doctors: 0, events: 0 }
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Recrawl v4 결과 요약');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✅ 성공: ${summary.filter(s => !s.error).length}개`);
  console.log(`  ❌ 실패: ${summary.filter(s => s.error).length}개`);
  console.log(`  📄 총 크롤 페이지: ${totalPages}개`);
  console.log(`  🤖 총 Gemini 호출: ${totalGeminiCalls}회 (Vision ${totalVisionCalls}회)`);
  console.log(`  💳 크레딧 사용: ${totalCredits}`);
  console.log(`  📊 장비: ${totals.equip} | 시술: ${totals.treat} | 의사: ${totals.doctors} | 이벤트: ${totals.events}`);
  console.log(`  💾 결과: ${outputPath}`);

  if (summary.some(s => s.error)) {
    console.log(`\n⚠️ 실패:`);
    summary.filter(s => s.error).forEach(s => console.log(`   No.${s.no} ${s.name}: ${s.error}`));
  }
}

main().catch(console.error);
