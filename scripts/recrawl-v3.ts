/**
 * recrawl-v3.ts
 *
 * TORR RF 재크롤링 v3: 설계 결함 전면 개선
 * 1. 원본 마크다운 Supabase 페이지별 저장
 * 2. 페이지별 개별 Gemini 분석 (텍스트 자르지 않음, 긴 건 청크 분할)
 * 3. 확장 추출: 장비/시술/의사/이벤트 + 의사 학력경력, 가격 부가설명
 * 4. 결과 병합 + 중복 제거
 *
 * 실행: npx tsx scripts/recrawl-v3.ts
 * 옵션: --dry-run | --limit N | --start-from N | --skip-gemini | --only-gemini
 */

import FirecrawlApp from '@mendable/firecrawl-js';
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

// ============================================================
// 설정
// ============================================================
const MAX_PAGES_PER_HOSPITAL = 15;
const DELAY_BETWEEN_HOSPITALS = 3000;
const DELAY_BETWEEN_PAGES = 1000;
const DELAY_BETWEEN_GEMINI = 1500;
const GEMINI_TIMEOUT = 60000;
const CHUNK_SIZE = 25000;
const MIN_PAGE_CHARS = 500; // 이하 Gemini 스킵

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
// URL 필터 패턴 (명세서 확장)
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

  // DONE 병원 추가
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
// Step 1: Firecrawl 크롤링 + 원본 즉시 DB 저장
// ============================================================
interface CrawlPageResult {
  url: string;
  pageType: string;
  markdown: string;
  charCount: number;
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

    console.log(`  🔄 ${urlsToCrawl.length}페이지 크롤...`);

    // 2. 기존 crawl_pages 삭제
    await supabase.from('hospital_crawl_pages').delete().eq('hospital_id', hospitalId);

    // 3. 각 페이지 scrape + 즉시 DB 저장
    for (const targetUrl of urlsToCrawl) {
      try {
        const shortUrl = targetUrl.length > 70 ? targetUrl.substring(0, 70) + '...' : targetUrl;
        console.log(`    → ${shortUrl}`);

        const result = await firecrawl.scrapeUrl(targetUrl, {
          formats: ['markdown'],
          waitFor: 3000,
          timeout: 30000,
        });
        credits += 1;

        if (result.success && result.markdown) {
          const md = result.markdown as string;
          const pageType = classifyPageType(targetUrl, url);

          // 즉시 DB 저장
          const { error: insertErr } = await supabase.from('hospital_crawl_pages').insert({
            hospital_id: hospitalId,
            url: targetUrl,
            page_type: pageType,
            markdown: md,
            char_count: md.length,
            tenant_id: TENANT_ID,
            gemini_analyzed: false,
          });

          if (insertErr) {
            console.log(`    ⚠️ DB 저장 실패: ${insertErr.message}`);
          } else {
            pages.push({ url: targetUrl, pageType, markdown: md, charCount: md.length });
            console.log(`    ✅ ${md.length.toLocaleString()}자 [${pageType}]`);
          }
        } else {
          console.log(`    ⚠️ 마크다운 없음`);
        }
      } catch (scrapeErr) {
        console.log(`    ❌ ${scrapeErr}`);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
    }

    console.log(`  📊 ${pages.length}페이지 저장 | ${credits}크레딧`);
    return { pages, credits };
  } catch (err) {
    console.error(`  ❌ 크롤링 실패: ${err}`);
    return { pages, credits };
  }
}

// ============================================================
// 마크다운 정제 (네비/푸터/이미지 링크 제거)
// ============================================================
function cleanMarkdown(md: string): string {
  let text = md;

  // 이미지 전용 링크 제거: [![alt](img)](link)
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');

  // 단독 이미지 제거: ![](url) 또는 ![alt](url) (텍스트가 없는 이미지만)
  text = text.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '');

  // 네비게이션 라인 제거: 한 줄에 링크 5개 이상 (3개는 너무 공격적)
  text = text.replace(/^.*(\[[^\]]+\]\([^)]+\).*){5,}$/gm, '');

  // 리스트 내 순수 링크만 있는 라인 (텍스트 콘텐츠 없이 링크만)
  text = text.replace(/^\s*[-*]\s*\[!\[.*$/gm, '');

  // 빈 테이블 셀 제거
  text = text.replace(/^\|\s*\|\s*$/gm, '');
  text = text.replace(/^\|\s*---\s*\|\s*$/gm, '');

  // 빈 리스트 아이템 제거
  text = text.replace(/^[-*]\s*$/gm, '');

  // 반복되는 빈 줄 압축
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// ============================================================
// 청크 분할 (텍스트를 자르지 않는다)
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
// Step 2: Gemini 페이지별 개별 분석
// ============================================================
interface AnalysisResult {
  equipments: Array<{
    name: string;
    category: string;
    manufacturer?: string;
  }>;
  treatments: Array<{
    name: string;
    category: string;
    price?: number | null;
    price_note?: string | null;
    is_promoted?: boolean;
    combo_with?: string | null;
  }>;
  doctors: Array<{
    name: string;
    title: string;
    specialty?: string;
    education?: string;
    career?: string;
    academic_activity?: string;
  }>;
  events: Array<{
    title: string;
    description?: string;
    discount_type?: string;
    discount_value?: string;
    related_treatments?: string[];
  }>;
}

const EMPTY_RESULT: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

function buildPrompt(name: string, pageType: string, text: string, chunkInfo?: string): string {
  const chunkNote = chunkInfo ? `\n(이 텍스트는 전체의 ${chunkInfo}입니다)` : '';

  return `이 텍스트는 "${name}" 병원 웹사이트의 ${pageType} 페이지입니다.${chunkNote}
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

없는 항목은 빈 배열로. JSON만 응답 (마크다운 없이).

웹사이트 텍스트:
${text}`;
}

async function callGemini(prompt: string): Promise<AnalysisResult> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
    }),
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (res.status === 429) {
    // 429 재시도
    console.log(`    ⏳ 429 Rate Limit — 30초 대기 후 재시도`);
    await new Promise(r => setTimeout(r, 30000));

    const retryRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAccessToken()}`,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      }),
    });

    if (!retryRes.ok) {
      throw new Error(`Gemini retry failed: ${retryRes.status}`);
    }

    const retryData = await retryRes.json();
    let text = retryData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(text);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  let responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  return safeJsonParse(responseText);
}

/** JSON 파싱 + 복구 시도 */
function safeJsonParse(text: string): AnalysisResult {
  // 1차: 그대로 파싱
  try {
    return JSON.parse(text);
  } catch {
    // 2차: 문자열 내 줄바꿈을 \\n으로 이스케이프
    try {
      const fixed = text.replace(/(?<=: *"[^"]*)\n(?=[^"]*")/g, '\\n');
      return JSON.parse(fixed);
    } catch {
      // 3차: 잘린 JSON 복구 — 마지막 유효 ] 또는 } 까지만 사용
      try {
        let truncated = text;
        // 마지막 완전한 배열 닫기 찾기
        const lastBracket = text.lastIndexOf(']');
        if (lastBracket > 0) {
          truncated = text.substring(0, lastBracket + 1) + '}';
        }
        return JSON.parse(truncated);
      } catch {
        // 4차: 빈 결과 반환
        console.log(`    ⚠️ JSON 복구 실패, 빈 결과 사용`);
        return EMPTY_RESULT;
      }
    }
  }
}

async function analyzePage(
  name: string,
  pageUrl: string,
  pageType: string,
  markdown: string,
): Promise<AnalysisResult> {
  // 마크다운 정제 후 길이 체크
  const cleaned = cleanMarkdown(markdown);
  if (cleaned.length < MIN_PAGE_CHARS) {
    console.log(`    ⏭️ ${pageType} 스킵 (정제 후 ${cleaned.length}자 < ${MIN_PAGE_CHARS}자, 원본 ${markdown.length}자)`);
    return EMPTY_RESULT;
  }
  if (cleaned.length < markdown.length * 0.5) {
    console.log(`    🧹 정제: ${markdown.length.toLocaleString()}자 → ${cleaned.length.toLocaleString()}자`);
  }

  const chunks = splitIntoChunks(cleaned);
  const results: AnalysisResult[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkInfo = chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined;
    const prompt = buildPrompt(name, pageType, chunks[i], chunkInfo);

    try {
      const result = await callGemini(prompt);
      results.push(result);

      if (chunks.length > 1) {
        console.log(`    📄 청크 ${i + 1}/${chunks.length} 분석 완료`);
      }
    } catch (err) {
      console.log(`    ❌ Gemini 에러: ${err}`);
      results.push(EMPTY_RESULT);
    }

    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
    }
  }

  // 청크 결과 합치기
  const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };
  for (const r of results) {
    if (r.equipments) merged.equipments.push(...r.equipments);
    if (r.treatments) merged.treatments.push(...r.treatments);
    if (r.doctors) merged.doctors.push(...r.doctors);
    if (r.events) merged.events.push(...r.events);
  }

  return merged;
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

  // 장비 중복 제거: name 정규화
  const eqMap = new Map<string, typeof merged.equipments[0]>();
  for (const eq of merged.equipments) {
    const key = eq.name.toLowerCase().trim();
    if (!eqMap.has(key)) {
      eqMap.set(key, eq);
    } else {
      // manufacturer가 있는 쪽 우선
      const existing = eqMap.get(key)!;
      if (!existing.manufacturer && eq.manufacturer) {
        eqMap.set(key, eq);
      }
    }
  }
  merged.equipments = [...eqMap.values()];

  // 시술 중복 제거: name 기준, 가격 있는 쪽 우선
  const trMap = new Map<string, typeof merged.treatments[0]>();
  for (const tr of merged.treatments) {
    const key = tr.name.toLowerCase().trim();
    if (!trMap.has(key)) {
      trMap.set(key, tr);
    } else {
      const existing = trMap.get(key)!;
      if (!existing.price && tr.price) {
        trMap.set(key, tr);
      }
    }
  }
  merged.treatments = [...trMap.values()];

  // 의사 중복 제거: name 기준, 정보 많은 쪽 우선
  const drMap = new Map<string, typeof merged.doctors[0]>();
  for (const dr of merged.doctors) {
    const key = dr.name.trim();
    if (!drMap.has(key)) {
      drMap.set(key, dr);
    } else {
      const existing = drMap.get(key)!;
      const existingFields = [existing.education, existing.career, existing.academic_activity].filter(Boolean).length;
      const newFields = [dr.education, dr.career, dr.academic_activity].filter(Boolean).length;
      if (newFields > existingFields) {
        drMap.set(key, { ...existing, ...dr });
      }
    }
  }
  merged.doctors = [...drMap.values()];

  // 이벤트 중복 제거: title
  const evMap = new Map<string, typeof merged.events[0]>();
  for (const ev of merged.events) {
    const key = ev.title.toLowerCase().trim();
    if (!evMap.has(key)) evMap.set(key, ev);
  }
  merged.events = [...evMap.values()];

  return merged;
}

// ============================================================
// Step 3: DB 저장
// ============================================================
async function saveAnalysis(
  hospitalId: string,
  analysis: AnalysisResult,
  sourceUrl: string,
): Promise<void> {
  // DELETE 기존 데이터
  await supabase.from('hospital_equipments').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_treatments').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_doctors').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_events').delete().eq('hospital_id', hospitalId);

  // INSERT 장비
  if (analysis.equipments.length > 0) {
    const rows = analysis.equipments.map(eq => ({
      hospital_id: hospitalId,
      equipment_name: eq.name,
      equipment_category: eq.category || 'other',
      manufacturer: eq.manufacturer || null,
      source: 'firecrawl_gemini_v3',
    }));
    const { error } = await supabase.from('hospital_equipments').insert(rows);
    if (error) console.log(`  ⚠️ 장비 INSERT: ${error.message}`);
  }

  // INSERT 시술
  if (analysis.treatments.length > 0) {
    const rows = analysis.treatments.map(tr => ({
      hospital_id: hospitalId,
      treatment_name: tr.name,
      treatment_category: tr.category || 'other',
      price: tr.price || null,
      price_note: tr.price_note || null,
      is_promoted: tr.is_promoted || false,
      combo_with: tr.combo_with || null,
      source: 'firecrawl_gemini_v3',
    }));
    const { error } = await supabase.from('hospital_treatments').insert(rows);
    if (error) console.log(`  ⚠️ 시술 INSERT: ${error.message}`);
  }

  // INSERT 의사 (career, education은 TEXT[] 배열 타입)
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

  // INSERT 이벤트
  if (analysis.events.length > 0) {
    const rows = analysis.events.map(ev => ({
      hospital_id: hospitalId,
      title: ev.title,
      description: ev.description || null,
      discount_type: ev.discount_type || null,
      discount_value: ev.discount_value || null,
      related_treatments: ev.related_treatments || [],
      source_url: sourceUrl,
      source: 'firecrawl_gemini_v3',
      tenant_id: TENANT_ID,
    }));
    const { error } = await supabase.from('hospital_events').insert(rows);
    if (error) console.log(`  ⚠️ 이벤트 INSERT: ${error.message}`);
  }

  // gemini_analyzed 업데이트
  await supabase
    .from('hospital_crawl_pages')
    .update({ gemini_analyzed: true })
    .eq('hospital_id', hospitalId);
}

// ============================================================
// Hospital ID 조회/생성
// ============================================================
async function resolveHospitalId(name: string, url: string): Promise<string | null> {
  // 1. crm_hospitals에서 찾기
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
    // hospitals에서 이름으로 찾기
    const { data: existing } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', name)
      .limit(1)
      .single();

    if (existing) {
      hospitalId = existing.id;
    } else {
      // 신규 생성
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

    // crm_hospitals 연결
    await supabase.from('crm_hospitals').update({ sales_hospital_id: hospitalId }).eq('id', crmH.id);
    console.log(`  🔗 hospital 연결: ${hospitalId}`);
  }

  // hospital 업데이트
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
  console.log('  Recrawl v3: Firecrawl + 페이지별 Gemini 분석');
  console.log('═══════════════════════════════════════════════════\n');

  const allTargets = buildTargets();
  const targets = allTargets.slice(startFrom, startFrom + limit);

  console.log(`📋 이번 실행: ${targets.length}개 (${startFrom}번째부터)`);
  console.log(`🔧 모드: ${dryRun ? 'DRY RUN' : skipGemini ? '크롤링만' : onlyGemini ? 'Gemini분석만' : '크롤링 + AI 분석'}`);
  console.log(`📐 Gemini 모델: ${getGeminiModel()}`);
  console.log(`💳 예상 크레딧: ~${targets.length * 6} (max ${targets.length * (MAX_PAGES_PER_HOSPITAL + 1)})\n`);

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
  const summary: Array<{
    no: number;
    name: string;
    pages: number;
    credits: number;
    geminiCalls: number;
    equip: number;
    treat: number;
    doctors: number;
    events: number;
    error?: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`\n───── [${i + 1}/${targets.length}] No.${t.no} ${t.name} ─────`);

    // Hospital ID
    const hospitalId = await resolveHospitalId(t.name, t.url);
    if (!hospitalId) {
      summary.push({ no: t.no, name: t.name, pages: 0, credits: 0, geminiCalls: 0, equip: 0, treat: 0, doctors: 0, events: 0, error: 'CRM not found' });
      continue;
    }

    let pages: CrawlPageResult[] = [];
    let credits = 0;

    if (!onlyGemini) {
      // Step 1: 크롤링 + DB 저장
      const crawlResult = await crawlAndSave(hospitalId, t.name, t.url);
      pages = crawlResult.pages;
      credits = crawlResult.credits;
      totalCredits += credits;
      totalPages += pages.length;
    } else {
      // only-gemini: DB에서 기존 페이지 읽기
      const { data: dbPages } = await supabase
        .from('hospital_crawl_pages')
        .select('url, page_type, markdown, char_count')
        .eq('hospital_id', hospitalId)
        .order('crawled_at');

      if (dbPages && dbPages.length > 0) {
        pages = dbPages.map(p => ({
          url: p.url,
          pageType: p.page_type,
          markdown: p.markdown,
          charCount: p.char_count,
        }));
        console.log(`  📂 DB에서 ${pages.length}페이지 로드`);
      } else {
        console.log(`  ⚠️ DB에 저장된 페이지 없음`);
      }
    }

    if (pages.length === 0) {
      summary.push({ no: t.no, name: t.name, pages: 0, credits, geminiCalls: 0, equip: 0, treat: 0, doctors: 0, events: 0, error: 'no pages' });
      continue;
    }

    // Step 2: 페이지별 Gemini 분석
    let geminiCalls = 0;
    const analysis: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

    if (!skipGemini) {
      const pageResults: AnalysisResult[] = [];

      for (let j = 0; j < pages.length; j++) {
        const p = pages[j];
        const shortUrl = p.url.length > 50 ? p.url.substring(0, 50) + '...' : p.url;
        console.log(`  🤖 [${j + 1}/${pages.length}] ${p.pageType} (${p.charCount.toLocaleString()}자) ${shortUrl}`);

        const result = await analyzePage(t.name, p.url, p.pageType, p.markdown);
        pageResults.push(result);

        const chunks = splitIntoChunks(p.markdown);
        geminiCalls += p.charCount < MIN_PAGE_CHARS ? 0 : chunks.length;

        if (j < pages.length - 1) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
        }
      }

      // 병합 + 중복 제거
      const merged = mergeAndDeduplicate(pageResults);
      analysis.equipments = merged.equipments;
      analysis.treatments = merged.treatments;
      analysis.doctors = merged.doctors;
      analysis.events = merged.events;

      console.log(`  📊 결과: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length} (Gemini ${geminiCalls}회)`);

      // Step 3: DB 저장
      await saveAnalysis(hospitalId, analysis, t.url);
      console.log(`  💾 저장 완료`);
    }

    totalGeminiCalls += geminiCalls;
    summary.push({
      no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
      equip: analysis.equipments.length, treat: analysis.treatments.length,
      doctors: analysis.doctors.length, events: analysis.events.length,
    });

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
  }

  // 결과 저장
  const outputPath = path.resolve(__dirname, 'data', 'recrawl-v3-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  // 최종 요약
  const totals = summary.reduce(
    (acc, s) => ({
      equip: acc.equip + s.equip,
      treat: acc.treat + s.treat,
      doctors: acc.doctors + s.doctors,
      events: acc.events + s.events,
    }),
    { equip: 0, treat: 0, doctors: 0, events: 0 }
  );

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Recrawl v3 결과 요약');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✅ 성공: ${summary.filter(s => !s.error).length}개`);
  console.log(`  ❌ 실패: ${summary.filter(s => s.error).length}개`);
  console.log(`  📄 총 크롤 페이지: ${totalPages}개`);
  console.log(`  🤖 총 Gemini 호출: ${totalGeminiCalls}회`);
  console.log(`  💳 크레딧 사용: ${totalCredits}`);
  console.log(`  📊 장비: ${totals.equip} | 시술: ${totals.treat} | 의사: ${totals.doctors} | 이벤트: ${totals.events}`);
  console.log(`  💾 결과: ${outputPath}`);

  if (summary.some(s => s.error)) {
    console.log(`\n⚠️ 실패:`);
    summary.filter(s => s.error).forEach(s => console.log(`   No.${s.no} ${s.name}: ${s.error}`));
  }
}

main().catch(console.error);
