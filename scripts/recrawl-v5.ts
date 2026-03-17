/**
 * recrawl-v5.ts
 *
 * TORR RF 재크롤링 v5.4 UNIFIED:
 * 1. URL 수집 확대 (mapUrl 100 + HTML 링크 fallback + /landing/ 포함)
 * 2. 다중 스크린샷 (actions: 스크롤 4장 + fallback 기본 스크린샷)
 * 3. v5 프롬프트 (시술→장비 분리, 메뉴 시술, 장비 정규화 24종, 다지점, KOL)
 * 4. [v5.1] 카드+모달 자동 감지 → Puppeteer 순차 클릭 → 의사 상세 보강
 * 5. [v5.1] 탭/아코디언 콘텐츠 클릭 대응
 * 6. [v5.2] 2단계 검증:
 *    - 1단계: Sanity Check (최소 기대치: 의사≥1, 시술≥3)
 *    - INSUFFICIENT → 보강 크롤 (COMMON_PATHS) → 재분석
 *    - 2단계: Gemini 커버리지 체크 (70%+ PASS / 50~69% PARTIAL / <50% FAIL)
 * 7. [v5.2] 0/0=100% 방지: 원본에 정보 없으면 -1(판정 불가)로 처리
 * 8. 커버리지 70% 미만 → 자동 재분석
 * 9. 페이지 수: 필터 통과 전부, 50개 초과 시만 우선순위 정렬
 * 10. [v5.3] 원페이지 + 이미지 기반 사이트 대응
 * 11. [v5.4] 2-Step 분리 파이프라인:
 *    - Step 1: OCR 전용 (이미지 → 텍스트만 추출, 분류 안함)
 *    - Step 2: 분류 전용 (OCR 텍스트 + 크롤 마크다운 → 7-category 구조화)
 * 12. [v5.4] 의사 이름 웹 검증 (Puppeteer Google 검색)
 * 13. [v5.4] URL trailing slash 정규화 + 콘텐츠 해시 중복감지
 * 14. [v5.4] SUFFICIENT에서도 팝업 이미지 OCR / 장비 0개 시 배너 재캡처 (2-step)
 * 15. [v5.4] OCR raw text 파일 저장 (디버깅용)
 * 16. [v5.4] contact_info 7번째 카테고리 (이메일, 전화, SNS, 운영시간)
 * 17. [v5.4] 시술명 공백 정규화 + ~클리닉 카테고리 분리 (후처리)
 * 18. [v5.4] 학술활동 독립 추출 (의사 0명이어도 보존)
 * 19. [v5.4] 429 exponential backoff (30s→480s, max 5회)
 * 20. [v5.4] 보고서 자동 생성 (REPORT-FORMAT-RULE-v2 형식)
 *
 * 실행: npx tsx scripts/recrawl-v5.ts --limit 3
 * 옵션: --dry-run | --limit N | --start-from N | --skip-gemini | --only-gemini | --name "병원명" | --no-screenshot | --playwright-only | --ocr
 * --ocr: 추가 라이브 URL 스크린샷 촬영 → Gemini 멀티모달 분석 (이미지 기반 사이트에서 시술/장비 추출 10~100배 향상)
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import sharp from 'sharp';
import { supabase } from './utils/supabase.js';
import { getAccessToken, isApiKeyMode } from './analysis/gemini-auth.js';
import { getGeminiModel, getGeminiEndpoint } from './utils/gemini-model.js';
import { buildExtractionPrompt, buildValidationPrompt, buildImageBannerPrompt, OCR_PROMPT, buildClassifyPrompt } from './v5/prompts.js';
import {
  filterRelevantUrls, classifyPageType, prioritizeUrls,
  extractLinksFromMarkdown,
} from './v5/url-utils.js';
import { mergeAndDeduplicate } from './v5/merge-dedup.js';
import puppeteer from 'puppeteer';
import { needsModalCrawl, crawlDoctorModals } from './v5/doctor-modal.js';
import { extractDoctorPhotosFromPage } from './v5/doctor-photo.js';
import { normalizeDoctorsBatch } from './v5/doctor-normalize.js';
import { enrichDoctorBatch } from './v5/doctor-enrich.js';
import type { AnalysisResult, CrawlPageResult, ScreenshotEntry, ValidationResult, HospitalAnalysisV54, OcrResult, ContactInfo, MedicalDeviceV54, DeviceDictionaryEntry, StructuredAcademic } from './v5/types.js';
import { detectSiteType, classifyCrawlError } from './v5/site-fingerprint.js';
import type { SiteFingerprint, CrawlFailReason } from './v5/site-fingerprint.js';
import { detectTorrRf } from './v5/torr-detector.js';
import type { TorrDetectionResult } from './v5/torr-detector.js';
import { extractContactsFromText, mergeContacts } from './v5/contact-extractor.js';
import { captureScreenshots, captureMultiplePages, closeBrowser as closePlaywright } from './v5/screenshot-capture.js';
import type { ScreenshotResult as PlaywrightScreenshotResult } from './v5/screenshot-capture.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel, AlignmentType, ImageRun } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

// [v5.7] Windows Puppeteer EBUSY 에러 무시 (프로세스 종료 시 temp 디렉토리 삭제 실패)
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EBUSY' && err.path?.includes('puppeteer')) {
    console.log(`  ⚠️ Puppeteer temp cleanup 무시: ${err.path}`);
    return;
  }
  // [v5.8] EPIPE는 stdout 파이프 닫힘 — 로그 없이 무시 (console.log → EPIPE → 무한루프 방지)
  if (err.code === 'EPIPE') return;
  // [v5.8] 네트워크/타임아웃 에러는 크래시 방지 — 로그만 남기고 계속 진행
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED'
    || err.code === 'ERR_SOCKET_CONNECTION_TIMEOUT'
    || err.message?.includes('socket hang up') || err.message?.includes('timeout')) {
    console.log(`  ⚠️ 네트워크 에러 무시 (계속 진행): ${err.code || err.message}`);
    return;
  }
  console.error('Fatal uncaught exception:', err);
  process.exit(1);
});

// [v5.8] unhandledRejection 방어 — 비동기 에러로 인한 갑작스러운 크래시 방지
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')
    || msg.includes('socket hang up') || msg.includes('Navigation timeout')
    || msg.includes('net::ERR_') || msg.includes('Protocol error')) {
    console.log(`  ⚠️ unhandledRejection 무시 (계속 진행): ${msg.slice(0, 120)}`);
    return;
  }
  console.error('Unhandled rejection:', reason);
});

// ============================================================
// site_type 분류 헬퍼
// ============================================================
type SiteTypeLabel = 'website' | 'naver_blog' | 'other_blog';

function classifySiteType(fp: SiteFingerprint | null, url: string): SiteTypeLabel {
  if (fp?.siteType === 'naver_blog') return 'naver_blog';
  if (/blog\.naver\.com|m\.blog\.naver\.com/i.test(url)) return 'naver_blog';
  if (/tistory\.com|blog\.daum\.net|blog\.me/i.test(url)) return 'other_blog';
  return 'website';
}

// ============================================================
// 설정
// ============================================================
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SOURCE_TAG = 'firecrawl_gemini_v5';
const MAX_PAGES = 50;
const DELAY_BETWEEN_HOSPITALS = 3000;
const DELAY_BETWEEN_PAGES = 1000;
const DELAY_BETWEEN_GEMINI = 2000;  // 무료: 4500, 유료: 2000
const GEMINI_TIMEOUT = 90000;
const CHUNK_SIZE = 25000;
const MIN_PAGE_CHARS = 500;

// ============================================================
// Firecrawl 초기화
// ============================================================
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
const firecrawlApiUrl = process.env.FIRECRAWL_API_URL || undefined;
if (!firecrawlApiKey) { console.error('❌ FIRECRAWL_API_KEY 미설정'); process.exit(1); }
const firecrawlApp = new FirecrawlApp({ apiKey: firecrawlApiKey, apiUrl: firecrawlApiUrl });
const firecrawl = firecrawlApp as unknown as {
  v1: {
    scrapeUrl: (url: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
    mapUrl: (url: string, opts: Record<string, unknown>) => Promise<{ success: boolean; links?: string[] }>;
  };
};

const EMPTY_RESULT: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };

// ============================================================
// [v5.6] 파일 로거 (콘솔 + 파일 동시 기록, UTF-8)
// ============================================================
const LOG_DIR = path.resolve(__dirname, '..', 'output', 'logs');
let logStream: fs.WriteStream | null = null;

function initLogger(): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(LOG_DIR, `run_${ts}.log`);
  logStream = fs.createWriteStream(logPath, { encoding: 'utf8', flags: 'a' });
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => {
    const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    origLog(...args);
    logStream?.write(line + '\n');
  };
  console.error = (...args: unknown[]) => {
    const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    origErr(...args);
    logStream?.write('[ERROR] ' + line + '\n');
  };
  return logPath;
}

function closeLogger(): void {
  logStream?.end();
  logStream = null;
}

// ============================================================
// [v5.6] 사전 점검 (preflight)
// ============================================================
async function preflight(options: { skipGemini?: boolean }): Promise<boolean> {
  console.log('\n🔍 사전 점검 시작...');
  let allOk = true;

  // 1. Supabase 연결
  try {
    const { error } = await supabase.from('hospitals').select('id').limit(1);
    if (error) throw new Error(error.message);
    console.log('  ✅ Supabase 연결 OK');
  } catch (err) {
    console.error(`  ❌ Supabase 연결 실패: ${err instanceof Error ? err.message : err}`);
    allOk = false;
  }

  // 2. Firecrawl 서버 헬스체크
  const firecrawlUrl = process.env.FIRECRAWL_API_URL || 'http://84.247.154.185:3002';
  try {
    const res = await fetch(firecrawlUrl, { method: 'GET', signal: AbortSignal.timeout(10000) });
    if (!res.ok && res.status !== 404 && res.status !== 405) throw new Error(`HTTP ${res.status}`);
    console.log(`  ✅ Firecrawl (${firecrawlUrl}) 응답 OK`);
  } catch (err) {
    console.error(`  ❌ Firecrawl 연결 실패: ${firecrawlUrl} 응답 없음 — ${err instanceof Error ? err.message : err}`);
    allOk = false;
  }

  // 3. Gemini API 인증
  if (!options.skipGemini) {
    try {
      const token = await getAccessToken();
      if (!token || token.length < 10) throw new Error('토큰 길이 부족');
      console.log(`  ✅ Gemini API 인증 OK (토큰: ${token.length}자)`);
    } catch (err) {
      console.error(`  ❌ Gemini API 인증 실패: ${err instanceof Error ? err.message : err}`);
      allOk = false;
    }
  } else {
    console.log('  ⏭️ Gemini 점검 스킵 (--skip-gemini)');
  }

  // 4. 디스크 공간 (output 폴더 기준)
  try {
    const outputDir = path.resolve(__dirname, '..', 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    const testFile = path.join(outputDir, '.disk-check-tmp');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('  ✅ 디스크 쓰기 OK');
  } catch (err) {
    console.error(`  ❌ 디스크 쓰기 실패: ${err instanceof Error ? err.message : err}`);
    allOk = false;
  }

  if (allOk) {
    console.log('✅ 사전 점검 통과\n');
  } else {
    console.error('\n🛑 사전 점검 실패 — 위의 에러를 해결 후 재실행하세요.');
  }
  return allOk;
}

// ============================================================
// [v5.6] --skip-done: 완료된 병원 스킵
// ============================================================
async function getCompletedHospitalIds(): Promise<Set<string>> {
  const skipStatuses = ['pass', 'partial', 'completed'];
  const { data, error } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id, status')
    .in('status', skipStatuses);
  if (error || !data) return new Set();
  return new Set(data.map(d => d.hospital_id));
}

// ============================================================
// [v5.6] 연속 에러 카운터
// ============================================================
const MAX_CONSECUTIVE_ERRORS = 5;

// ============================================================
// 크롤 대상 빌드
// ============================================================
interface CrawlTarget { no: number; name: string; region: string; url: string; source: string; }

// ============================================================
// [v5.5] 위치명 검증 + 프랜차이즈 감지 (결함 6)
// ============================================================
const SIDO_SHORT: Record<string, string> = {
  '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구', '인천광역시': '인천',
  '광주광역시': '광주', '대전광역시': '대전', '울산광역시': '울산', '세종특별자치시': '세종',
  '경기도': '경기', '강원특별자치도': '강원', '강원도': '강원',
  '충청북도': '충북', '충청남도': '충남', '전라북도': '전북', '전북특별자치도': '전북',
  '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
};

interface ResolvedRegion {
  region: string;           // 최종 위치명 (예: "안산", "강남")
  source: 'address' | 'db' | 'url';
  mismatch: boolean;        // DB 등록 region과 불일치 여부
  dbRegion: string;         // DB 등록 region
  crawledAddress?: string;  // Gemini 추출 주소
  franchise?: { domain: string; branch: string; totalBranches?: number };
}

function resolveRegionFromAddress(
  fullAddress: string | undefined | null,
  sido: string | undefined | null,
  sigungu: string | undefined | null,
  dbRegion: string,
  url: string,
): ResolvedRegion {
  const base: ResolvedRegion = { region: dbRegion, source: 'db', mismatch: false, dbRegion, crawledAddress: fullAddress || undefined };

  // 1순위: 주소에서 시군구 추출
  if (fullAddress) {
    // "경기도 안산시 단원구 ..." → "안산"
    // "서울특별시 강남구 ..." → "강남"
    const sigunguName = sigungu || extractSigungu(fullAddress);
    if (sigunguName) {
      const short = sigunguName.replace(/시$|구$|군$/, '').trim();
      if (short && short !== dbRegion) {
        base.mismatch = true;
      }
      base.region = short || dbRegion;
      base.source = 'address';
    } else if (sido) {
      const short = SIDO_SHORT[sido] || sido.replace(/특별시$|광역시$|특별자치시$|도$|특별자치도$/, '').trim();
      if (short && short !== dbRegion) base.mismatch = true;
      base.region = short || dbRegion;
      base.source = 'address';
    }
  }

  // 프랜차이즈 감지: 서브도메인 패턴 (xx.domain.com)
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    const COMMON_SUBS = new Set(['www', 'm', 'mobile', 'app', 'api', 'mail', 'ftp', 'blog']);
    if (parts.length >= 3 && parts[0].length <= 4 && /^[a-z]{2,4}$/.test(parts[0]) && !COMMON_SUBS.has(parts[0])) {
      const mainDomain = parts.slice(1).join('.');
      base.franchise = { domain: mainDomain, branch: parts[0] };
    }
  } catch { /* ignore */ }

  return base;
}

function extractSigungu(fullAddress: string): string | null {
  // "서울특별시 강남구 도산대로 107" → "강남구"
  // "경기도 안산시 단원구 고잔로 76" → "안산시"
  const match = fullAddress.match(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충[청남북]|전[라남북]|경[상남북]|제주)[^\s]*\s+(\S+[시구군])/);
  if (match) return match[1];
  // fallback: 두 번째 단어가 시/구/군
  const words = fullAddress.split(/\s+/);
  for (const w of words.slice(1)) {
    if (/[시구군]$/.test(w)) return w;
  }
  return null;
}

function buildTargets(): CrawlTarget[] {
  const targetsPath = path.resolve(__dirname, 'data', 'step2-crawl-targets.json');
  const existing: CrawlTarget[] = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
  const existingNos = new Set(existing.map(t => t.no));

  const masterPath = path.resolve(__dirname, '..', 'torr-rf-master-71-v2.json');
  interface MasterEntry { no: number; name: string; region: string; website: string | null; phase: string; }
  const master: MasterEntry[] = JSON.parse(fs.readFileSync(masterPath, 'utf-8'));

  const done = master.filter(m => m.phase === 'DONE' && m.website && !existingNos.has(m.no));
  for (const h of done) {
    existing.push({ no: h.no, name: h.name, region: h.region, url: h.website!, source: 'done_recrawl' });
  }

  console.log(`📋 대상: 기존 ${existingNos.size}개 + DONE ${done.length}개 = ${existing.length}개`);
  return existing;
}

// [v5.7] batch-selector.ts가 생성한 targets.json 로드
function loadExternalTargets(inputPath: string): CrawlTarget[] {
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ --input 파일 없음: ${absPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
  // batch-selector 형식: { targets: [{ hospitalId, name, region, url, ... }] }
  const batchTargets: Array<{ hospitalId: string; name: string; region: string | null; url: string }> =
    Array.isArray(raw) ? raw : (raw.targets ?? []);

  const targets: CrawlTarget[] = batchTargets.map((t, i) => ({
    no: i + 1,
    name: t.name,
    region: t.region ?? '',
    url: t.url,
    source: 'batch_selector',
  }));

  console.log(`📋 외부 입력: ${absPath} → ${targets.length}개 대상`);
  return targets;
}

// ============================================================
// Step 1: URL 수집 (v5 확대)
// ============================================================
async function collectBlogUrls(blogMainUrl: string, name: string): Promise<{ urls: string[]; credits: number }> {
  console.log('  📝 네이버 블로그 감지 — scrapeUrl 전략');
  let credits = 0;
  const urls: string[] = [blogMainUrl];

  try {
    const mobileMain = blogMainUrl.replace('blog.naver.com', 'm.blog.naver.com');
    const result = await firecrawl.v1.scrapeUrl(mobileMain, {
      formats: ['markdown'],
      waitFor: 5000,
    });
    credits += 1;
    const md = (result.markdown as string) || '';

    const postPattern = /https?:\/\/(?:m\.)?blog\.naver\.com\/[^/\s)]+\/(\d{9,})/g;
    const matches = md.matchAll(postPattern);
    const postUrls = [...new Set([...matches].map(m => m[0]))];

    const normalizedPosts = postUrls.map(u => u.replace('m.blog.naver.com', 'blog.naver.com'));
    urls.push(...normalizedPosts);
    console.log(`  📄 블로그 포스트 ${normalizedPosts.length}개 발견`);
  } catch (err) {
    console.log(`  ⚠️ 블로그 메인 scrape 실패: ${err}`);
  }

  const MAX_BLOG_POSTS = 10;
  if (urls.length > MAX_BLOG_POSTS + 1) {
    console.log(`  ✂️ ${urls.length - 1}개 → 최근 ${MAX_BLOG_POSTS}개 포스트로 제한`);
    return { urls: urls.slice(0, MAX_BLOG_POSTS + 1), credits };
  }

  return { urls: [...new Set(urls)], credits };
}

async function collectUrls(mainUrl: string, name: string): Promise<{ urls: string[]; credits: number }> {
  let credits = 0;

  // ★ 네이버 블로그: mapUrl 대신 메인 scrape → 포스트 링크 추출
  if (/blog\.naver\.com/i.test(mainUrl)) {
    return await collectBlogUrls(mainUrl, name);
  }

  // 1차: mapUrl (limit: 100)
  let urls: string[] = [mainUrl];
  try {
    console.log('  📍 URL 수집 (mapUrl limit:100)...');
    const mapResult = await firecrawl.v1.mapUrl(mainUrl, { limit: 100 });
    credits += 1;
    if (mapResult.success && mapResult.links && mapResult.links.length > 0) {
      urls = [...new Set([mainUrl, ...mapResult.links])];
      console.log(`  📄 mapUrl: ${mapResult.links.length}개 URL`);
    }
  } catch {
    console.log(`  ⚠️ mapUrl 실패`);
  }

  // 2차: 5개 미만이면 메인 HTML에서 내부 링크 추출
  if (urls.length < 5) {
    console.log(`  🔎 URL 부족(${urls.length}개) → 메인 페이지 링크 추출...`);
    try {
      const mainPage = await firecrawl.v1.scrapeUrl(mainUrl, {
        formats: ['markdown'],
        waitFor: 5000,
      });
      credits += 1;
      const md = (mainPage.markdown as string) || '';
      const domain = new URL(mainUrl).hostname;
      const extracted = extractLinksFromMarkdown(md, mainUrl, domain);
      urls = [...new Set([...urls, ...extracted])];
      console.log(`  📄 HTML 링크 추출: +${extracted.length}개 → 총 ${urls.length}개`);
    } catch {
      console.log(`  ⚠️ HTML 링크 추출 실패`);
    }
  }

  // [v5.4] URL 정규화 (trailing slash 중복 방지)
  urls = [...new Set(urls.map(normalizeUrl))];

  // 필터링
  const filtered = filterRelevantUrls(urls, mainUrl);
  // 메인 URL은 항상 포함
  const normalizedMain = normalizeUrl(mainUrl);
  if (!filtered.some(u => normalizeUrl(u) === normalizedMain)) filtered.unshift(mainUrl);
  console.log(`  🎯 필터 후: ${filtered.length}개`);

  // 50개 초과 시에만 우선순위 정렬
  if (filtered.length > MAX_PAGES) {
    const prioritized = prioritizeUrls(filtered, mainUrl).slice(0, MAX_PAGES);
    console.log(`  ✂️ ${filtered.length}개 → 우선순위 상위 ${MAX_PAGES}개`);
    return { urls: prioritized, credits };
  }

  return { urls: filtered, credits };
}

// ============================================================
// Step 2: 다중 스크린샷 크롤링 + 원본 DB 저장
// ============================================================
async function optimizeScreenshot(imageBuffer: Buffer): Promise<Buffer> {
  return await sharp(imageBuffer).resize(1280, null, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

async function uploadScreenshot(
  hospitalId: string, pageType: string, url: string,
  imageBuffer: Buffer, position: string,
): Promise<string | null> {
  try {
    const optimized = await optimizeScreenshot(imageBuffer);
    const slug = new URL(url).pathname.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
    const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filePath = `${hospitalId}/${pageType}_${slug}_${timestamp}_${position}.webp`;

    const { error } = await supabase.storage.from('hospital-screenshots')
      .upload(filePath, optimized, { contentType: 'image/webp', upsert: true });

    if (error) { console.log(`    ⚠️ Storage 업로드 실패(${position}): ${error.message}`); return null; }

    const { data: urlData } = supabase.storage.from('hospital-screenshots').getPublicUrl(filePath);
    return urlData.publicUrl;
  } catch (err) {
    console.log(`    ⚠️ 스크린샷 처리 실패(${position}): ${err}`);
    return null;
  }
}

async function downloadScreenshotUrl(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url);
    return Buffer.from(await resp.arrayBuffer());
  } catch { return null; }
}

async function scrapePageWithActions(url: string): Promise<{
  markdown: string;
  rawHtml: string;
  defaultScreenshot: string | null;
  actionScreenshots: string[];
  success: boolean;
}> {
  // 1차: actions 포함 scrape (popup close는 선택적 — 실패해도 스크롤은 진행)
  try {
    const useActions = !firecrawlApiUrl; // 셀프호스팅에서는 actions 미지원
    const scrapeOpts: Record<string, unknown> = {
      formats: useActions ? ['markdown', 'rawHtml', 'screenshot'] : ['markdown', 'rawHtml'],
      waitFor: 3000,
      timeout: 30000,
    };
    if (useActions) {
      scrapeOpts.actions = [
        { type: 'screenshot' },
        { type: 'scroll', direction: 'down', amount: 3 },
        { type: 'wait', milliseconds: 500 },
        { type: 'screenshot' },
        { type: 'scroll', direction: 'down', amount: 3 },
        { type: 'wait', milliseconds: 500 },
        { type: 'screenshot' },
        { type: 'scroll', direction: 'down', amount: 5 },
        { type: 'wait', milliseconds: 500 },
        { type: 'screenshot' },
      ];
    }
    const result = await firecrawl.v1.scrapeUrl(url, scrapeOpts);

    if (result.success) {
      const md = (result.markdown as string) || '';
      const html = (result.rawHtml as string) || '';
      const defaultSS = (result.screenshot as string) || null;
      const actions = result.actions as { screenshots?: string[] } | undefined;
      const actionSSs = actions?.screenshots || [];
      return { markdown: md, rawHtml: html, defaultScreenshot: defaultSS, actionScreenshots: actionSSs, success: true };
    }
  } catch (err) {
    console.log(`    ⚠️ actions scrape 실패 → fallback (${(err as Error).message?.substring(0, 80)})`);
  }

  // 2차: actions 없이 기본 scrape (fallback)
  try {
    const result = await firecrawl.v1.scrapeUrl(url, {
      formats: ['markdown'],
      timeout: 30000,
    });

    if (!result.success) return { markdown: '', rawHtml: '', defaultScreenshot: null, actionScreenshots: [], success: false };

    const md = (result.markdown as string) || '';
    const html = (result.rawHtml as string) || '';
    const defaultSS = (result.screenshot as string) || null;
    return { markdown: md, rawHtml: html, defaultScreenshot: defaultSS, actionScreenshots: [], success: true };
  } catch (err) {
    console.log(`    ❌ scrape 완전 실패: ${err}`);
    return { markdown: '', rawHtml: '', defaultScreenshot: null, actionScreenshots: [], success: false };
  }
}

async function crawlAndSave(hospitalId: string, name: string, mainUrl: string): Promise<{
  pages: CrawlPageResult[];
  credits: number;
  siteFingerprint: SiteFingerprint | null;
  attemptedUrls: string[];
  failedUrls: string[];
}> {
  console.log(`\n🏥 [${name}] 크롤링: ${mainUrl}`);
  const pages: CrawlPageResult[] = [];

  // URL 수집
  const { urls, credits: mapCredits } = await collectUrls(mainUrl, name);
  let credits = mapCredits;

  // 기존 crawl_pages 삭제
  await supabase.from('scv_crawl_pages').delete().eq('hospital_id', hospitalId);

  const FIRECRAWL_CONCURRENCY = 3;
  const totalBatches = Math.ceil(urls.length / FIRECRAWL_CONCURRENCY);
  console.log(`  🔄 ${urls.length}페이지 크롤 (markdown + screenshot × 4, ${FIRECRAWL_CONCURRENCY}개 병렬)...`);

  // [v5.4] 콘텐츠 해시 중복 감지
  const seenHashes = new Set<string>();
  let hashSkipCount = 0;
  let siteFingerprint: SiteFingerprint | null = null;
  const failedUrls: string[] = [];

  for (let bi = 0; bi < urls.length; bi += FIRECRAWL_CONCURRENCY) {
    const batch = urls.slice(bi, bi + FIRECRAWL_CONCURRENCY);
    const batchNum = Math.floor(bi / FIRECRAWL_CONCURRENCY) + 1;
    console.log(`  [OPTIMIZE] Firecrawl parallel batch ${batchNum}/${totalBatches} (${batch.length} pages)`);

    // 병렬 scrape
    const scrapeResults = await Promise.allSettled(
      batch.map(url => scrapePageWithActions(url)),
    );
    credits += batch.length;

    // 순차 후처리 (해시 중복, 스크린샷, DB 저장)
    for (let ri = 0; ri < batch.length; ri++) {
      const targetUrl = batch[ri];
      const shortUrl = targetUrl.length > 70 ? targetUrl.substring(0, 70) + '...' : targetUrl;
      console.log(`    → ${shortUrl}`);

      const settled = scrapeResults[ri];
      if (settled.status === 'rejected') {
        console.log(`    ⚠️ 스킵 (${String(settled.reason).substring(0, 80)})`);
        failedUrls.push(targetUrl);
        continue;
      }

      const { markdown: md, rawHtml, defaultScreenshot, actionScreenshots, success } = settled.value;
      if (!success) { console.log(`    ⚠️ 스킵`); failedUrls.push(targetUrl); continue; }

      // [v5.4 작업3] 첫 페이지에서 사이트 유형 핑거프린팅
      if (siteFingerprint === null && rawHtml) {
        siteFingerprint = detectSiteType(rawHtml, targetUrl);
        console.log(`    🏷️ 사이트 유형: ${siteFingerprint.siteType} (${Math.round(siteFingerprint.confidence * 100)}%) [${siteFingerprint.signals.join(', ')}]`);
        if (siteFingerprint.traits.length > 0) {
          console.log(`    📐 특성: ${siteFingerprint.traits.join(', ')}`);
        }
      }

      // [v5.4] 콘텐츠 해시 중복 감지
      const hash = contentHash(md);
      if (seenHashes.has(hash) && md.length > 200) {
        hashSkipCount++;
        console.log(`    🔄 콘텐츠 해시 동일 → SPA 중복 스킵`);
        continue;
      }
      seenHashes.add(hash);

      const pageType = classifyPageType(targetUrl, mainUrl);

      // 다중 스크린샷 처리 → JSONB 배열
      const positions = ['popup', 'top', 'mid', 'bottom'];
      const screenshotEntries: ScreenshotEntry[] = [];
      const screenshotBuffers: Buffer[] = [];

      for (let si = 0; si < actionScreenshots.length && si < positions.length; si++) {
        const buf = await downloadScreenshotUrl(actionScreenshots[si]);
        if (buf) {
          const storageUrl = await uploadScreenshot(hospitalId, pageType, targetUrl, buf, positions[si]);
          if (storageUrl) {
            screenshotEntries.push({ url: storageUrl, position: positions[si], order: si });
            screenshotBuffers.push(buf);
          }
        }
      }

      // 기본 screenshot도 보관 (actions 실패 시 fallback)
      if (screenshotEntries.length === 0 && defaultScreenshot) {
        const buf = await downloadScreenshotUrl(defaultScreenshot);
        if (buf) {
          const storageUrl = await uploadScreenshot(hospitalId, pageType, targetUrl, buf, 'default');
          if (storageUrl) {
            screenshotEntries.push({ url: storageUrl, position: 'default', order: 0 });
            screenshotBuffers.push(buf);
          }
        }
      }

      // DB 저장 (screenshot_url은 JSONB 배열)
      const { error: insertErr } = await supabase.from('scv_crawl_pages').insert({
        hospital_id: hospitalId,
        url: targetUrl,
        page_type: pageType,
        markdown: md,
        char_count: md.length,
        screenshot_url: screenshotEntries.length > 0 ? JSON.stringify(screenshotEntries) : '[]',
        analysis_method: 'pending',
        tenant_id: TENANT_ID,
        gemini_analyzed: false,
      });

      if (insertErr) {
        console.log(`    ⚠️ DB 저장 실패: ${insertErr.message}`);
      } else {
        pages.push({
          url: targetUrl, pageType, markdown: md, charCount: md.length,
          screenshotEntries, screenshotBuffers,
        });
        console.log(`    ✅ ${md.length.toLocaleString()}자 [${pageType}] 📸${screenshotEntries.length}장`);
      }
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
  }

  if (hashSkipCount > 0) {
    console.log(`  🔄 [v5.4] 콘텐츠 해시 중복 ${hashSkipCount}개 스킵`);
  }
  if (failedUrls.length > 0) {
    console.log(`  ⚠️ Firecrawl 실패: ${failedUrls.length}/${urls.length}개 URL`);
  }
  console.log(`  📊 ${pages.length}페이지 저장 | ${credits}크레딧 | 스크린샷 총${pages.reduce((a, p) => a + p.screenshotEntries.length, 0)}장`);
  return { pages, credits, siteFingerprint, attemptedUrls: urls, failedUrls };
}

// ============================================================
// Gemini 호출 (텍스트 / Vision)
// ============================================================
async function callGemini(
  prompt: string,
  content: { type: 'text'; text: string } | { type: 'images'; buffers: Buffer[] },
): Promise<AnalysisResult> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();

  let parts: Array<Record<string, unknown>>;
  if (content.type === 'text') {
    parts = [{ text: prompt + '\n\n웹사이트 텍스트:\n' + content.text }];
  } else {
    // 다중 이미지 + 텍스트 프롬프트
    parts = [];
    for (const buf of content.buffers) {
      const optimized = await optimizeScreenshot(buf);
      parts.push({ inlineData: { mimeType: 'image/webp', data: optimized.toString('base64') } });
    }
    parts.push({ text: prompt });
  }

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
  });

  const doFetch = async (token: string, retryCount = 0): Promise<AnalysisResult> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(GEMINI_TIMEOUT),
    });

    if (res.status === 429) {
      if (retryCount >= 5) {
        console.log(`    ❌ 429 Rate Limit 5회 초과 — 스킵`);
        return EMPTY_RESULT;
      }
      const wait = 30000 * Math.pow(2, retryCount);
      console.log(`    ⏳ 429 Rate Limit — ${wait / 1000}초 대기 (${retryCount + 1}/5)`);
      await new Promise(r => setTimeout(r, wait));
      return doFetch(await getAccessToken(), retryCount + 1);
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return safeJsonParse(text);
  };

  return doFetch(accessToken);
}

function safeJsonParse(text: string): AnalysisResult {
  try {
    return robustJsonParse<AnalysisResult>(text, 'callGemini');
  } catch {
    console.log(`    ⚠️ JSON 파싱 실패`);
    return EMPTY_RESULT;
  }
}

// ============================================================
// [v5.4] URL 정규화 + 콘텐츠 해시
// ============================================================
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let pathname = u.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '';
    return `${u.protocol}//${u.host}${pathname}${u.search}`;
  } catch { return url; }
}

function contentHash(text: string): string {
  return crypto.createHash('md5').update(text.trim()).digest('hex');
}

// ============================================================
// [v5.4] Step 1: OCR 전용 — 이미지 → 텍스트만 추출
// ============================================================
async function extractTextFromImage(imageBuffer: Buffer, retryCount = 0): Promise<string> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();

  const optimized = await optimizeScreenshot(imageBuffer);
  const base64 = optimized.toString('base64');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: 'image/webp', data: base64 } },
        { text: OCR_PROMPT },
      ] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT),
  });

  if (res.status === 429) {
    if (retryCount >= 5) {
      console.log(`    ❌ OCR 429 Rate Limit 5회 초과 — 스킵`);
      return '';
    }
    const wait = 30000 * Math.pow(2, retryCount);
    console.log(`    ⏳ 429 Rate Limit — ${wait / 1000}초 대기 (${retryCount + 1}/5)`);
    await new Promise(r => setTimeout(r, wait));
    return extractTextFromImage(imageBuffer, retryCount + 1);
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini OCR ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

// ============================================================
// [v5.6] 비급여항목표 전처리 — 비급여 섹션을 텍스트에서 분리하여 끝에 명시적 배치
// ============================================================
function extractNongeubyeoSection(allText: string): { mainText: string; nongeubyeoSection: string | null } {
  const NONGEUBYEO_KEYWORDS = ['비급여항목안내', '비급여항목', '비급여안내', '비급여 진료비', '비급여진료비'];
  const lines = allText.split('\n');
  const tableBlocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasNongeubyeoKeyword = NONGEUBYEO_KEYWORDS.some(kw => line.includes(kw));

    if (hasNongeubyeoKeyword) {
      // 비급여 키워드 발견 → 이후 테이블 행 수집 (최대 500줄 탐색, 테이블 전 50줄 제한)
      const block: string[] = [line];
      let tableStarted = false;
      let emptyLineCount = 0;
      let nonTableLines = 0;

      for (let j = i + 1; j < Math.min(i + 500, lines.length); j++) {
        const nextLine = lines[j];
        const isTableRow = nextLine.trim().startsWith('|') && nextLine.includes('|');
        const isSeparator = /^\|[\s\-|]+\|$/.test(nextLine.trim());

        if (isTableRow || isSeparator) {
          block.push(nextLine);
          tableStarted = true;
          emptyLineCount = 0;
          nonTableLines = 0;
        } else if (nextLine.trim() === '') {
          emptyLineCount++;
          if (tableStarted && emptyLineCount > 2) break; // 테이블 끝
          block.push(nextLine);
        } else if (!tableStarted) {
          nonTableLines++;
          if (nonTableLines > 50) break; // 키워드 후 50줄 내에 테이블 없으면 가짜
          block.push(nextLine); // 테이블 시작 전 맥락
        } else {
          break; // 테이블 중간에 비테이블 행 → 종료
        }
      }

      // 테이블 행이 3줄 이상이면 유효
      const tableRows = block.filter(l => l.trim().startsWith('|') && l.includes('|'));
      if (tableRows.length >= 3) {
        tableBlocks.push(block.join('\n'));
      }
    }
  }

  if (tableBlocks.length === 0) {
    return { mainText: allText, nongeubyeoSection: null };
  }

  // 중복 제거: 첫 5줄이 동일하면 중복
  const uniqueBlocks: string[] = [];
  for (const block of tableBlocks) {
    const blockLines = block.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|');
    const isDuplicate = uniqueBlocks.some(existing => {
      const existingLines = existing.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|');
      return blockLines === existingLines;
    });
    if (!isDuplicate) uniqueBlocks.push(block);
  }

  const nongeubyeoText = uniqueBlocks.join('\n\n');
  console.log(`  [v5.6] 비급여표 전처리: ${uniqueBlocks.length}개 블록, ${nongeubyeoText.split('\n').filter(l => l.trim().startsWith('|')).length}행`);

  const nongeubyeoSection = `
========================================
★★★ 아래는 비급여항목 가격표입니다. 모든 행을 추출하세요. ★★★
========================================
${nongeubyeoText}`;

  return { mainText: allText, nongeubyeoSection };
}

// ============================================================
// [v5.4] Step 2: 분류/구조화 — 전체 텍스트 → 6-category JSON
// ============================================================
async function classifyHospitalData(
  allText: string,
  hospitalName: string,
  retryCount = 0,
  navMenuText?: string,
  screenshotBuffers?: Buffer[],
): Promise<HospitalAnalysisV54> {
  const accessToken = await getAccessToken();
  const endpoint = getGeminiEndpoint();

  const prompt = buildClassifyPrompt(hospitalName, navMenuText);

  // [v5.6] 비급여항목표 전처리: 전체 텍스트에서 비급여 섹션 추출 (truncation 없음)
  const { mainText: preprocessedText, nongeubyeoSection } = extractNongeubyeoSection(allText);

  // 비급여표를 텍스트 끝에 별도 섹션으로 삽입 (본문 truncation 제거 — long context 허용)
  const truncated = nongeubyeoSection
    ? preprocessedText + '\n\n' + nongeubyeoSection
    : preprocessedText;

  // parts 구성: 텍스트 + (있으면) 스크린샷 이미지
  const parts: Array<Record<string, unknown>> = [];

  // 스크린샷 이미지 추가 (최대 50장 — OCR 모드 시 추가 스크린샷 대응)
  if (screenshotBuffers && screenshotBuffers.length > 0) {
    const maxImages = 50;
    const images = screenshotBuffers.length <= maxImages
      ? screenshotBuffers
      : [...screenshotBuffers.slice(0, 40), ...screenshotBuffers.slice(-10)]; // 앞 40장 + 뒤 10장
    for (const buf of images) {
      const optimized = await optimizeScreenshot(buf);
      parts.push({ inlineData: { mimeType: 'image/webp', data: optimized.toString('base64') } });
    }
    parts.push({ text: `[위 이미지 ${images.length}장은 병원 웹사이트 스크린샷입니다. 이미지에 보이는 장비명, 시술명, 가격표, 이벤트 배너, 의사 이름 등을 텍스트와 함께 분석하세요.\n- 텍스트에서 추출한 정보와 이미지에서 추출한 정보를 합쳐서 최종 결과를 만드세요.\n- 이미지에서만 확인 가능한 정보는 source: "screenshot"으로 표기하세요.\n- 이미지 안의 한국어 텍스트를 정확히 읽어주세요.]\n\n` + prompt + '\n\n---\n\n## 분석 대상 텍스트:\n\n' + truncated });
  } else {
    parts.push({ text: prompt + '\n\n---\n\n## 분석 대상 텍스트:\n\n' + truncated });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 65536,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(300000),  // 5분 (대규모 텍스트)
  });

  if (res.status === 429) {
    if (retryCount >= 5) {
      console.log(`    ❌ classify 429 Rate Limit 5회 초과 — 빈 결과 반환`);
      return { hospital_name: '', doctors: [], academic_activities: [], equipment: [], treatments: [], events: [], clinic_categories: [], extraction_summary: { total_doctors: 0, total_academic: 0, total_equipment: 0, total_treatments: 0, total_events: 0, total_categories: 0, price_available_ratio: '0/0' } } as HospitalAnalysisV54;
    }
    const wait = 30000 * Math.pow(2, retryCount);
    console.log(`    ⏳ 429 Rate Limit — ${wait / 1000}초 대기 (${retryCount + 1}/5)`);
    await new Promise(r => setTimeout(r, wait));
    return classifyHospitalData(allText, hospitalName, retryCount + 1, navMenuText, screenshotBuffers);
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini classify ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Gemini 응답 원문 저장 (디버깅용)
  try {
    const debugDir = path.resolve(__dirname, '..', 'output');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.resolve(debugDir, `_gemini_classify_raw.txt`), rawText);
  } catch { /* ignore */ }

  return robustJsonParse<HospitalAnalysisV54>(rawText, 'Step 2');
}

/** [v5.7] 잘린 JSON 자동 복구 — 열린 bracket/brace/string 닫기 */
function repairTruncatedJson(s: string): string {
  let repaired = s.replace(/,\s*$/, '');
  const opens: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of repaired) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') opens.push(ch);
    else if (ch === '}' || ch === ']') opens.pop();
  }
  if (inString) repaired += '"';
  while (opens.length > 0) {
    const open = opens.pop();
    repaired += open === '{' ? '}' : ']';
  }
  return repaired;
}

/** 4단계 JSON 파싱 fallback (3단계 + 잘린 JSON 복구) */
function robustJsonParse<T>(rawText: string, label: string): T {
  const text = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  // 1차: 그대로 파싱
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // 2차: 코드블록 내부 추출
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* continue */ }
  }

  // 3차: 첫 { ~ 마지막 } 추출
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const extracted = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(extracted);
    } catch {
      // 줄바꿈이 문자열 안에 있는 경우 repair
      try {
        const fixed = extracted.replace(/(?<=: *"[^"]*)\n(?=[^"]*")/g, '\\n');
        return JSON.parse(fixed);
      } catch { /* continue */ }
    }
  }

  // 4차: [v5.7] 잘린 JSON 복구 시도 (Gemini maxOutputTokens 초과 시)
  if (firstBrace >= 0) {
    const fromBrace = text.substring(firstBrace);
    try {
      const repaired = repairTruncatedJson(fromBrace);
      console.log(`    🔧 [v5.7] 잘린 JSON 복구 시도 (${fromBrace.length}→${repaired.length}자)`);
      return JSON.parse(repaired);
    } catch { /* continue */ }
  }

  console.log(`    ❌ ${label} JSON 파싱 4단계 전부 실패 (${text.length}자)`);
  console.log(`    원문 시작: ${text.substring(0, 200)}`);
  throw new Error(`${label} JSON parse failed after 4 attempts`);
}

// ============================================================
// [v5.4] v5.4 결과 → v5 AnalysisResult 변환
// ============================================================
function convertV54ToAnalysis(v54: HospitalAnalysisV54): AnalysisResult & { _v54: HospitalAnalysisV54 } {
  // 시술명 공백 정규화 + "~클리닉" 필터
  const normalizedTreatments = (v54.treatments || []).filter(t => {
    const stripped = t.name.replace(/\s+/g, '');
    return !stripped.endsWith('클리닉');
  });

  // 시술 중복 제거 (공백 정규화)
  const seenTreatments = new Map<string, typeof normalizedTreatments[0]>();
  for (const t of normalizedTreatments) {
    const key = t.name.replace(/\s+/g, '').toLowerCase();
    if (!seenTreatments.has(key)) {
      seenTreatments.set(key, t);
    }
  }
  const dedupedTreatments = Array.from(seenTreatments.values());

  // 학술활동: 의사와 연결 + 독립 학술활동도 보존
  const allActivities = v54.academic_activities || [];
  const doctorLinkedActivityIds = new Set<number>();

  const doctors = (v54.doctors || []).map(d => {
    const activities = allActivities
      .map((a, idx) => ({ ...a, _idx: idx }))
      .filter(a => a.doctor_name === d.name);
    activities.forEach(a => doctorLinkedActivityIds.add(a._idx));
    const activityText = activities
      .map(a => `[${a.type}] ${a.title}${a.year ? ` (${a.year})` : ''}`)
      .join(', ');
    return {
      name: d.name,
      title: d.title || '원장',
      specialty: d.specialty || null,
      education: Array.isArray(d.education) ? d.education.join(', ') : (d.education || null),
      career: Array.isArray(d.career) ? d.career.join(', ') : (d.career || null),
      academic_activity: activityText || d.academic_activity || null,
      notes: d.name_source ? `name_source: ${d.name_source}` : (d.notes || null),
    };
  });

  // 독립 학술활동 (의사에 연결 안 된 것)
  const unlinkedActivities = allActivities
    .filter((_, idx) => !doctorLinkedActivityIds.has(idx))
    .map(a => `[${a.type}] ${a.title}${a.year ? ` (${a.year})` : ''}`);
  if (unlinkedActivities.length > 0 && doctors.length > 0) {
    // 첫 번째 의사에 추가
    const first = doctors[0];
    first.academic_activity = first.academic_activity
      ? `${first.academic_activity}, ${unlinkedActivities.join(', ')}`
      : unlinkedActivities.join(', ');
  } else if (unlinkedActivities.length > 0 && doctors.length === 0) {
    // 의사 없이 학술활동만 있는 경우, 가상 의사 추가
    doctors.push({
      name: '(학술활동 전용)',
      title: '-',
      specialty: null,
      education: null,
      career: null,
      academic_activity: unlinkedActivities.join(', '),
      notes: 'name_source: academic_only',
    });
  }

  // medical_devices → equipments 변환 (하위 호환)
  // v5.4: Gemini가 medical_devices로 반환하면 사용, 아니면 기존 equipment 필드 사용
  const medDevices: MedicalDeviceV54[] = v54.medical_devices || [];
  const legacyEquip = v54.equipment || [];

  let equipments: AnalysisResult['equipments'];
  if (medDevices.length > 0) {
    equipments = medDevices.map(d => ({
      name: d.name,
      category: d.device_type === 'device' ? d.subcategory.toLowerCase() : d.subcategory,
      manufacturer: d.manufacturer || null,
    }));
    // v54에 medical_devices를 정규화해서 저장
    v54.medical_devices = medDevices;
  } else if (legacyEquip.length > 0) {
    equipments = legacyEquip.map(e => ({
      name: e.brand && e.model ? `${e.brand} ${e.model}` : (e.brand || e.model || e.name || 'Unknown'),
      category: e.category === 'RF' ? 'rf' : e.category === '레이저' ? 'laser' : e.category === '초음파' ? 'hifu' : 'other',
      manufacturer: e.manufacturer || null,
    }));
  } else {
    equipments = [];
  }

  const result: AnalysisResult = {
    equipments,
    treatments: dedupedTreatments.map(t => ({
      name: t.name,
      category: t.category || 'other',
      price: t.price || null,
      price_note: t.price_note || (t.price_display ? `원문: ${t.price_display}` : null),
      is_promoted: t.is_promoted || false,
      combo_with: t.combo_with || (t.is_package && t.package_detail?.included_treatments
        ? t.package_detail.included_treatments.join(', ') : null),
    })),
    doctors,
    events: (v54.events || []).map(e => ({
      title: e.title,
      description: e.description || e.discount_info || null,
      discount_type: e.discount_type || e.type || null,
      discount_value: e.discount_value || null,
      related_treatments: e.related_treatments || [],
    })),
  };

  return { ...result, _v54: v54 };
}

// ============================================================
// [v5.4] 의사 이름 웹 검증 (Puppeteer Google 검색)
// ============================================================
async function verifyDoctorNames(
  doctors: AnalysisResult['doctors'],
  hospitalName: string,
): Promise<void> {
  if (doctors.length === 0) return;

  // 5명 이하이거나 uncertain이 있으면 검증
  const shouldVerify = doctors.length <= 5 || doctors.some(d =>
    d.notes?.includes('uncertain') || d.notes?.includes('ocr_only')
  );
  if (!shouldVerify) {
    // 전체에 name_source 설정
    for (const d of doctors) {
      if (!d.notes?.includes('name_source:')) {
        d.notes = d.notes ? `${d.notes}, name_source: ocr_only` : 'name_source: ocr_only';
      }
    }
    return;
  }

  console.log(`  🔍 [v5.4] 의사 이름 웹 검증 (${doctors.length}명)...`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log(`    ⚠️ Puppeteer 실행 실패: ${err}`);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    for (const doctor of doctors) {
      if (doctor.name === '원장 (이름 미확인)') continue;

      try {
        // 1차: "병원명 + OCR 이름" 검색
        const query1 = encodeURIComponent(`${hospitalName} ${doctor.name} 원장`);
        await page.goto(`https://www.google.com/search?q=${query1}`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        await new Promise(r => setTimeout(r, 1500));

        const bodyText = await page.evaluate(() => document.body.innerText);

        if (bodyText.includes(doctor.name)) {
          doctor.notes = doctor.notes
            ? doctor.notes.replace(/name_source: \w+/, 'name_source: web_verified')
            : 'name_source: web_verified';
          console.log(`    ✅ ${doctor.name} → web_verified`);
        } else {
          // 2차: "병원명 + 원장" 검색으로 정확한 이름 찾기
          const query2 = encodeURIComponent(`${hospitalName} 원장`);
          await page.goto(`https://www.google.com/search?q=${query2}`, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          });
          await new Promise(r => setTimeout(r, 1500));

          const body2 = await page.evaluate(() => document.body.innerText);

          // 검색 결과에서 이름 패턴 찾기 (X원장, X 원장)
          const namePattern = /([가-힣]{2,4})\s*원장/g;
          let nameMatch;
          const foundNames: string[] = [];
          while ((nameMatch = namePattern.exec(body2)) !== null) {
            foundNames.push(nameMatch[1]);
          }

          const corrected = foundNames.find(n => n !== doctor.name && n.length >= 2);
          if (corrected) {
            console.log(`    🔄 ${doctor.name} → ${corrected} (web_corrected)`);
            doctor.name = corrected;
            doctor.notes = doctor.notes
              ? doctor.notes.replace(/name_source: \w+/, 'name_source: web_corrected')
              : 'name_source: web_corrected';
          } else {
            doctor.notes = doctor.notes
              ? doctor.notes.replace(/name_source: \w+/, 'name_source: ocr_only')
              : 'name_source: ocr_only';
            console.log(`    ⚠️ ${doctor.name} → ocr_only (검증 불가)`);
          }
        }

        await new Promise(r => setTimeout(r, 2000));  // Google rate limit 방지
      } catch (err) {
        console.log(`    ⚠️ ${doctor.name} 검증 실패: ${err}`);
        doctor.notes = doctor.notes
          ? doctor.notes.replace(/name_source: \w+/, 'name_source: ocr_only')
          : 'name_source: ocr_only';
      }
    }

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    console.log(`    ❌ 웹 검증 중단: ${err}`);
  }
}

// ============================================================
// 청크 분할
// ============================================================
function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n\n', end);
      if (nl > start + CHUNK_SIZE * 0.7) end = nl;
      else { const s = text.lastIndexOf('. ', end); if (s > start + CHUNK_SIZE * 0.7) end = s + 1; }
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function cleanMarkdown(md: string): string {
  let t = md;
  // 이미지 링크 제거
  t = t.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  t = t.replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '');
  // 5개 이상 링크가 나열된 줄 → 네비게이션 메뉴 (제거)
  t = t.replace(/^.*(\[[^\]]+\]\([^)]+\).*){5,}$/gm, '');
  // 이미지 리스트
  t = t.replace(/^\s*[-*]\s*\[!\[.*$/gm, '');
  // 빈 테이블
  t = t.replace(/^\|\s*\|\s*$/gm, '');
  t = t.replace(/^\|\s*---\s*\|\s*$/gm, '');
  // 빈 리스트
  t = t.replace(/^[-*]\s*$/gm, '');
  // 다중 링크 나열 블록 (2개 이상 연속 링크만 있는 줄 → 메뉴 블록)
  t = t.replace(/^(\s*[-*]?\s*\[[^\]]+\]\([^)]+\)\s*)+$/gm, (match) => {
    // 3개 이상 링크가 있는 줄만 제거
    const linkCount = (match.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
    return linkCount >= 3 ? '' : match;
  });
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * 여러 페이지 중 중복 콘텐츠 감지 → 분석 대상 축소
 * 동안중심의원 같이 /landing/ 페이지마다 동일 네비게이션 22,000자씩 반복되는 패턴 방어
 *
 * 방법: cleanMarkdown 적용 후 실제 고유 콘텐츠의 앞 500자를 해시로 사용
 * 완전 동일한 cleaned 콘텐츠가 3개 이상이면 3개째부터 스킵
 */
/**
 * 네비게이션 마크다운에서 시술 링크 텍스트 추출
 * 동안중심의원 같이 네비게이션에 "레드터치 pro 이용시술", "헤일로 이용시술" 등이 나열된 패턴
 */
function extractNavTreatments(markdown: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const treatments: string[] = [];
  let match: RegExpExecArray | null;

  // 일반 UI 메뉴 텍스트 (제외)
  const EXCLUDE_NAV = /^(home|menu|close|이전|다음|prev|next|원장님|병원소개|히스토리|의료진\s*소개|내부|오시는길|약도|예약|전화|상담|문의|공지사항|이벤트\s*보기|before|after|전후사진|후기|리뷰)$/i;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const text = match[1].trim();
    const url = match[2];
    // 이미지 alt, 빈 텍스트, 너무 짧은/긴 텍스트 제외
    if (text.length < 2 || text.length > 60) continue;
    if (/^!\[/.test(text)) continue;
    if (EXCLUDE_NAV.test(text)) continue;
    // URL 이미지 파일 제외
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i.test(url)) continue;

    // 시술/장비 키워드 포함 시 추가 (넓은 범위)
    const isRelevant =
      /이용시술|시술|리프팅|토닝|레이저|필링|주사|보톡스|필러|써마지|울쎄라|인모드|슈링크|토르|TORR|스컬트라|올리디아|리쥬란|엠스컬프트|젤틱|쿨스컬프팅|온다|에너젯|포텐자|스칼렛|시크릿|피코|BBL|IPL|LDM|HIFU|RF/.test(text) ||
      /\/landing\/|\/treatment|\/program|\/menu|\/clinic/.test(url);

    if (isRelevant) {
      treatments.push(text);
    }
  }

  return [...new Set(treatments)];
}

/**
 * 여러 페이지 중 중복 콘텐츠 감지 + 이미지 전용 사이트 최적화
 * - cleaned 텍스트가 실질적으로 동일하면 중복으로 판단
 * - 이미지만 있는 페이지(cleaned < 800자)는 스크린샷 있는 것만 유지, 최대 15개
 */
function deduplicatePages(pages: CrawlPageResult[]): CrawlPageResult[] {
  if (pages.length <= 5) return pages;

  const result: CrawlPageResult[] = [];
  const textPages: CrawlPageResult[] = [];    // cleaned > 800자
  const imageLightPages: CrawlPageResult[] = []; // cleaned <= 800자 (이미지 전용)
  let skipped = 0;

  for (const page of pages) {
    // main/doctor 페이지는 항상 유지
    if (page.pageType === 'main' || page.pageType === 'doctor') {
      result.push(page);
      continue;
    }

    const cleaned = cleanMarkdown(page.markdown);
    if (cleaned.length > 800) {
      textPages.push(page);
    } else {
      imageLightPages.push(page);
    }
  }

  // 텍스트 페이지: 중복 감지 (cleaned 첫 300자 fingerprint)
  const seenText = new Map<string, number>();
  for (const page of textPages) {
    const cleaned = cleanMarkdown(page.markdown);
    const fp = cleaned.substring(0, 300);
    const count = seenText.get(fp) || 0;
    if (count >= 2) { skipped++; continue; }
    seenText.set(fp, count + 1);
    result.push(page);
  }

  // 이미지 전용 페이지: 스크린샷 있는 것만, 최대 15개 (Vision 비용 제한)
  const imageWithSS = imageLightPages.filter(p => p.screenshotBuffers.length > 0);
  const imageCap = Math.min(imageWithSS.length, 15);
  const imageSkipped = imageWithSS.length - imageCap + (imageLightPages.length - imageWithSS.length);
  result.push(...imageWithSS.slice(0, imageCap));
  skipped += imageSkipped;

  if (skipped > 0) {
    console.log(`  🔄 중복/이미지전용 ${skipped}페이지 스킵 (${pages.length} → ${result.length})`);
  }

  return result;
}

// ============================================================
// 페이지 분석 (v5: 텍스트 → Vision fallback + 다중 이미지)
// ============================================================
function isResultMeager(result: AnalysisResult, pageType: string, markdown: string): boolean {
  const total = result.equipments.length + result.treatments.length + result.doctors.length + result.events.length;
  if (pageType === 'treatment' && result.treatments.length === 0) return true;
  if (pageType === 'doctor' && result.doctors.length === 0) return true;
  if (pageType === 'main' && total < 3) return true;
  // 내비게이션에 시술 링크 많은데 추출 적으면
  const menuLinks = (markdown.match(/\[[^\]]*시술[^\]]*\]\(/g) || []).length;
  if (menuLinks >= 10 && result.treatments.length < 5) return true;
  return false;
}

async function analyzePage(
  name: string, page: CrawlPageResult,
): Promise<{ result: AnalysisResult; method: string; geminiCalls: number }> {
  const cleaned = cleanMarkdown(page.markdown);
  const hasText = cleaned.length >= MIN_PAGE_CHARS;
  const hasImages = page.screenshotBuffers.length > 0;

  if (!hasText && !hasImages) {
    console.log(`    ⏭️ 스킵 (${cleaned.length}자, 이미지 ${page.screenshotBuffers.length}장)`);
    return { result: EMPTY_RESULT, method: 'skipped', geminiCalls: 0 };
  }

  // 텍스트 분석
  if (hasText) {
    const chunks = splitIntoChunks(cleaned);
    const results: AnalysisResult[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkInfo = chunks.length > 1 ? `(${i + 1}/${chunks.length})` : '';
      const prompt = buildExtractionPrompt(name, page.pageType, '텍스트', chunkInfo);
      try {
        const r = await callGemini(prompt, { type: 'text', text: chunks[i] });
        results.push(r);
        if (chunks.length > 1) console.log(`    📄 청크 ${i + 1}/${chunks.length} 완료`);
      } catch (err) {
        console.log(`    ❌ 텍스트 분석 에러: ${err}`);
        results.push(EMPTY_RESULT);
      }
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
    }

    const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };
    for (const r of results) {
      merged.equipments.push(...(r.equipments || []));
      merged.treatments.push(...(r.treatments || []));
      merged.doctors.push(...(r.doctors || []));
      merged.events.push(...(r.events || []));
    }

    // 결과 빈약 + 이미지 있으면 Vision 추가
    if (isResultMeager(merged, page.pageType, page.markdown) && hasImages) {
      console.log(`    🔄 텍스트 결과 빈약 → Vision 추가 (${page.screenshotBuffers.length}장)`);
      try {
        const prompt = buildExtractionPrompt(name, page.pageType, '이미지');
        const visionResult = await callGemini(prompt, { type: 'images', buffers: page.screenshotBuffers });
        merged.equipments.push(...(visionResult.equipments || []));
        merged.treatments.push(...(visionResult.treatments || []));
        merged.doctors.push(...(visionResult.doctors || []));
        merged.events.push(...(visionResult.events || []));
        return { result: merged, method: 'both', geminiCalls: chunks.length + 1 };
      } catch (err) {
        console.log(`    ❌ Vision 추가 실패: ${err}`);
      }
    }

    return { result: merged, method: 'text', geminiCalls: chunks.length };
  }

  // Vision only
  console.log(`    👁️ Vision 분석 (${cleaned.length}자 < ${MIN_PAGE_CHARS}자, ${page.screenshotBuffers.length}장)`);
  try {
    const prompt = buildExtractionPrompt(name, page.pageType, '이미지');
    const result = await callGemini(prompt, { type: 'images', buffers: page.screenshotBuffers });
    return { result, method: 'vision', geminiCalls: 1 };
  } catch (err) {
    console.log(`    ❌ Vision 실패: ${err}`);
    return { result: EMPTY_RESULT, method: 'vision_failed', geminiCalls: 1 };
  }
}

// ============================================================
// [v5.2] 최소 기대치 Sanity Check + 보강 크롤
// ============================================================
const MINIMUM_EXPECTATIONS = {
  doctors: 1,     // 피부과/성형외과: 최소 원장 1명
  treatments: 3,  // 최소 시술 3개
};

const COMMON_PATHS: Record<string, string[]> = {
  doctor: [
    '/doctor', '/doctor.php', '/staff', '/team',
    '/의료진', '/원장', '/원장소개', '/의료진소개',
    '/intro/doctor', '/info/doctor', '/about/doctor',
    '/sub/doctor', '/contents/doctor',
    '/intro/doctor.php', '/info/doctor.htm',
    '/about/staff', '/sub/staff.php',
    '/sub/의료진', '/contents/의료진',
  ],
  treatment: [
    '/treatment', '/program', '/menu', '/price',
    '/시술', '/프로그램', '/시술안내', '/진료안내', '/진료과목',
    '/intro/treatment', '/info/treatment',
    '/sub/treatment', '/contents/program',
    '/treatment.php', '/program.php', '/menu.php',
    '/price.php', '/skin', '/lifting', '/laser',
    '/가격', '/비용', '/menu',
    // [v5.6] 랜딩/이벤트/프로모션 페이지 (이벤트 가격 포함 가능)
    '/landing', '/landing/', '/special', '/campaign',
    '/event', '/promotion', '/이벤트', '/프로모션',
    // 비급여 안내 페이지
    '/nongeubyeo', '/비급여', '/비급여안내', '/비급여항목',
  ],
};

interface SanityResult {
  sufficient: boolean;
  missingTypes: string[];  // 'doctor' | 'treatment'
  details: string[];
}

function checkSanity(
  analysis: AnalysisResult,
  pages: CrawlPageResult[],
): SanityResult {
  const details: string[] = [];
  const missingTypes: string[] = [];
  const pageTypes = pages.map(p => p.pageType);

  // 의사 체크
  if (analysis.doctors.length < MINIMUM_EXPECTATIONS.doctors) {
    const hasDoctorPage = pageTypes.includes('doctor');
    if (!hasDoctorPage) {
      details.push(`의사 ${analysis.doctors.length}명 (최소 ${MINIMUM_EXPECTATIONS.doctors}명) — doctor 페이지 미크롤`);
      missingTypes.push('doctor');
    } else {
      details.push(`의사 ${analysis.doctors.length}명 (최소 ${MINIMUM_EXPECTATIONS.doctors}명) — doctor 페이지 있으나 추출 실패`);
      missingTypes.push('doctor');
    }
  } else {
    details.push(`의사 ${analysis.doctors.length}명 → OK`);
  }

  // 시술 체크
  if (analysis.treatments.length < MINIMUM_EXPECTATIONS.treatments) {
    const hasTreatmentPage = pageTypes.includes('treatment');
    if (!hasTreatmentPage) {
      details.push(`시술 ${analysis.treatments.length}개 (최소 ${MINIMUM_EXPECTATIONS.treatments}개) — treatment 페이지 미크롤`);
      missingTypes.push('treatment');
    } else {
      details.push(`시술 ${analysis.treatments.length}개 (최소 ${MINIMUM_EXPECTATIONS.treatments}개) — treatment 페이지 있으나 추출 부족`);
    }
  } else {
    details.push(`시술 ${analysis.treatments.length}개 → OK`);
  }

  return {
    sufficient: missingTypes.length === 0,
    missingTypes,
    details,
  };
}

async function supplementaryCrawl(
  baseUrl: string,
  hospitalId: string,
  name: string,
  missingTypes: string[],
): Promise<{ pages: CrawlPageResult[]; analyses: AnalysisResult[]; credits: number; geminiCalls: number }> {
  console.log(`  🔧 보강 크롤 시도: ${missingTypes.join(', ')}`);
  const supplementPages: CrawlPageResult[] = [];
  const analyses: AnalysisResult[] = [];
  let credits = 0;
  let geminiCalls = 0;

  for (const type of missingTypes) {
    const paths = COMMON_PATHS[type] || [];
    let found = false;

    for (const p of paths) {
      const url = new URL(p, baseUrl).href;
      try {
        const result = await firecrawl.v1.scrapeUrl(url, {
          formats: ['markdown', 'screenshot'],
          waitFor: 5000,
          timeout: 30000,
        });
        credits += 1;

        const md = (result.markdown as string) || '';
        const ss = (result.screenshot as string) || null;
        if (!result.success || md.length < 200) continue;

        console.log(`    ✅ 보강 발견: ${url} (${md.length}자)`);

        // 스크린샷 처리
        const screenshotEntries: ScreenshotEntry[] = [];
        const screenshotBuffers: Buffer[] = [];
        if (ss) {
          const buf = await downloadScreenshotUrl(ss);
          if (buf) {
            const storageUrl = await uploadScreenshot(hospitalId, type, url, buf, 'default');
            if (storageUrl) {
              screenshotEntries.push({ url: storageUrl, position: 'default', order: 0 });
              screenshotBuffers.push(buf);
            }
          }
        }

        // DB 저장
        await supabase.from('scv_crawl_pages').insert({
          hospital_id: hospitalId, url, page_type: type,
          markdown: md, char_count: md.length,
          screenshot_url: JSON.stringify(screenshotEntries),
          analysis_method: 'pending', tenant_id: TENANT_ID, gemini_analyzed: false,
        });

        // Gemini 분석
        const pageResult: CrawlPageResult = {
          url, pageType: type, markdown: md, charCount: md.length,
          screenshotEntries, screenshotBuffers,
        };
        const { result: analysisResult, method, geminiCalls: calls } = await analyzePage(name, pageResult);
        geminiCalls += calls;
        analyses.push(analysisResult);

        await supabase.from('scv_crawl_pages')
          .update({ analysis_method: method }).eq('hospital_id', hospitalId).eq('url', url);

        const items = analysisResult.equipments.length + analysisResult.treatments.length +
          analysisResult.doctors.length + analysisResult.events.length;
        console.log(`    → ${method} | 장비 ${analysisResult.equipments.length} 시술 ${analysisResult.treatments.length} 의사 ${analysisResult.doctors.length} 이벤트 ${analysisResult.events.length}`);

        supplementPages.push(pageResult);
        found = true;
        break;
      } catch {
        credits += 1;
      }
    }

    if (!found) {
      console.log(`    ⚠️ 보강 ${type}: 유효한 페이지 못 찾음`);
    }
  }

  return { pages: supplementPages, analyses, credits, geminiCalls };
}

// ============================================================
// [v5.3] 원페이지 + 이미지 기반 사이트 대응
// ============================================================

/**
 * 원페이지 사이트 감지
 * 페이지 3개 이하 + 메인 5000자 이상 + 이미지가 텍스트보다 많음
 */
function isOnePageSite(pages: CrawlPageResult[]): boolean {
  if (pages.length > 3) return false;

  const mainPage = pages.find(p => p.pageType === 'main') || pages[0];
  if (!mainPage || mainPage.charCount < 5000) return false;

  // 이미지 vs 텍스트 비중 체크
  const md = mainPage.markdown;
  const imageCount = (md.match(/!\[/g) || []).length + (md.match(/\.(jpg|jpeg|png|gif|webp|svg)/gi) || []).length;
  const textBlocks = (cleanMarkdown(md).match(/\S{20,}/g) || []).length;  // 20자 이상 텍스트 블록

  return imageCount > textBlocks;
}

/**
 * 팝업 닫기 (Puppeteer)
 */
const POPUP_CLOSE_SELECTORS = [
  '.modal-close', '[class*="close"]', '.popup-close', '.btn-close',
  'button.close', '[class*="닫기"]', '.fancybox-close',
  'a[href*="close"]', '[onclick*="close"]', '.layer-close',
];

async function closePopups(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>): Promise<void> {
  for (const sel of POPUP_CLOSE_SELECTORS) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch { /* 무시 */ }
  }
}

/**
 * 슬라이드 배너 순차 캡처 (Puppeteer)
 * 크레딧 소모 0 — 로컬 Puppeteer
 */
async function captureSliderImages(
  pageUrl: string,
  hospitalId: string,
): Promise<{ buffers: Buffer[]; geminiCalls: number }> {
  console.log('  🖼️ [v5.3] 슬라이드 배너 순차 캡처 시작');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log(`  ❌ Puppeteer 실행 실패: ${err}`);
    return { buffers: [], geminiCalls: 0 };
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await closePopups(page);

    // 슬라이더 "다음" 버튼 찾기
    const nextBtnSelectors = [
      '.swiper-button-next', '.slick-next', '.owl-next',
      '[class*="next"]', '[class*="arrow-right"]',
      'button[aria-label="Next"]', '.slide-next',
      '[class*="right"]', '.bx-next',
    ];

    let nextBtn = null;
    for (const sel of nextBtnSelectors) {
      try {
        nextBtn = await page.$(sel);
        if (nextBtn) {
          console.log(`    슬라이더 버튼: "${sel}"`);
          break;
        }
      } catch { /* 무시 */ }
    }

    const screenshots: Buffer[] = [];

    // 첫 슬라이드 캡처
    const firstSS = await page.screenshot({ type: 'png' });
    screenshots.push(Buffer.from(firstSS));

    if (nextBtn) {
      // 최대 10회 클릭으로 슬라이드 순회
      for (let i = 0; i < 10; i++) {
        try {
          await nextBtn.click();
          await new Promise(r => setTimeout(r, 800));
          const ss = await page.screenshot({ type: 'png' });
          screenshots.push(Buffer.from(ss));
        } catch { break; }
      }
      console.log(`    📸 슬라이드 ${screenshots.length}장 캡처`);
    } else {
      console.log('    ⚠️ 슬라이드 넘김 버튼 못 찾음 — 1장만 캡처');
    }

    await browser.close();

    // 중복 제거 (동일 슬라이드가 반복될 수 있음)
    // 간단한 사이즈 기반 중복 감지
    const unique: Buffer[] = [screenshots[0]];
    const firstSize = screenshots[0].length;
    for (let i = 1; i < screenshots.length; i++) {
      const sizeDiff = Math.abs(screenshots[i].length - firstSize);
      // 첫 번째와 동일 크기(±2%)면 한바퀴 돌아온 것 → 중단
      if (sizeDiff < firstSize * 0.02 && i > 1) {
        console.log(`    🔄 슬라이드 ${i + 1}장째 첫 슬라이드와 동일 → ${i}장으로 확정`);
        break;
      }
      unique.push(screenshots[i]);
    }

    // sharp 최적화 + Storage 업로드
    const optimized: Buffer[] = [];
    for (let i = 0; i < unique.length; i++) {
      const opt = await sharp(unique[i])
        .resize(1280, null, { withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      optimized.push(opt);

      const storagePath = `${hospitalId}/slider_${i}_${Date.now()}.webp`;
      await supabase.storage.from('hospital-screenshots')
        .upload(storagePath, opt, { contentType: 'image/webp', upsert: true });
    }

    return { buffers: optimized, geminiCalls: 0 };
  } catch (err) {
    if (browser) await browser.close();
    console.log(`  ❌ 슬라이더 캡처 실패: ${err}`);
    return { buffers: [], geminiCalls: 0 };
  }
}

/**
 * 마크다운에서 팝업/배너 이미지 URL 추출 → 직접 다운로드 + Vision 분석
 * 크레딧 소모 0 — HTTP fetch만
 */
async function extractAndAnalyzeImages(
  markdown: string,
  baseUrl: string,
  hospitalId: string,
  hospitalName: string,
): Promise<{ analysis: AnalysisResult; geminiCalls: number }> {
  console.log('  🖼️ [v5.3] 마크다운 이미지 URL 추출 + Vision 분석');

  // 마크다운에서 이미지 URL 추출 (팝업, 배너, 주요 이미지)
  const imageUrlRegex = /(?:!\[[^\]]*\]\(([^)]+)\))|(?:src=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["'])/gi;
  const allImageUrls: string[] = [];
  let match;
  while ((match = imageUrlRegex.exec(markdown)) !== null) {
    const url = match[1] || match[2];
    if (!url) continue;
    try {
      const absoluteUrl = new URL(url, baseUrl).href;
      allImageUrls.push(absoluteUrl);
    } catch { /* 잘못된 URL 무시 */ }
  }

  // 팝업/배너/슬라이드 관련 이미지 우선 필터
  const priorityKeywords = ['pop', 'banner', 'slide', 'main', 'event', 'promo', 'visual', 'doctor', 'staff'];
  const priorityUrls = allImageUrls.filter(u => {
    const lower = u.toLowerCase();
    return priorityKeywords.some(k => lower.includes(k));
  });
  const otherUrls = allImageUrls.filter(u => !priorityUrls.includes(u));

  // 우선 이미지 + 나머지 (최대 15개)
  const targetUrls = [...new Set([...priorityUrls, ...otherUrls])].slice(0, 15);

  if (targetUrls.length === 0) {
    console.log('    ⚠️ 분석 대상 이미지 URL 없음');
    return { analysis: EMPTY_RESULT, geminiCalls: 0 };
  }

  console.log(`    📸 대상 이미지: ${targetUrls.length}개 (팝업/배너 ${priorityUrls.length}개)`);

  // 이미지 다운로드
  const downloadedBuffers: Buffer[] = [];
  for (const imgUrl of targetUrls) {
    try {
      const resp = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      // 너무 작은 이미지 무시 (아이콘 등)
      if (buf.length < 5000) continue;
      const optimized = await sharp(buf)
        .resize(1280, null, { withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      downloadedBuffers.push(optimized);
    } catch { /* 다운로드 실패 무시 */ }
  }

  if (downloadedBuffers.length === 0) {
    console.log('    ⚠️ 유효한 이미지 다운로드 0개');
    return { analysis: EMPTY_RESULT, geminiCalls: 0 };
  }

  console.log(`    📥 다운로드 성공: ${downloadedBuffers.length}/${targetUrls.length}개`);

  // Storage 업로드
  for (let i = 0; i < downloadedBuffers.length; i++) {
    const storagePath = `${hospitalId}/banner_img_${i}_${Date.now()}.webp`;
    await supabase.storage.from('hospital-screenshots')
      .upload(storagePath, downloadedBuffers[i], { contentType: 'image/webp', upsert: true });
  }

  // Gemini Vision 분석 (배치: 최대 5장씩)
  const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };
  let geminiCalls = 0;
  const batchSize = 5;
  for (let i = 0; i < downloadedBuffers.length; i += batchSize) {
    const batch = downloadedBuffers.slice(i, i + batchSize);
    const imageType = i === 0 ? '메인 배너 슬라이드' : '팝업 배너';
    const prompt = buildImageBannerPrompt(hospitalName, imageType);
    try {
      const result = await callGemini(prompt, { type: 'images', buffers: batch });
      geminiCalls += 1;
      merged.equipments.push(...(result.equipments || []));
      merged.treatments.push(...(result.treatments || []));
      merged.doctors.push(...(result.doctors || []));
      merged.events.push(...(result.events || []));
      console.log(`    🤖 Vision 배치 ${Math.floor(i / batchSize) + 1}: 장비 ${result.equipments?.length || 0} 시술 ${result.treatments?.length || 0} 의사 ${result.doctors?.length || 0} 이벤트 ${result.events?.length || 0}`);
    } catch (err) {
      console.log(`    ⚠️ Vision 배치 ${Math.floor(i / batchSize) + 1} 실패: ${err}`);
      geminiCalls += 1;
    }
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
  }

  return { analysis: merged, geminiCalls };
}

/**
 * 학술활동 텍스트에서 이름 미확인 원장 자동 생성
 * 의사 0명인데 학술활동이 마크다운에 있는 경우
 */
function inferDoctorFromAcademicActivity(
  analysis: AnalysisResult,
  markdown: string,
): boolean {
  if (analysis.doctors.length > 0) return false;

  // 학술활동 패턴 감지
  const academicPatterns = [
    /학술대회|학술활동|학회|symposium|congress|conference/gi,
    /강연|발표|presentation|lecture|speaker/gi,
    /편찬|저서|교과서|논문|publication|paper/gi,
    /수상|award|recognition/gi,
    /ASLS|ICAP|K-Med|KDA|KSDM|KCCS/gi,
    /대한\S+학회|한국\S+학회/gi,
  ];

  const academicLines: string[] = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;
    for (const pattern of academicPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        academicLines.push(trimmed
          .replace(/^\s*[-*#>\d.]+\s*/, '')  // 마크다운 기호 제거
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 링크 텍스트만
          .trim()
        );
        break;
      }
    }
  }

  if (academicLines.length === 0) return false;

  // 이름 미확인 원장 생성 + 학술활동 연결
  const uniqueActivities = [...new Set(academicLines)];
  analysis.doctors.push({
    name: '원장 (이름 미확인)',
    title: '원장',
    specialty: null,
    education: null,
    career: null,
    academic_activity: uniqueActivities.join(', '),
    notes: 'manual_input_required: 사이트에 원장 이름 텍스트 없음. 학술활동에서 KOL 활동 확인됨.',
  });

  console.log(`  🎓 [v5.3] 학술활동 ${uniqueActivities.length}건 발견 → 이름 미확인 원장 생성`);
  for (const act of uniqueActivities.slice(0, 5)) {
    console.log(`    • ${act.substring(0, 80)}`);
  }
  if (uniqueActivities.length > 5) {
    console.log(`    • ... 외 ${uniqueActivities.length - 5}건`);
  }

  return true;
}

/**
 * 원페이지 사이트 이미지 강화 파이프라인 (v5.3)
 * Sanity Check INSUFFICIENT + 원페이지 감지 시 실행
 *
 * 1. 슬라이드 배너 Puppeteer 순차 캡처 → Vision
 * 2. 팝업/배너 이미지 URL 직접 다운로드 → Vision
 * 3. 학술활동 텍스트 → 이름 미확인 원장 생성
 */
async function onePageImageEnhancement(
  hospitalId: string,
  hospitalName: string,
  mainUrl: string,
  pages: CrawlPageResult[],
  analysis: AnalysisResult,
): Promise<{ enhanced: boolean; geminiCalls: number }> {
  console.log(`\n  🖼️ ═══ [v5.3] 원페이지 이미지 강화 파이프라인 ═══`);
  let totalGeminiCalls = 0;
  let enhanced = false;

  // 1. 슬라이드 배너 캡처 + Vision 분석
  const slider = await captureSliderImages(mainUrl, hospitalId);
  if (slider.buffers.length > 0) {
    const prompt = buildImageBannerPrompt(hospitalName, '메인 배너 슬라이드');
    // 슬라이드를 배치로 Vision 분석 (최대 5장씩)
    const batchSize = 5;
    for (let i = 0; i < slider.buffers.length; i += batchSize) {
      const batch = slider.buffers.slice(i, i + batchSize);
      try {
        const result = await callGemini(prompt, { type: 'images', buffers: batch });
        totalGeminiCalls += 1;
        analysis.equipments.push(...(result.equipments || []));
        analysis.treatments.push(...(result.treatments || []));
        analysis.doctors.push(...(result.doctors || []));
        analysis.events.push(...(result.events || []));
        const items = (result.equipments?.length || 0) + (result.treatments?.length || 0) +
          (result.doctors?.length || 0) + (result.events?.length || 0);
        if (items > 0) enhanced = true;
        console.log(`    슬라이드 Vision 배치 ${Math.floor(i / batchSize) + 1}: ${items}건 추출`);
      } catch (err) {
        console.log(`    ⚠️ 슬라이드 Vision 실패: ${err}`);
        totalGeminiCalls += 1;
      }
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
    }
  }

  // 2. 마크다운 이미지 URL 직접 다운로드 + Vision
  const allMd = pages.map(p => p.markdown).join('\n\n');
  const imgResult = await extractAndAnalyzeImages(allMd, mainUrl, hospitalId, hospitalName);
  totalGeminiCalls += imgResult.geminiCalls;
  if (imgResult.analysis.equipments.length > 0 || imgResult.analysis.treatments.length > 0 ||
      imgResult.analysis.doctors.length > 0 || imgResult.analysis.events.length > 0) {
    analysis.equipments.push(...imgResult.analysis.equipments);
    analysis.treatments.push(...imgResult.analysis.treatments);
    analysis.doctors.push(...imgResult.analysis.doctors);
    analysis.events.push(...imgResult.analysis.events);
    enhanced = true;
  }

  // 3. 학술활동 → 이름 미확인 원장 생성
  const doctorInferred = inferDoctorFromAcademicActivity(analysis, allMd);
  if (doctorInferred) enhanced = true;

  if (enhanced) {
    console.log(`  📊 이미지 강화 후: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length}`);
  } else {
    console.log(`  ⚠️ 이미지 강화 효과 없음`);
  }

  return { enhanced, geminiCalls: totalGeminiCalls };
}

// ============================================================
// 자동 검증 (v5.2: 2단계)
// ============================================================
async function validateCoverage(
  hospitalId: string, name: string,
  analysis: AnalysisResult, allMarkdown: string,
  siteType?: string,
): Promise<ValidationResult> {
  const isBlog = siteType === 'naver_blog' || siteType === 'other_blog';
  console.log(`  🔍 자동 검증 (Gemini 커버리지 체크${isBlog ? ' — 블로그 가중치' : ''})...`);

  const prompt = buildValidationPrompt(
    allMarkdown,
    analysis.equipments.map(e => e.name),
    analysis.treatments.map(t => t.name),
    analysis.doctors.map(d => d.name),
    siteType,
  );

  try {
    const accessToken = await getAccessToken();
    const endpoint = getGeminiEndpoint();

    // 검증용: 마크다운 30000자 초과 시 앞뒤 요약 (Gemini 응답 시간 방어)
    const truncatedMd = allMarkdown.length > 30000
      ? allMarkdown.substring(0, 15000) + '\n\n...(중략)...\n\n' + allMarkdown.substring(allMarkdown.length - 15000)
      : allMarkdown;

    const fullPrompt = prompt.replace('{MARKDOWN}', truncatedMd);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(300000),  // 5분 (대규모 병원 대응)
    });

    if (!res.ok) throw new Error(`Gemini validation ${res.status}`);

    const data = await res.json();
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    const rawValidationText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 디버그: finishReason 확인 + raw 저장
    if (finishReason !== 'STOP') {
      console.log(`    ⚠️ 커버리지 검증 finishReason: ${finishReason} (${rawValidationText.length}자)`);
    }
    const valDebugPath = path.resolve(__dirname, '..', 'output', `${hospitalId}_coverage_raw.txt`);
    fs.writeFileSync(valDebugPath, rawValidationText);

    const validation = robustJsonParse<ValidationResult>(rawValidationText, '커버리지 검증');

    // -1 (판정 불가) 처리: 해당 항목을 overall 계산에서 제외하고 재계산
    const cs = validation.coverage_score || { equipment: 0, treatment: 0, doctor: 0, overall: 0 };
    const eqScore = cs.equipment ?? 0;
    const trScore = cs.treatment ?? 0;
    const drScore = cs.doctor ?? 0;

    // -1은 "원본에 해당 정보 없음" → overall에서 제외
    // 블로그: 장비 15%, 시술 45%, 의사 25%, 나머지(학술) 15% → 장비+시술+의사 = 85% 비례
    // 일반: 장비 30%, 시술 40%, 의사 30%
    const wEq = isBlog ? 15 : 30;
    const wTr = isBlog ? 45 : 40;
    const wDr = isBlog ? 25 : 30;
    let weightSum = 0;
    let scoreSum = 0;
    if (eqScore >= 0) { weightSum += wEq; scoreSum += eqScore * wEq; }
    if (trScore >= 0) { weightSum += wTr; scoreSum += trScore * wTr; }
    if (drScore >= 0) { weightSum += wDr; scoreSum += drScore * wDr; }

    const overall = weightSum > 0 ? Math.round(scoreSum / weightSum) : 0;
    cs.overall = overall;
    // DB에 저장할 때 -1은 0으로 처리, 소수점은 정수로 변환 (integer 컬럼)
    const eqDb = eqScore >= 0 ? Math.round(eqScore) : 0;
    const trDb = trScore >= 0 ? Math.round(trScore) : 0;
    const drDb = drScore >= 0 ? Math.round(drScore) : 0;

    if (eqScore < 0) console.log(`    ⚠️ 장비: 원본에 정보 없음 (판정 제외)`);
    if (trScore < 0) console.log(`    ⚠️ 시술: 원본에 정보 없음 (판정 제외)`);
    if (drScore < 0) console.log(`    ⚠️ 의사: 원본에 정보 없음 (판정 제외)`);

    let status: string;
    if (overall >= 70) status = 'pass';
    else if (overall >= 50) status = 'partial';
    else status = 'fail';

    // DB 저장
    const upsertData: Record<string, unknown> = {
      hospital_id: hospitalId,
      crawl_version: 'v5.4',
      equipment_coverage: eqDb,
      treatment_coverage: trDb,
      doctor_coverage: drDb,
      overall_coverage: overall,
      missing_equipments: validation.missing_equipments || [],
      missing_treatments: validation.missing_treatments || [],
      missing_doctors: validation.missing_doctors || [],
      issues: validation.issues || [],
      status,
      tenant_id: TENANT_ID,
      validated_at: new Date().toISOString(),
    };
    // site_type + 가중치 메타 저장
    if (siteType) {
      upsertData.validation_result = {
        site_type: siteType,
        weights: isBlog ? { equipment: 15, treatment: 45, doctor: 25 } : { equipment: 30, treatment: 40, doctor: 30 },
      };
    }
    const { error: upsertErr } = await supabase.from('scv_crawl_validations').upsert(upsertData, { onConflict: 'hospital_id,crawl_version' });
    if (upsertErr) console.log(`  ⚠️ validation upsert 실패: ${upsertErr.message}`);

    validation._status = status;
    validation.coverage_score = cs;
    return validation;
  } catch (err) {
    console.log(`  ⚠️ 검증 실패: ${err}`);
    return {
      missing_equipments: [], missing_treatments: [], missing_doctors: [],
      missing_prices: [], coverage_score: { equipment: 0, treatment: 0, doctor: 0, overall: 0 },
      issues: [`검증 실패: ${err}`], _status: 'error',
    };
  }
}

// ============================================================
// 재분석 (missing 힌트 추가)
// ============================================================
async function reanalyzeWithHints(
  name: string, allMarkdown: string, validation: ValidationResult,
): Promise<AnalysisResult> {
  console.log(`  🔄 재분석 (missing 힌트 추가)...`);

  const hints = [
    validation.missing_equipments?.length ? `누락 장비: ${validation.missing_equipments.join(', ')}` : '',
    validation.missing_treatments?.length ? `누락 시술: ${validation.missing_treatments.slice(0, 20).join(', ')}` : '',
    validation.missing_doctors?.length ? `누락 의사: ${validation.missing_doctors.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const prompt = buildExtractionPrompt(name, 'combined', '텍스트') +
    `\n\n## 추가 힌트 (이전 분석에서 누락된 항목)\n${hints}\n위 항목들이 원본에 있다면 반드시 추출하세요.`;

  const chunks = splitIntoChunks(cleanMarkdown(allMarkdown));
  const results: AnalysisResult[] = [];

  for (const chunk of chunks) {
    try {
      const r = await callGemini(prompt, { type: 'text', text: chunk });
      results.push(r);
    } catch {
      results.push(EMPTY_RESULT);
    }
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
  }

  const merged: AnalysisResult = { equipments: [], treatments: [], doctors: [], events: [] };
  for (const r of results) {
    merged.equipments.push(...(r.equipments || []));
    merged.treatments.push(...(r.treatments || []));
    merged.doctors.push(...(r.doctors || []));
    merged.events.push(...(r.events || []));
  }

  return merged;
}

// ============================================================
// DB 저장
// ============================================================
async function saveAnalysis(hospitalId: string, analysis: AnalysisResult & { _v54?: HospitalAnalysisV54 }, sourceUrl: string): Promise<void> {
  await supabase.from('sales_hospital_equipments').delete().eq('hospital_id', hospitalId);
  await supabase.from('sales_hospital_treatments').delete().eq('hospital_id', hospitalId);
  await supabase.from('sales_hospital_doctors').delete().eq('hospital_id', hospitalId);
  await supabase.from('sales_hospital_events').delete().eq('hospital_id', hospitalId);

  // [작업4] medical_devices 테이블 저장 (기존 hospital_equipments와 병행)
  const v54 = analysis._v54;
  const medDevices = v54?.medical_devices || [];
  if (medDevices.length > 0) {
    const { error: delErr } = await supabase.from('sales_medical_devices').delete().eq('hospital_id', hospitalId);
    if (delErr) { console.log(`  ⚠️ medical_devices 테이블 없음 (마이그레이션 023 미적용): ${delErr.message}`); }
    const deviceRows = medDevices.map(d => ({
      hospital_id: hospitalId,
      name: d.name,
      korean_name: d.korean_name || null,
      manufacturer: d.manufacturer || null,
      device_type: d.device_type,
      subcategory: d.subcategory,
      source: d.source || 'text',
      confidence: 'confirmed',
    }));
    const { error: devErr } = await supabase.from('sales_medical_devices').insert(deviceRows);
    if (devErr) console.log(`  ⚠️ medical_devices INSERT: ${devErr.message}`);
  }

  // 기존 hospital_equipments 저장 (하위 호환)
  if (analysis.equipments.length > 0) {
    const rows = analysis.equipments.map(eq => ({
      hospital_id: hospitalId, equipment_name: eq.name,
      equipment_category: eq.category || 'other', manufacturer: eq.manufacturer || null,
      source: SOURCE_TAG,
    }));
    const { error } = await supabase.from('sales_hospital_equipments').insert(rows);
    if (error) console.log(`  ⚠️ 장비 INSERT: ${error.message}`);
  }

  if (analysis.treatments.length > 0) {
    const rows = analysis.treatments.map(tr => ({
      hospital_id: hospitalId, treatment_name: tr.name,
      treatment_category: tr.category || 'other', price: tr.price || null,
      price_note: tr.price_note || null, is_promoted: tr.is_promoted || false,
      combo_with: tr.combo_with || null, source: SOURCE_TAG,
    }));
    const { error } = await supabase.from('sales_hospital_treatments').insert(rows);
    if (error) console.log(`  ⚠️ 시술 INSERT: ${error.message}`);
  }

  if (analysis.doctors.length > 0) {
    const toArray = (s: string | string[] | undefined | null): string[] => {
      if (!s) return [];
      if (Array.isArray(s)) return s.map(v => v.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
      return s.split(/\n|,\s*/).map(v => v.replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    };
    const toText = (s: unknown): string | null => {
      if (!s) return null;
      if (Array.isArray(s)) return s.join(', ').trim() || null;
      if (typeof s !== 'string') return String(s);
      return s.replace(/\n/g, ', ').replace(/\s{2,}/g, ' ').trim();
    };
    const rows = analysis.doctors.map(dr => ({
      hospital_id: hospitalId, name: (dr.name || '').trim() || '이름없음',
      title: (dr.title || '원장').trim(), specialty: toText(dr.specialty),
      education: toArray(dr.education), career: toArray(dr.career),
      academic_activity: toText(dr.academic_activity),
      photo_url: dr.photo_url || null,
      enrichment_source: (dr as Record<string, unknown>).enrichment_source as string ?? null,
      enriched_at: (dr as Record<string, unknown>).enrichment_source === 'web_search' ? new Date().toISOString() : null,
    }));
    const { error } = await supabase.from('sales_hospital_doctors').insert(rows);
    if (error) {
      console.error(`  ❌ 의사 INSERT 실패 (${rows.length}명, 병원 ${hospitalId}): ${error.message}`);
    } else {
      console.log(`  ✅ 의사 ${rows.length}명 저장 완료`);
    }

    // [v5.6] doctor_academic_activities 구조화 저장
    const academicRows: Array<{
      hospital_id: string; doctor_name: string; activity_type: string;
      title: string; year: string | null; source: string; source_text: string | null;
    }> = [];
    for (const dr of analysis.doctors) {
      const structured = (dr as { structured_academic?: StructuredAcademic[] }).structured_academic;
      if (!structured || structured.length === 0) continue;
      for (const a of structured) {
        academicRows.push({
          hospital_id: hospitalId,
          doctor_name: (dr.name || '').trim(),
          activity_type: a.type,
          title: a.title,
          year: a.year,
          source: 'crawl',
          source_text: a.source_text || null,
        });
      }
    }
    if (academicRows.length > 0) {
      // delete-then-insert 대신 upsert: 병렬 크롤링 시 데이터 유실 방지
      const { error: aaErr } = await supabase.from('doctor_academic_activities')
        .upsert(academicRows, {
          onConflict: 'hospital_id,doctor_name,activity_type,title',
          ignoreDuplicates: false,
        });
      if (aaErr) {
        // upsert 실패 시 fallback: delete-then-insert
        await supabase.from('doctor_academic_activities').delete().eq('hospital_id', hospitalId);
        const { error: fallbackErr } = await supabase.from('doctor_academic_activities').insert(academicRows);
        if (fallbackErr) console.error(`  ❌ academic_activities INSERT 실패: ${fallbackErr.message}`);
      }
    }
  }

  if (analysis.events.length > 0) {
    const rows = analysis.events.map(ev => ({
      hospital_id: hospitalId, title: ev.title,
      description: ev.description || null, discount_type: ev.discount_type || null,
      discount_value: ev.discount_value || null, related_treatments: ev.related_treatments || [],
      source_url: sourceUrl, source: SOURCE_TAG, tenant_id: TENANT_ID,
    }));
    const { error } = await supabase.from('sales_hospital_events').insert(rows);
    if (error) console.log(`  ⚠️ 이벤트 INSERT: ${error.message}`);
  }

  await supabase.from('scv_crawl_pages')
    .update({ gemini_analyzed: true }).eq('hospital_id', hospitalId);
}

// ============================================================
// Hospital ID 조회
// ============================================================
async function resolveHospitalId(name: string, url: string): Promise<string | null> {
  // 1차: CRM에서 조회 (기존 파일럿 병원)
  const { data: crmH } = await supabase.from('crm_hospitals')
    .select('id, sales_hospital_id').eq('name', name).eq('tenant_id', TENANT_ID).single();

  if (!crmH) {
    // [v5.7] CRM에 없으면 hospitals 테이블에서 직접 조회 (2,700개 확장용)
    const { data: directH } = await supabase.from('hospitals')
      .select('id').eq('name', name).limit(1).single();

    if (directH) {
      console.log(`  📌 hospitals 테이블에서 직접 조회: ${name}`);
      await supabase.from('hospitals').update({ website: url, crawled_at: new Date().toISOString() }).eq('id', directH.id);
      return directH.id;
    }

    // ilike 퍼지 매칭 시도
    const { data: fuzzyH } = await supabase.from('hospitals')
      .select('id, name').ilike('name', `%${name}%`).limit(1).single();

    if (fuzzyH) {
      console.log(`  📌 hospitals 퍼지 매칭: "${name}" → "${fuzzyH.name}"`);
      await supabase.from('hospitals').update({ website: url, crawled_at: new Date().toISOString() }).eq('id', fuzzyH.id);
      return fuzzyH.id;
    }

    console.log(`  ⚠️ "${name}" — CRM/hospitals 모두 없음`);
    return null;
  }

  let hospitalId = crmH.sales_hospital_id;
  if (!hospitalId) {
    const { data: existing } = await supabase.from('hospitals')
      .select('id').eq('name', name).limit(1).single();

    if (existing) {
      hospitalId = existing.id;
    } else {
      const { data: newH, error } = await supabase.from('hospitals')
        .insert({ name, website: url, crawled_at: new Date().toISOString() }).select('id').single();
      if (error || !newH) { console.log(`  ❌ hospital INSERT 실패: ${error?.message}`); return null; }
      hospitalId = newH.id;
    }
    await supabase.from('crm_hospitals').update({ sales_hospital_id: hospitalId }).eq('id', crmH.id);
  }

  await supabase.from('hospitals').update({ website: url, crawled_at: new Date().toISOString() }).eq('id', hospitalId);
  return hospitalId;
}

// ============================================================
// v4 데이터 조회 (비교용)
// ============================================================
async function getV4Counts(hospitalId: string): Promise<{ equip: number; treat: number; doctors: number; events: number }> {
  const [e, t, d, ev] = await Promise.all([
    supabase.from('sales_hospital_equipments').select('id', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('sales_hospital_treatments').select('id', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('sales_hospital_doctors').select('id', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
    supabase.from('sales_hospital_events').select('id', { count: 'exact', head: true }).eq('hospital_id', hospitalId),
  ]);
  return { equip: e.count || 0, treat: t.count || 0, doctors: d.count || 0, events: ev.count || 0 };
}

// ============================================================
// [v5.4] Word 보고서 이미지 섹션 빌더
// ============================================================
function buildImageSection(pages: CrawlPageResult[]): Paragraph[] {
  const items: Paragraph[] = [];
  let imgIdx = 0;

  for (const page of pages) {
    if (!page.screenshotBuffers || page.screenshotBuffers.length === 0) continue;

    for (let k = 0; k < page.screenshotBuffers.length; k++) {
      imgIdx++;
      const buf = page.screenshotBuffers[k];
      const position = page.screenshotEntries?.[k]?.position || 'default';
      const label = `[${imgIdx}] ${page.url} — ${position}`;

      items.push(
        new Paragraph({
          children: [new TextRun({ text: label, font: 'Malgun Gothic', size: 18, color: '666666' })],
          spacing: { before: 200, after: 100 },
        })
      );

      try {
        // base64 screenshot은 data URL일 수 있음 → Buffer 변환
        const imgBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        // 이미지 크기: 가로 최대 600px, 세로 비례 (기본 16:9 가정 → 337px)
        items.push(
          new Paragraph({
            children: [new ImageRun({
              data: imgBuf,
              transformation: { width: 580, height: 326 },
              type: 'png',
            })],
            alignment: AlignmentType.CENTER,
          })
        );
      } catch {
        items.push(
          new Paragraph({
            children: [new TextRun({ text: `(이미지 로드 실패: ${label})`, font: 'Malgun Gothic', size: 18, color: 'CC0000' })],
          })
        );
      }
    }
  }

  if (items.length === 0) {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: '캡처 이미지', font: 'Malgun Gothic', bold: true })],
      }),
      new Paragraph({
        children: [new TextRun({ text: '캡처된 이미지가 없습니다.', font: 'Malgun Gothic', size: 20 })],
      }),
    ];
  }

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `캡처 이미지 (${imgIdx}장)`, font: 'Malgun Gothic', bold: true })],
    }),
    ...items,
  ];
}

// ============================================================
// [v5.5] 보고서 생성 (전체 데이터 출력 + TORR RF 세분화 + 테이블 포맷 개선)
// ============================================================
async function generateReport(params: {
  hospitalId: string;
  hospitalName: string;
  hospitalNo: number;
  region: string;
  url: string;
  pages: CrawlPageResult[];
  analysis: AnalysisResult & { _v54?: HospitalAnalysisV54 };
  ocrResults: OcrResult[];
  geminiCalls: number;
  credits: number;
  coverageOverall: number;
  status: string;
  v4Counts: { equip: number; treat: number; doctors: number; events: number };
  elapsedMs: number;
  torrResult?: TorrDetectionResult;
  resolvedRegion?: ResolvedRegion;
}): Promise<void> {
  const { hospitalId, hospitalName, hospitalNo, region, url, pages, analysis, ocrResults, geminiCalls, credits, coverageOverall, status, v4Counts, elapsedMs, torrResult, resolvedRegion } = params;
  const v54 = analysis._v54;
  const ci = v54?.contact_info;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const elapsed = `${Math.floor(elapsedMs / 60000)}분 ${Math.round((elapsedMs % 60000) / 1000)}초`;

  const ocrSuccessCount = ocrResults.filter(r => r.text !== '텍스트_없음').length;
  const ocrEmptyCount = ocrResults.filter(r => r.text === '텍스트_없음').length;

  const priceCount = analysis.treatments.filter(t => t.price && t.price > 0).length;
  const totalTreat = analysis.treatments.length;

  // 의료기기 분류 (device vs injectable)
  const medDevices = v54?.medical_devices || [];
  const devices = medDevices.filter(d => d.device_type === 'device');
  const injectables = medDevices.filter(d => d.device_type === 'injectable');
  const totalMedDev = medDevices.length || analysis.equipments.length;

  const judge = (count: number, threshold: number): string =>
    count >= threshold ? '✅ 양호' : count > 0 ? '⚠️ 검증필요' : '❌ 미흡';

  // v5.5: torrResult 기반 TORR RF 판정 (기존 hasTorr 대체)
  const hasTorr = torrResult?.detected ||
    analysis.equipments.some(e => e.name.toLowerCase().includes('torr'));
  const torrConfidence = torrResult?.confidence || (hasTorr ? 'medium' : 'low');

  const finalVerdict = status === 'pass' ? '✅ PASS' : status === 'partial' ? '⚠️ CONDITIONAL PASS' : '❌ FAIL';

  // 가격대 분석
  const rfPrices = analysis.treatments
    .filter(t2 => t2.price && t2.price > 0 && (t2.category === 'rf' || t2.category === 'lifting'))
    .map(t2 => t2.price as number);
  const rfPriceRange = rfPrices.length > 0 ? `${Math.min(...rfPrices).toLocaleString()}~${Math.max(...rfPrices).toLocaleString()}원` : 'N/A';

  // 이메일/전화
  const emailInfo = ci?.email?.[0]?.address || '없음';
  const phoneInfo = ci?.phone?.[0]?.number || '없음';

  // TORR RF 상세 텍스트 (마크다운용)
  const torrDetailMd = torrResult?.detected
    ? `**보유 확인** (신뢰도: ${torrResult.confidence.toUpperCase()})\n` +
      `감지 근거:\n${torrResult.evidence.map(e => `  - "${e.keyword}" [${e.source}]${e.url ? ' → ' + e.url : ''}`).join('\n')}\n` +
      `보유 제품: ${torrResult.products_found.join(', ')}\n` +
      `영업 전략: 기존 사용자 → 추가 팁/소모품/업그레이드 제안`
    : `**없음** (신뢰도: ${torrConfidence.toUpperCase()})\n` +
      `감지 키워드 스캔: 0건 매칭\n전체 텍스트 + 네비게이션 + URL 스캔 완료`;

  // SNS 채널 카운트
  const snsChannels = [ci?.instagram, ci?.youtube, ci?.blog, ci?.facebook, ci?.kakao_channel, ci?.naver_booking, ci?.naver_place].filter(Boolean);

  // [v5.5] 위치명 경고 + 프랜차이즈 정보
  const regionWarning = resolvedRegion?.mismatch
    ? `\n| ⚠️ 위치 불일치 | DB="${resolvedRegion.dbRegion}" → 주소="${resolvedRegion.region}" (${resolvedRegion.crawledAddress || 'N/A'}) |`
    : '';
  const franchiseInfo = resolvedRegion?.franchise
    ? `\n| 프랜차이즈 | ${resolvedRegion.franchise.domain} [${resolvedRegion.franchise.branch}점] |`
    : '';

  let report = `# 크롤링 보고서: ${hospitalName}

| 항목 | 결과 |
|------|------|
| 병원명 | ${hospitalName} (${region}) |
| URL | ${url} |${regionWarning}${franchiseInfo}
| 실행 버전 | v5.5 |
| 실행 일시 | ${now} |
| 총 소요 시간 | ${elapsed} |
| **최종 판정** | **${finalVerdict}** |

### 핵심 수치
| 카테고리 | 추출 건수 | 품질 판정 |
|----------|-----------|-----------|
| 의사 | ${analysis.doctors.length}명 | ${judge(analysis.doctors.length, 1)} |
| 학술활동 | ${v54?.academic_activities?.length || 0}건 | ${judge(v54?.academic_activities?.length || 0, 1)} |
| 의료기기 | ${totalMedDev}종 (장비${devices.length}+주사${injectables.length}) | ${judge(totalMedDev, 1)} |
| 시술 | ${totalTreat}개 | ${judge(totalTreat, 3)} |
| 가격 확보율 | ${priceCount}/${totalTreat} (${totalTreat > 0 ? Math.round(priceCount / totalTreat * 100) : 0}%) | ${judge(priceCount, 1)} |
| 이벤트 | ${analysis.events.length}건 | ${analysis.events.length > 0 ? '✅ 양호' : '⚠️ 검증필요'} |
| 클리닉 카테고리 | ${v54?.clinic_categories?.length || 0}개 | ${(v54?.clinic_categories?.length || 0) > 0 ? '✅ 양호' : '⚠️ 검증필요'} |
| 컨택 포인트 | 이메일 ${ci?.email?.length ? 'Y' : 'N'}, 전화 ${ci?.phone?.length ? 'Y' : 'N'}, SNS ${snsChannels.length}개 | ${(ci?.email?.length || ci?.phone?.length) ? '✅ 양호' : '❌ 미흡'} |

---

## 추출 결과 상세

### 의사 (${analysis.doctors.length}명)
| # | 이름 | 직책 | 전문분야 | 이름 검증 | 추출 근거 |
|---|------|------|----------|-----------|-----------|
${analysis.doctors.map((d, i) => {
  const ns = d.notes?.match(/name_source: (\w+)/)?.[1] || 'unknown';
  const icon = ns === 'web_verified' ? '✅' : ns === 'web_corrected' ? '✅' : '⚠️';
  const src = ns === 'web_verified' || ns === 'web_corrected' ? '웹 텍스트' : ns === 'ocr_confirmed' ? 'OCR+웹' : 'OCR';
  return `| ${i + 1} | ${d.name} | ${d.title} | ${d.specialty || '-'} | ${icon} ${ns} | ${src} |`;
}).join('\n') || '| - | - | - | - | - | - |'}

${analysis.doctors.length > 0 ? `#### 의사 상세 프로필
${analysis.doctors.map(d => {
  const v54doc = v54?.doctors?.find(vd => vd.name === d.name);
  const edu = v54doc?.education ? (Array.isArray(v54doc.education) ? v54doc.education.join(', ') : v54doc.education) : d.education || '-';
  const career = v54doc?.career ? (Array.isArray(v54doc.career) ? v54doc.career.join(', ') : v54doc.career) : d.career || '-';
  const certs = v54doc?.certifications?.join(', ') || '-';
  return `- **${d.name}** (${d.title})\n  학력: ${edu}\n  경력: ${career}\n  자격: ${certs}`;
}).join('\n\n')}` : ''}

### 학술활동 (${v54?.academic_activities?.length || 0}건)
| # | 유형 | 내용 | 관련 의사 | 연도 | 출처 |
|---|------|------|-----------|------|------|
${(v54?.academic_activities || []).map((a, i) =>
  `| ${i + 1} | ${a.type} | ${a.title} | ${a.doctor_name || '-'} | ${a.year || '-'} | ${a.source_text || '본문'} |`
).join('\n') || '| - | - | 없음 | - | - | - |'}

### 의료기기 (${totalMedDev}종)

#### 장비 (device) — ${devices.length}종
| # | 장비명 | 제조사 | 분류 | 추출 근거 |
|---|--------|--------|------|-----------|
${devices.length > 0 ? devices.map((d, i) => `| ${i + 1} | ${d.name} | ${d.manufacturer || '-'} | ${d.subcategory} | ${d.source || '본문'} |`).join('\n') : '| - | (없음) | - | - | - |'}

#### 주사제 (injectable) — ${injectables.length}종
| # | 제품명 | 제조사 | 분류 | 추출 근거 |
|---|--------|--------|------|-----------|
${injectables.length > 0 ? injectables.map((d, i) => `| ${i + 1} | ${d.name} | ${d.manufacturer || '-'} | ${d.subcategory} | ${d.source || '본문'} |`).join('\n') : '| - | (없음) | - | - | - |'}

### TORR RF 보유 여부
${torrDetailMd}

### 시술 전체 목록 (${totalTreat}개, 가격 확보 ${priceCount}개)
| # | 시술명 | 가격 | 비고 |
|---|--------|------|------|
${analysis.treatments.map((t2, i) =>
  `| ${i + 1} | ${t2.name} | ${t2.price && t2.price > 0 ? t2.price.toLocaleString() + '원' : '-'} | ${t2.price_note || t2.combo_with || (t2.is_promoted ? '프로모션' : '-')} |`
).join('\n') || '| - | (없음) | - | - |'}

### 클리닉 카테고리 (${v54?.clinic_categories?.length || 0}개)
| 클리닉명 | 소속 시술 | 시술 수 |
|----------|-----------|---------|
${(v54?.clinic_categories || []).map(c =>
  `| ${c.name} | ${c.treatments?.slice(0, 5).join(', ')}${(c.treatments?.length || 0) > 5 ? ' ...' : ''} | ${c.treatments?.length || 0}개 |`
).join('\n') || '| - | - | - |'}

### 이벤트/할인 (${analysis.events.length}건)
| # | 이벤트명 | 유형 | 내용 | 출처 |
|---|----------|------|------|------|
${analysis.events.map((e, i) => {
  const v54evt = v54?.events?.[i];
  return `| ${i + 1} | ${e.title} | ${v54evt?.type || '-'} | ${e.description || '-'} | ${v54evt?.source || '본문'} |`;
}).join('\n') || '| - | 없음 | - | - | - |'}

### 컨택 포인트
| 채널 | 정보 | 추출 근거 |
|------|------|-----------|
| 이메일 | ${emailInfo} | ${ci?.email?.length ? ci.email[0].type || '본문' : '-'} |
| 전화 | ${phoneInfo} | ${ci?.phone?.length ? ci.phone[0].type || '본문' : '-'} |
| 주소 | ${ci?.address?.full_address || '-'} | 본문 |
| 카카오톡 | ${ci?.kakao_channel || '없음'} | ${ci?.kakao_channel ? 'URL 패턴' : '-'} |
| 네이버예약 | ${ci?.naver_booking || '없음'} | ${ci?.naver_booking ? 'URL 패턴' : '-'} |
| 네이버플레이스 | ${ci?.naver_place || '없음'} | ${ci?.naver_place ? 'URL 패턴' : '-'} |
| 인스타그램 | ${ci?.instagram || '없음'} | ${ci?.instagram ? 'URL 패턴' : '-'} |
| 페이스북 | ${ci?.facebook || '없음'} | ${ci?.facebook ? 'URL 패턴' : '-'} |
| 유튜브 | ${ci?.youtube || '없음'} | ${ci?.youtube ? 'URL 패턴' : '-'} |
| 블로그 | ${ci?.blog || '없음'} | ${ci?.blog ? 'URL 패턴' : '-'} |
${ci?.operating_hours ? `| 운영시간 | 평일 ${ci.operating_hours.weekday || '-'}, 토 ${ci.operating_hours.saturday || '-'}, 일 ${ci.operating_hours.sunday || '-'} | 점심 ${ci.operating_hours.lunch_break || '-'} |` : ''}

---

## 영업 활용 인사이트

### TORR RF 분석
- 보유 여부: ${hasTorr ? '보유 확인' : '미보유'}
- 신뢰도: ${torrConfidence.toUpperCase()}
${hasTorr && torrResult?.evidence ? torrResult.evidence.map(e => `- 근거: "${e.keyword}" [${e.source}]${e.url ? ' → ' + e.url : ''}`).join('\n') : ''}
${hasTorr ? `- 보유 제품: ${torrResult?.products_found?.join(', ') || 'TORR RF'}\n- 영업 전략: 기존 사용자 → 추가 팁/소모품/업그레이드 제안` : ''}

### RF 경쟁 장비
${devices.filter(d => d.subcategory === 'RF' && !d.name.toLowerCase().includes('torr')).length > 0
  ? devices.filter(d => d.subcategory === 'RF' && !d.name.toLowerCase().includes('torr')).map(d => `- ${d.name} (${d.manufacturer || '제조사 미확인'}) — 직접 경쟁`).join('\n')
  : '- RF 경쟁 장비 없음 → 신규 도입 최적'}
${devices.filter(d => d.subcategory === 'HIFU').length > 0 ? `\n### HIFU/보완 장비\n${devices.filter(d => d.subcategory === 'HIFU').map(d => `- ${d.name}`).join('\n')}` : ''}

### 주사제 시사점
${injectables.length > 0 ? injectables.map(d => {
  let insight = '';
  if (d.subcategory === 'collagen_stimulator') insight = ' → 리프팅 니즈, TORR RF 시너지';
  else if (d.subcategory === 'booster') insight = ' → 피부 재생 관심';
  else if (d.subcategory === 'lipolytic') insight = ' → 바디 관심, TORR RF 바디팁';
  else if (d.subcategory === 'filler') insight = ' → 볼륨 시술 수요';
  else if (d.subcategory === 'botox') insight = ' → 기본 시술 보유';
  return `- ${d.name} (${d.subcategory})${insight}`;
}).join('\n') : '- 주사제 미확인'}
${devices.filter(d => d.subcategory === 'RF').length === 0 && injectables.length > 0 ? `\n> 분석: RF 장비 미보유 + 주사제 ${injectables.length}종 사용 중 = 시술 니즈는 있으나 장비 투자 안 한 상태. TORR RF 도입 시 기존 주사 시술과 결합 패키지 제안 효과적.` : ''}

### 의사진 분석
- 총 ${analysis.doctors.length}명
- 학술활동 수준: ${(v54?.academic_activities?.length || 0) > 5 ? '활발 (5건 이상)' : (v54?.academic_activities?.length || 0) > 0 ? '보통' : '미확인'}
${(v54?.academic_activities || []).some(a => /국제|international|해외|학회/i.test(a.title)) ? '- 국제 학회 경험 있음 → 근거 중심 어프로치 유효' : ''}

### 가격대 분석
- RF/리프팅 시술 가격대: ${rfPriceRange}
${analysis.treatments.filter(t2 => t2.is_promoted).length > 0 ? `- 프로모션 시술 ${analysis.treatments.filter(t2 => t2.is_promoted).length}건 → 가격 경쟁 의향 있음` : ''}

### 최적 컨택 전략
${(() => {
  const channels: string[] = [];
  if (ci?.email?.length) channels.push(`이메일 (${ci.email[0].address}) → 콜드메일 발송`);
  if (ci?.kakao_channel) channels.push(`카카오톡 채널 → 상담 문의`);
  if (ci?.phone?.length) channels.push(`전화 (${ci.phone[0].number}) → 원장님 면담 요청`);
  if (ci?.instagram) channels.push(`인스타그램 DM → 소셜 접근`);
  return channels.length > 0
    ? channels.map((ch, i) => `- ${i + 1}순위: ${ch}`).join('\n')
    : '- 연락처 미확보 — 네이버/카카오 통해 접근 필요';
})()}

---

## v4 대비 비교
| 항목 | 이전 (v4) | 이번 (v5.5) | 변화 |
|------|-----------|-------------|------|
| 의사 | ${v4Counts.doctors}명 | ${analysis.doctors.length}명 | ${analysis.doctors.length - v4Counts.doctors >= 0 ? '+' : ''}${analysis.doctors.length - v4Counts.doctors} |
| 시술 | ${v4Counts.treat}개 | ${totalTreat}개 | ${totalTreat - v4Counts.treat >= 0 ? '+' : ''}${totalTreat - v4Counts.treat} |
| 장비 | ${v4Counts.equip}종 | ${analysis.equipments.length}종 | ${analysis.equipments.length - v4Counts.equip >= 0 ? '+' : ''}${analysis.equipments.length - v4Counts.equip} |
| 이벤트 | ${v4Counts.events}건 | ${analysis.events.length}건 | ${analysis.events.length - v4Counts.events >= 0 ? '+' : ''}${analysis.events.length - v4Counts.events} |

## 크롤링 현황
| 항목 | 수치 |
|------|------|
| 크롤 성공 | ${pages.length}개 |
| Firecrawl 크레딧 | ${credits} 크레딧 |
| Gemini 호출 | ${geminiCalls}회 |
| OCR 성공 | ${ocrSuccessCount}/${ocrResults.length}장 |
| 전체 커버리지 | ${coverageOverall}% |
`;

  const reportBaseDir = path.resolve(__dirname, '..', 'output', 'reports');
  const dateStr = new Date().toISOString().substring(0, 10).replace(/-/g, '');
  const safeName = hospitalName.replace(/[()]/g, (c: string) => c === '(' ? '_' : '').replace(/ /g, '_');
  const noPad = String(hospitalNo).padStart(3, '0');
  const folderName = `${dateStr}-${safeName}-v56-${noPad}`;
  const reportDir = path.resolve(reportBaseDir, folderName);
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.resolve(reportDir, `${folderName}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`  📄 [v5.5] 보고서 생성: ${reportPath}`);

  // ── Word (.docx) 보고서 생성 (v5.5: 포맷 개선) ──
  try {
    const docxPath = path.resolve(reportDir, `${folderName}.docx`);
    const thinBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
    const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

    // v5.5: columnWidths 지정 (DXA 기준, 9360 = US Letter 가용폭)
    const makeHeaderCellW = (text: string, widthDxa: number): TableCell => new TableCell({
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, size: 20, font: 'Malgun Gothic' })] })],
      borders: cellBorders, width: { size: widthDxa, type: WidthType.DXA },
      shading: { fill: 'D5E8F0' }, margins: cellMargins,
    });
    const makeCellW = (text: string, widthDxa: number, isEven = false): TableCell => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: 'Malgun Gothic' })] })],
      borders: cellBorders, width: { size: widthDxa, type: WidthType.DXA },
      shading: isEven ? { fill: 'F5F5F5' } : undefined, margins: cellMargins,
    });

    // 간편 row 생성 (균등 폭)
    const makeCell = (text: string, isEven = false): TableCell => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: 'Malgun Gothic' })] })],
      borders: cellBorders, shading: isEven ? { fill: 'F5F5F5' } : undefined, margins: cellMargins,
    });
    const makeHeaderCell = (text: string): TableCell => new TableCell({
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, size: 20, font: 'Malgun Gothic' })] })],
      borders: cellBorders, shading: { fill: 'D5E8F0' }, margins: cellMargins,
    });
    const makeRow = (cells: string[], isEven = false): TableRow => new TableRow({
      children: cells.map(c => makeCell(c, isEven)),
    });
    const makeHeaderRow = (cells: string[]): TableRow => new TableRow({
      children: cells.map(c => makeHeaderCell(c)),
    });

    const heading = (text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1): Paragraph =>
      new Paragraph({ heading: level, children: [new TextRun({ text, font: 'Malgun Gothic', bold: true })] });
    const para = (text: string, opts?: { bold?: boolean; color?: string }): Paragraph =>
      new Paragraph({ children: [new TextRun({ text, font: 'Malgun Gothic', size: 22, bold: opts?.bold, color: opts?.color })] });
    const emptyLine = (): Paragraph => new Paragraph({ children: [] });

    // ── 요약 테이블 ──
    // [v5.5] 위치/프랜차이즈 경고 행
    const regionRows: TableRow[] = [];
    if (resolvedRegion?.mismatch) {
      regionRows.push(makeRow([
        '위치 불일치',
        `DB="${resolvedRegion.dbRegion}" → 주소="${resolvedRegion.region}" (${resolvedRegion.crawledAddress || 'N/A'})`,
      ], regionRows.length % 2 === 1));
    }
    if (resolvedRegion?.franchise) {
      regionRows.push(makeRow([
        '프랜차이즈',
        `${resolvedRegion.franchise.domain} [${resolvedRegion.franchise.branch}점]`,
      ], regionRows.length % 2 === 1));
    }

    const summaryTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['항목', '결과']),
        makeRow(['병원명', `${hospitalName} (${region})`]),
        makeRow(['URL', url], true),
        ...regionRows,
        makeRow(['실행 버전', 'v5.5']),
        makeRow(['실행 일시', now], true),
        makeRow(['소요 시간', elapsed]),
        makeRow(['최종 판정', finalVerdict.replace(/[✅❌⚠️]/g, '').trim()], true),
      ],
    });

    // ── 핵심 수치 테이블 ──
    const metricsTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['카테고리', '추출 건수', '판정']),
        makeRow(['의사', `${analysis.doctors.length}명`, judge(analysis.doctors.length, 1).replace(/[✅⚠️❌]/g, '').trim()]),
        makeRow(['학술활동', `${v54?.academic_activities?.length || 0}건`, judge(v54?.academic_activities?.length || 0, 1).replace(/[✅⚠️❌]/g, '').trim()], true),
        makeRow(['의료기기', `${totalMedDev}종 (장비${devices.length}+주사${injectables.length})`, judge(totalMedDev, 1).replace(/[✅⚠️❌]/g, '').trim()]),
        makeRow(['시술', `${totalTreat}개`, judge(totalTreat, 3).replace(/[✅⚠️❌]/g, '').trim()], true),
        makeRow(['가격 확보율', `${priceCount}/${totalTreat}`, judge(priceCount, 1).replace(/[✅⚠️❌]/g, '').trim()]),
        makeRow(['이벤트', `${analysis.events.length}건`, analysis.events.length > 0 ? '양호' : '검증필요'], true),
        makeRow(['컨택 포인트', `이메일:${ci?.email?.length ? 'Y' : 'N'} 전화:${ci?.phone?.length ? 'Y' : 'N'} SNS:${snsChannels.length}`, (ci?.email?.length || ci?.phone?.length) ? '양호' : '미흡']),
      ],
    });

    // ── 의사 테이블 (v5.5: columnWidths + 추출근거) ──
    // 이름(15%) 직책(12%) 전문분야(40%) 이름검증(13%) 추출근거(20%)
    const doctorHeaderRow = new TableRow({
      children: [
        makeHeaderCellW('이름', 1404), makeHeaderCellW('직책', 1123),
        makeHeaderCellW('전문분야', 3744), makeHeaderCellW('이름검증', 1217),
        makeHeaderCellW('추출근거', 1872),
      ],
    });
    const doctorDataRows = analysis.doctors.map((d, i) => {
      const ns = d.notes?.match(/name_source: (\w+)/)?.[1] || 'unknown';
      const src = ns === 'web_verified' || ns === 'web_corrected' ? '웹 텍스트' : ns === 'ocr_confirmed' ? 'OCR+웹' : 'OCR';
      const isEven = i % 2 === 1;
      return new TableRow({
        children: [
          makeCellW(d.name, 1404, isEven), makeCellW(d.title, 1123, isEven),
          makeCellW(d.specialty || '-', 3744, isEven), makeCellW(ns, 1217, isEven),
          makeCellW(src, 1872, isEven),
        ],
      });
    });
    const doctorTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: doctorDataRows.length > 0
        ? [doctorHeaderRow, ...doctorDataRows]
        : [doctorHeaderRow, new TableRow({ children: [makeCellW('-', 1404), makeCellW('의사 없음', 1123), makeCellW('-', 3744), makeCellW('-', 1217), makeCellW('-', 1872)] })],
    });

    // ── 의료기기 테이블 (v5.5: #, 장비명, 제조사, 분류, 추출근거, 관련시술) ──
    // 5% 25% 15% 15% 20% 20%
    const devHeaderRow = new TableRow({
      children: [
        makeHeaderCellW('#', 468), makeHeaderCellW('장비명', 2340),
        makeHeaderCellW('제조사', 1404), makeHeaderCellW('분류', 1404),
        makeHeaderCellW('추출근거', 1872), makeHeaderCellW('관련시술', 1872),
      ],
    });
    const devDataRows = devices.length > 0
      ? devices.map((d, i) => {
        const isEven = i % 2 === 1;
        const relTreat = analysis.treatments.filter(t2 => t2.name.toLowerCase().includes(d.name.toLowerCase().split(' ')[0])).map(t2 => t2.name).slice(0, 2).join(', ') || '-';
        return new TableRow({
          children: [
            makeCellW(`${i + 1}`, 468, isEven), makeCellW(d.name, 2340, isEven),
            makeCellW(d.manufacturer || '-', 1404, isEven), makeCellW(d.subcategory, 1404, isEven),
            makeCellW(d.source || '본문', 1872, isEven), makeCellW(relTreat, 1872, isEven),
          ],
        });
      })
      : [new TableRow({ children: [makeCellW('-', 468), makeCellW('장비 없음', 2340), makeCellW('-', 1404), makeCellW('-', 1404), makeCellW('-', 1872), makeCellW('-', 1872)] })];
    const deviceTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [devHeaderRow, ...devDataRows],
    });

    // 주사제 테이블 (같은 구조)
    const injDataRows = injectables.length > 0
      ? injectables.map((d, i) => {
        const isEven = i % 2 === 1;
        return new TableRow({
          children: [
            makeCellW(`${i + 1}`, 468, isEven), makeCellW(d.name, 2340, isEven),
            makeCellW(d.manufacturer || '-', 1404, isEven), makeCellW(d.subcategory, 1404, isEven),
            makeCellW(d.source || '본문', 1872, isEven), makeCellW('-', 1872, isEven),
          ],
        });
      })
      : [new TableRow({ children: [makeCellW('-', 468), makeCellW('주사제 없음', 2340), makeCellW('-', 1404), makeCellW('-', 1404), makeCellW('-', 1872), makeCellW('-', 1872)] })];
    const injTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [devHeaderRow, ...injDataRows],
    });

    // ── 시술 전체 테이블 (v5.5: 전체 출력, 상위 20개 제한 해제) ──
    // 5% 40% 15% 40%
    const treatHeaderRow = new TableRow({
      children: [
        makeHeaderCellW('#', 468), makeHeaderCellW('시술명', 3744),
        makeHeaderCellW('가격', 1404), makeHeaderCellW('비고', 3744),
      ],
    });
    const treatDataRows = analysis.treatments.length > 0
      ? analysis.treatments.map((t2, i) => {
        const isEven = i % 2 === 1;
        const note = t2.price_note || t2.combo_with || (t2.is_promoted ? '프로모션' : '-');
        return new TableRow({
          children: [
            makeCellW(`${i + 1}`, 468, isEven), makeCellW(t2.name, 3744, isEven),
            makeCellW(t2.price && t2.price > 0 ? `${t2.price.toLocaleString()}원` : '-', 1404, isEven),
            makeCellW(note, 3744, isEven),
          ],
        });
      })
      : [new TableRow({ children: [makeCellW('-', 468), makeCellW('시술 없음', 3744), makeCellW('-', 1404), makeCellW('-', 3744)] })];
    const treatTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [treatHeaderRow, ...treatDataRows],
    });

    // ── 연락처 테이블 (v5.5: 추출 근거 열) ──
    // 15% 60% 25%
    const contactHeaderRow = new TableRow({
      children: [
        makeHeaderCellW('채널', 1404), makeHeaderCellW('정보', 5616),
        makeHeaderCellW('추출근거', 2340),
      ],
    });
    const contactItems: Array<[string, string, string]> = [
      ['이메일', emailInfo, ci?.email?.length ? (ci.email[0].type || '본문') : '-'],
      ['전화', phoneInfo, ci?.phone?.length ? (ci.phone[0].type || '본문') : '-'],
      ['주소', ci?.address?.full_address || '-', '본문'],
      ['카카오톡', ci?.kakao_channel || '없음', ci?.kakao_channel ? 'URL 패턴' : '-'],
      ['네이버예약', ci?.naver_booking || '없음', ci?.naver_booking ? 'URL 패턴' : '-'],
      ['네이버플레이스', ci?.naver_place || '없음', ci?.naver_place ? 'URL 패턴' : '-'],
      ['인스타그램', ci?.instagram || '없음', ci?.instagram ? 'URL 패턴' : '-'],
      ['페이스북', ci?.facebook || '없음', ci?.facebook ? 'URL 패턴' : '-'],
      ['유튜브', ci?.youtube || '없음', ci?.youtube ? 'URL 패턴' : '-'],
      ['블로그', ci?.blog || '없음', ci?.blog ? 'URL 패턴' : '-'],
    ];
    if (ci?.operating_hours) {
      contactItems.push(['운영시간', `평일 ${ci.operating_hours.weekday || '-'}, 토 ${ci.operating_hours.saturday || '-'}, 일 ${ci.operating_hours.sunday || '-'}`, `점심 ${ci.operating_hours.lunch_break || '-'}`]);
    }
    const contactDataRows = contactItems.map(([ch, info, src], i) => {
      const isEven = i % 2 === 1;
      return new TableRow({
        children: [makeCellW(ch, 1404, isEven), makeCellW(info, 5616, isEven), makeCellW(src, 2340, isEven)],
      });
    });
    const contactTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [contactHeaderRow, ...contactDataRows],
    });

    // ── 이벤트 테이블 ──
    const eventHeaderRow = new TableRow({
      children: [
        makeHeaderCellW('#', 468), makeHeaderCellW('이벤트명', 2340),
        makeHeaderCellW('유형', 1100), makeHeaderCellW('내용', 3580),
        makeHeaderCellW('출처', 1872),
      ],
    });
    const eventDataRows = analysis.events.length > 0
      ? analysis.events.map((e, i) => {
        const isEven = i % 2 === 1;
        const v54evt = v54?.events?.[i];
        return new TableRow({
          children: [
            makeCellW(`${i + 1}`, 468, isEven), makeCellW(e.title, 2340, isEven),
            makeCellW(v54evt?.type || '-', 1100, isEven), makeCellW(e.description || '-', 3580, isEven),
            makeCellW(v54evt?.source || '본문', 1872, isEven),
          ],
        });
      })
      : [new TableRow({ children: [makeCellW('-', 468), makeCellW('이벤트 없음', 2340), makeCellW('-', 1100), makeCellW('-', 3580), makeCellW('-', 1872)] })];
    const eventTable = new Table({
      width: { size: 9360, type: WidthType.DXA },
      rows: [eventHeaderRow, ...eventDataRows],
    });

    // ── TORR RF 섹션 ──
    const torrSection: Paragraph[] = [
      heading('TORR RF 보유 분석', HeadingLevel.HEADING_2),
      para(`보유 여부: ${hasTorr ? '보유 확인' : '없음'}`, { bold: true }),
      para(`감지 신뢰도: ${torrConfidence.toUpperCase()}`),
    ];
    if (torrResult?.detected && torrResult.evidence.length > 0) {
      torrSection.push(para('감지 근거:', { bold: true }));
      for (const e of torrResult.evidence) {
        torrSection.push(para(`  - "${e.keyword}" [${e.source}]${e.url ? ' → ' + e.url : ''}`));
      }
      torrSection.push(para(`보유 제품: ${torrResult.products_found.join(', ')}`));
      torrSection.push(para('영업 전략: 기존 사용자 → 추가 팁/소모품/업그레이드 제안'));
    } else {
      torrSection.push(para('감지 키워드 스캔: 0건 매칭'));
      torrSection.push(para('전체 텍스트 + 네비게이션 + URL 스캔 완료'));
    }

    // ── 영업 인사이트 ──
    const insightItems: Paragraph[] = [
      heading('영업 인사이트', HeadingLevel.HEADING_2),
      para('RF 경쟁 장비:', { bold: true }),
    ];
    const rfCompetitors = devices.filter(d => d.subcategory === 'RF' && !d.name.toLowerCase().includes('torr'));
    if (rfCompetitors.length > 0) {
      for (const d of rfCompetitors) insightItems.push(para(`  - ${d.name} (${d.manufacturer || '제조사 미확인'}) — 직접 경쟁`));
    } else {
      insightItems.push(para('  - RF 경쟁 장비 없음 → 신규 도입 최적'));
    }
    insightItems.push(emptyLine());
    insightItems.push(para(`의사진: ${analysis.doctors.length}명, 학술활동: ${(v54?.academic_activities?.length || 0) > 5 ? '활발' : (v54?.academic_activities?.length || 0) > 0 ? '보통' : '미확인'}`));
    insightItems.push(para(`RF/리프팅 가격대: ${rfPriceRange}`));
    if (injectables.length > 0 && devices.filter(d => d.subcategory === 'RF').length === 0) {
      insightItems.push(para(`RF 미보유 + 주사제 ${injectables.length}종 → 장비 투자 미진, TORR RF 도입 패키지 제안 효과적`, { color: '0066CC' }));
    }
    insightItems.push(emptyLine());
    insightItems.push(para('컨택 전략:', { bold: true }));
    const ctChannels: string[] = [];
    if (ci?.email?.length) ctChannels.push(`이메일 (${ci.email[0].address})`);
    if (ci?.kakao_channel) ctChannels.push('카카오톡 채널');
    if (ci?.phone?.length) ctChannels.push(`전화 (${ci.phone[0].number})`);
    if (ci?.instagram) ctChannels.push('인스타그램 DM');
    if (ctChannels.length > 0) {
      ctChannels.forEach((ch, i) => insightItems.push(para(`  ${i + 1}순위: ${ch}`)));
    } else {
      insightItems.push(para('  연락처 미확보 — 네이버/카카오 통해 접근 필요', { color: 'CC0000' }));
    }

    // ── v4 비교 테이블 ──
    const compareTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        makeHeaderRow(['항목', '이전(v4)', '이번(v5.5)', '변화']),
        makeRow(['의사', `${v4Counts.doctors}명`, `${analysis.doctors.length}명`, `${analysis.doctors.length - v4Counts.doctors >= 0 ? '+' : ''}${analysis.doctors.length - v4Counts.doctors}`]),
        makeRow(['시술', `${v4Counts.treat}개`, `${totalTreat}개`, `${totalTreat - v4Counts.treat >= 0 ? '+' : ''}${totalTreat - v4Counts.treat}`], true),
        makeRow(['장비', `${v4Counts.equip}종`, `${analysis.equipments.length}종`, `${analysis.equipments.length - v4Counts.equip >= 0 ? '+' : ''}${analysis.equipments.length - v4Counts.equip}`]),
        makeRow(['이벤트', `${v4Counts.events}건`, `${analysis.events.length}건`, `${analysis.events.length - v4Counts.events >= 0 ? '+' : ''}${analysis.events.length - v4Counts.events}`], true),
      ],
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Malgun Gothic', size: 22 } } } },
      sections: [{
        children: [
          heading(`크롤링 보고서: ${hospitalName}`),
          emptyLine(),
          summaryTable,
          emptyLine(),
          heading('핵심 수치', HeadingLevel.HEADING_2),
          metricsTable,
          emptyLine(),
          para(`${hospitalName} — 의사 ${analysis.doctors.length}명, 의료기기 ${totalMedDev}종(장비${devices.length}+주사${injectables.length}), 시술 ${totalTreat}개 추출. ${hasTorr ? 'TORR RF 보유.' : 'TORR RF 미보유.'} 가격 ${priceCount}건 확보.`),
          emptyLine(),

          heading('의사', HeadingLevel.HEADING_2),
          doctorTable,
          emptyLine(),

          heading(`의료기기 (${totalMedDev}종)`, HeadingLevel.HEADING_2),
          para(`장비 (device) — ${devices.length}종`, { bold: true }),
          deviceTable,
          emptyLine(),
          para(`주사제 (injectable) — ${injectables.length}종`, { bold: true }),
          injTable,
          emptyLine(),

          ...torrSection,
          emptyLine(),

          heading(`시술 전체 (${totalTreat}개)`, HeadingLevel.HEADING_2),
          treatTable,
          emptyLine(),

          heading(`이벤트 (${analysis.events.length}건)`, HeadingLevel.HEADING_2),
          eventTable,
          emptyLine(),

          heading('연락처', HeadingLevel.HEADING_2),
          contactTable,
          emptyLine(),

          ...insightItems,
          emptyLine(),

          heading('v4 대비 변화', HeadingLevel.HEADING_2),
          compareTable,
          emptyLine(),
          ...buildImageSection(pages),
        ],
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(docxPath, buffer);
    console.log(`  📄 [v5.5] Word 보고서: ${docxPath}`);
  } catch (err) {
    console.log(`  ⚠️ Word 보고서 생성 실패: ${err}`);
  }
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'crawl';
  if (mode === 'analyze') { await runAnalyzeMode(args); return; }
  const dryRun = args.includes('--dry-run');
  const skipGemini = args.includes('--skip-gemini');
  const onlyGemini = args.includes('--only-gemini');
  const noScreenshot = args.includes('--no-screenshot');
  const playwrightOnly = args.includes('--playwright-only');
  const ocrMode = args.includes('--ocr');
  const skipDone = args.includes('--skip-done');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;
  const startIdx = args.indexOf('--start-from');
  const startFrom = startIdx >= 0 ? parseInt(args[startIdx + 1]) : 0;

  // [v5.6] 파일 로거 초기화
  const logPath = initLogger();

  console.log('═══════════════════════════════════════════════════');
  console.log('  Recrawl v5.6: 2-Step OCR+분류 + TORR감지 + 연락처패턴 + 병원명검증');
  console.log('═══════════════════════════════════════════════════\n');
  console.log(`📝 로그 파일: ${logPath}`);

  // [v5.6] 사전 점검
  if (!dryRun) {
    const ok = await preflight({ skipGemini });
    if (!ok) { closeLogger(); process.exit(1); }
  }

  const nameIdx = args.indexOf('--name');
  const nameFilter = nameIdx >= 0 ? args[nameIdx + 1] : undefined;

  // [v5.7] --input: 외부 targets.json 파일에서 대상 로드 (batch-selector 연동)
  const inputIdx = args.indexOf('--input');
  const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : undefined;

  const allTargets = inputPath ? loadExternalTargets(inputPath) : buildTargets();
  let targets = nameFilter
    ? allTargets.filter(t => t.name.includes(nameFilter))
    : allTargets.slice(startFrom, startFrom + limit);

  // [v5.6] --skip-done: 완료된 병원 스킵
  let skippedCount = 0;
  if (skipDone) {
    const completedIds = await getCompletedHospitalIds();
    const before = targets.length;
    const skippedNames: string[] = [];
    targets = targets.filter(t => {
      // resolveHospitalId를 아직 못 쓰므로, name 기반으로 DB 조회 대신 빌드타겟 단계에서는
      // 추후 루프 내에서 hospitalId 확인 후 스킵하도록 함
      return true; // 실제 스킵은 루프 내에서 hospitalId 확인 후 처리
    });
    console.log(`🔄 --skip-done 활성: 완료 병원 ${completedIds.size}개 감지 (루프 내 스킵 적용)`);
  }

  console.log(`📋 이번 실행: ${targets.length}개${nameFilter ? ` (필터: "${nameFilter}")` : ` (${startFrom}번째부터)`}`);
  console.log(`🔧 모드: ${dryRun ? 'DRY RUN' : playwrightOnly ? 'Playwright Only (Firecrawl 건너뜀)' : skipGemini ? '크롤링만' : onlyGemini ? 'Gemini분석만' : '풀 파이프라인'}${ocrMode ? ' + OCR' : ''}${skipDone ? ' + skip-done' : ''}`);
  console.log(`📐 Gemini 모델: ${getGeminiModel()}`);

  if (dryRun) {
    for (const t of targets) console.log(`  No.${t.no} ${t.name} (${t.region}): ${t.url}`);
    closeLogger();
    return;
  }

  let totalCredits = 0;
  let totalGeminiCalls = 0;
  let consecutiveErrors = 0;
  // [v5.6] --skip-done용 completedIds (루프 내에서 사용)
  const completedHospitalIds = skipDone ? await getCompletedHospitalIds() : new Set<string>();
  const summary: Array<{
    no: number; name: string; pages: number; credits: number; geminiCalls: number;
    equip: number; treat: number; doctors: number; events: number;
    coverage: number; status: string; v4: { equip: number; treat: number; doctors: number; events: number };
    siteType?: string; error?: string; elapsedMs: number;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const hospitalStartTime = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`  [${i + 1}/${targets.length}] No.${t.no} ${t.name}`);
    console.log('─'.repeat(60));

    // [v5.8] 병원 단위 try-catch — 한 병원 실패가 전체 배치를 죽이지 않도록 방어
    try {

    const hospitalId = await resolveHospitalId(t.name, t.url);
    if (!hospitalId) {
      consecutiveErrors++;
      summary.push({ no: t.no, name: t.name, pages: 0, credits: 0, geminiCalls: 0,
        equip: 0, treat: 0, doctors: 0, events: 0, coverage: 0, status: 'error',
        v4: { equip: 0, treat: 0, doctors: 0, events: 0 }, error: 'CRM not found', elapsedMs: Date.now() - hospitalStartTime });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n🛑 연속 ${MAX_CONSECUTIVE_ERRORS}회 에러 — 자동 중단`);
        break;
      }
      continue;
    }

    // [v5.6] --skip-done: 이미 완료된 병원 스킵
    if (skipDone && completedHospitalIds.has(hospitalId)) {
      console.log(`  ⏭️ 이미 완료 — 스킵`);
      skippedCount++;
      continue;
    }

    // v4 데이터 백업 (비교용)
    const v4Counts = await getV4Counts(hospitalId);

    let pages: CrawlPageResult[] = [];
    let credits = 0;
    let firecrawlFailedUrls: string[] = [];
    let firecrawlAttemptedUrls: string[] = [];
    let playwrightScreenshots: Buffer[] = [];
    let fallbackCount = 0;

    let siteFingerprint: SiteFingerprint | null = null;

    if (playwrightOnly) {
      // ── [v5.5] --playwright-only: Firecrawl 건너뛰고 Playwright만으로 크롤링 ──
      console.log(`\n  🎭 [v5.5] Playwright Only 모드 — Firecrawl 건너뜀`);

      // 1) Firecrawl mapUrl로 URL 목록만 수집 시도 (실패해도 진행)
      let urlsToVisit: string[] = [t.url];
      try {
        console.log(`  📍 URL 수집 (mapUrl)...`);
        const mapResult = await firecrawl.v1.mapUrl(t.url, { limit: 100 });
        credits += 1;
        if (mapResult.success && mapResult.links && mapResult.links.length > 0) {
          urlsToVisit = [...new Set([t.url, ...mapResult.links])];
          console.log(`  📄 mapUrl: ${mapResult.links.length}개 URL`);
        }
      } catch {
        console.log(`  ⚠️ mapUrl 실패 → 메인 URL로만 시작`);
      }

      // URL 필터링 + 우선순위
      const filtered = filterRelevantUrls(urlsToVisit, t.url);
      if (!filtered.some(u => normalizeUrl(u) === normalizeUrl(t.url))) {
        filtered.unshift(t.url);
      }
      const targetUrls = filtered.length > MAX_PAGES
        ? prioritizeUrls(filtered, t.url).slice(0, MAX_PAGES)
        : filtered;
      console.log(`  🎯 Playwright 크롤 대상: ${targetUrls.length}개 URL`);

      // 2) Playwright로 모든 URL 방문: 텍스트 + 스크린샷 + 링크 수집
      const CONCURRENCY = 3;
      const pwResults: Awaited<ReturnType<typeof captureScreenshots>>[] = [];
      for (let bi = 0; bi < targetUrls.length; bi += CONCURRENCY) {
        const batch = targetUrls.slice(bi, bi + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(url => captureScreenshots(url, {
            viewportWidth: 1280, viewportHeight: 1080,
            maxScreenshots: 15, timeout: 20000, waitAfterScroll: 400,
          })),
        );
        pwResults.push(...batchResults);
      }

      // 3) 링크에서 추가 URL 발견 (사이트맵 대체)
      if (targetUrls.length < 10) {
        const domain = new URL(t.url).hostname;
        const discoveredUrls = new Set<string>();
        for (const pwr of pwResults) {
          for (const link of pwr.links) {
            try {
              const absUrl = new URL(link.href, pwr.url).href;
              if (new URL(absUrl).hostname === domain && !targetUrls.includes(absUrl)) {
                discoveredUrls.add(absUrl);
              }
            } catch { /* 무효 URL 무시 */ }
          }
        }
        if (discoveredUrls.size > 0) {
          const extraUrls = filterRelevantUrls([...discoveredUrls], t.url).slice(0, 20);
          console.log(`  🔗 Playwright 링크 발견: +${extraUrls.length}개 → 추가 크롤링`);
          for (let bi = 0; bi < extraUrls.length; bi += CONCURRENCY) {
            const batch = extraUrls.slice(bi, bi + CONCURRENCY);
            const batchResults = await Promise.all(
              batch.map(url => captureScreenshots(url, {
                viewportWidth: 1280, viewportHeight: 1080,
                maxScreenshots: 10, timeout: 15000, waitAfterScroll: 300,
              })),
            );
            pwResults.push(...batchResults);
          }
        }
      }

      // 4) 결과를 pages 배열로 변환
      let pwSuccess = 0;
      for (const pwr of pwResults) {
        if (pwr.pageText.length > 50) {
          const pageType = classifyPageType(pwr.url, t.url);
          pages.push({
            url: pwr.url,
            pageType,
            markdown: pwr.pageText,
            charCount: pwr.pageText.length,
            screenshotEntries: pwr.screenshots.map((_, ssi) => ({
              url: '', position: `playwright_${ssi}`, order: ssi,
            })),
            screenshotBuffers: [...pwr.screenshots],
          });
          pwSuccess++;
        }
      }

      firecrawlAttemptedUrls = targetUrls;
      firecrawlFailedUrls = []; // Firecrawl 안 씀

      // playwrightScreenshots 수집 (Gemini에 전달용)
      for (const pwr of pwResults) {
        playwrightScreenshots.push(...pwr.screenshots);
      }
      const totalSsSize = playwrightScreenshots.reduce((s, b) => s + b.length, 0);
      console.log(`  📊 Playwright Only 결과: ${pwSuccess}/${pwResults.length}개 페이지 텍스트 확보`);
      console.log(`  📸 스크린샷: ${playwrightScreenshots.length}장 (${(totalSsSize / 1024).toFixed(0)}KB)`);

      // 기존 crawl_pages 삭제 + DB 저장
      await supabase.from('scv_crawl_pages').delete().eq('hospital_id', hospitalId);
      for (const p of pages) {
        const { error: dbErr } = await supabase.from('scv_crawl_pages').insert({
          hospital_id: hospitalId,
          url: p.url,
          page_type: p.pageType,
          markdown: p.markdown,
          char_count: p.charCount,
          screenshot_url: '[]',
          analysis_method: 'playwright-only',
          tenant_id: TENANT_ID,
          gemini_analyzed: false,
        });
        if (dbErr) console.log(`    ⚠️ DB 저장 실패: ${dbErr.message}`);
      }

    } else if (!onlyGemini) {
      const crawlResult = await crawlAndSave(hospitalId, t.name, t.url);
      pages = crawlResult.pages;
      credits = crawlResult.credits;
      siteFingerprint = crawlResult.siteFingerprint;
      firecrawlAttemptedUrls = crawlResult.attemptedUrls;
      firecrawlFailedUrls = crawlResult.failedUrls;
      totalCredits += credits;

      // [작업3] 핑거프린팅 결과 DB 저장
      if (siteFingerprint) {
        const { error: fpErr } = await supabase.from('hospitals').update({
          site_type: siteFingerprint.siteType,
          site_type_confidence: siteFingerprint.confidence,
          site_type_signals: siteFingerprint.signals,
        }).eq('id', hospitalId);
        if (fpErr) console.log(`  ⚠️ site_type 저장 실패 (마이그레이션 023 미적용?): ${fpErr.message}`);
      }
    } else {
      // DB에서 기존 페이지 로드
      const { data: dbPages } = await supabase.from('scv_crawl_pages')
        .select('url, page_type, markdown, char_count, screenshot_url')
        .eq('hospital_id', hospitalId).order('crawled_at');

      if (dbPages && dbPages.length > 0) {
        for (const p of dbPages) {
          const entries: ScreenshotEntry[] = [];
          const buffers: Buffer[] = [];
          // screenshot_url은 JSONB 배열
          const ssData = typeof p.screenshot_url === 'string' ? JSON.parse(p.screenshot_url) : (p.screenshot_url || []);
          for (const ss of ssData as ScreenshotEntry[]) {
            const buf = await downloadScreenshotUrl(ss.url);
            if (buf) { entries.push(ss); buffers.push(buf); }
          }
          pages.push({
            url: p.url, pageType: p.page_type, markdown: p.markdown, charCount: p.char_count,
            screenshotEntries: entries, screenshotBuffers: buffers,
          });
        }
        console.log(`  📂 DB에서 ${pages.length}페이지 로드`);
      }
    }

    // ═══════════════════════════════════════════
    // [v5.5] Playwright 스크린샷 + Firecrawl fallback
    // ═══════════════════════════════════════════
    if (!noScreenshot && !skipGemini && !playwrightOnly) {
      try {
        console.log(`\n  📸 [v5.5] Playwright 스크린샷 + fallback 시작...`);

        // Firecrawl이 성공한 URL 세트
        const successUrls = new Set(pages.map(p => p.url));

        // 스크린샷 촬영 대상: Firecrawl 성공 URL + 실패 URL (실패 URL은 텍스트도 추출)
        const screenshotUrls = [
          t.url,
          ...pages.slice(1, 15).map(p => p.url),
          ...firecrawlFailedUrls,
        ].filter((u, i, arr) => arr.indexOf(u) === i);

        console.log(`    대상: ${screenshotUrls.length}개 URL (Firecrawl 성공 ${successUrls.size}, 실패 ${firecrawlFailedUrls.length})`);

        // 병렬 제한: 3개씩 순차 배치
        const CONCURRENCY = 3;
        const ssResults: Awaited<ReturnType<typeof captureScreenshots>>[] = [];
        for (let bi = 0; bi < screenshotUrls.length; bi += CONCURRENCY) {
          const batch = screenshotUrls.slice(bi, bi + CONCURRENCY);
          const batchResults = await Promise.all(
            batch.map(url => captureScreenshots(url, {
              viewportWidth: 1280, viewportHeight: 1080,
              maxScreenshots: 15, timeout: 20000, waitAfterScroll: 400,
            })),
          );
          ssResults.push(...batchResults);
        }

        for (const ssr of ssResults) {
          if (ssr.screenshots.length > 0) {
            playwrightScreenshots.push(...ssr.screenshots);
          }
          if (ssr.errors.length > 0) {
            console.log(`    ⚠️ Playwright 에러 [${ssr.url}]: ${ssr.errors[0]}`);
          }
        }

        // [v5.5 fallback] Firecrawl 실패 URL → Playwright 텍스트로 페이지 생성
        for (const ssr of ssResults) {
          if (!successUrls.has(ssr.url) && ssr.pageText.length > 50) {
            const pageType = classifyPageType(ssr.url, t.url);
            pages.push({
              url: ssr.url,
              pageType,
              markdown: ssr.pageText,
              charCount: ssr.pageText.length,
              screenshotEntries: ssr.screenshots.map((_, ssi) => ({
                url: '', position: `playwright_${ssi}`, order: ssi,
              })),
              screenshotBuffers: [...ssr.screenshots],
            });
            fallbackCount++;
          }
        }

        const totalSsSize = playwrightScreenshots.reduce((s, b) => s + b.length, 0);
        console.log(`  📄 Firecrawl 성공: ${successUrls.size}/${firecrawlAttemptedUrls.length} 페이지`);
        if (firecrawlFailedUrls.length > 0) {
          console.log(`  ⚠️ Firecrawl 타임아웃: ${firecrawlFailedUrls.length}/${firecrawlAttemptedUrls.length} 페이지`);
        }
        if (fallbackCount > 0) {
          console.log(`  📸 Playwright fallback: ${fallbackCount}개 페이지 마크다운 대체`);
        }
        console.log(`  📊 최종: ${pages.length}/${firecrawlAttemptedUrls.length} 페이지 데이터 확보` +
          (fallbackCount > 0 ? ` (Firecrawl ${successUrls.size} + Playwright ${fallbackCount})` : ''));
        console.log(`  📸 Playwright 완료: ${playwrightScreenshots.length}장 (${(totalSsSize / 1024).toFixed(0)}KB) — ${screenshotUrls.length}개 URL`);

        // 기존 pages의 screenshotBuffers에 Playwright 스크린샷 추가 (OCR 파이프라인용)
        // Firecrawl 성공 페이지에도 스크린샷 추가
        for (const ssr of ssResults) {
          if (successUrls.has(ssr.url) && ssr.screenshots.length > 0) {
            const pageIdx = pages.findIndex(p => p.url === ssr.url);
            if (pageIdx >= 0) {
              pages[pageIdx].screenshotBuffers.push(...ssr.screenshots);
              for (let ssi = 0; ssi < ssr.screenshots.length; ssi++) {
                pages[pageIdx].screenshotEntries.push({
                  url: '', position: `playwright_${ssi}`, order: pages[pageIdx].screenshotEntries.length,
                });
              }
            }
          }
        }
      } catch (err) {
        console.log(`  ⚠️ [v5.5] Playwright 실패 (마크다운만으로 계속 진행): ${err}`);
      }
    } else if (noScreenshot) {
      console.log(`  ⏭️ [v5.5] --no-screenshot: 스크린샷 건너뜀`);
    }

    // Firecrawl 전부 실패 + Playwright fallback도 없으면 스킵
    if (pages.length === 0) {
      summary.push({ no: t.no, name: t.name, pages: 0, credits, geminiCalls: 0,
        equip: 0, treat: 0, doctors: 0, events: 0, coverage: 0, status: 'error',
        v4: v4Counts, error: 'no pages' });
      continue;
    }

    // 네비게이션 메뉴에서 시술 링크 텍스트 추출 (첫 페이지의 마크다운)
    const navTreatments = pages.length > 0 ? extractNavTreatments(pages[0].markdown) : [];
    if (navTreatments.length > 0) {
      console.log(`  📋 네비게이션 시술 링크: ${navTreatments.length}개 발견`);
    }

    // 중복 콘텐츠 제거 (동일 네비게이션 반복 방어)
    pages = deduplicatePages(pages);

    // ═══════════════════════════════════════════
    // [v5.4] 2-Step 분리 파이프라인
    // ═══════════════════════════════════════════
    let geminiCalls = 0;
    const ocrResults: OcrResult[] = [];
    let analysis: AnalysisResult & { _v54?: HospitalAnalysisV54 };
    let resolvedRegion: ResolvedRegion | undefined;

    if (!skipGemini) {
      // ── Step 1: OCR (이미지 → 텍스트) ──
      console.log(`\n  📝 [v5.4 Step 1] OCR — 이미지 텍스트 추출`);
      let allText = '';

      // 크롤 마크다운 수집 (우선순위 정렬: 시술/장비/의료진 > 일반 > 약관/후기)
      const HIGH_KW = ['시술', '치료', '장비', '의료진', '의사', '가격', '비용', '비급여', '이벤트', '프로모션', '진료', 'device', 'staff', 'doctor', 'procedure', 'treatment', 'price'];
      const LOW_KW = ['블로그', '후기', '리뷰', '공지', '뉴스', '오시는길', '오시는 길', '개인정보', '이용약관', '사이트맵', 'sitemap', 'privacy', 'terms', 'notice', 'blog', 'review'];
      const sortedPages = [...pages].sort((a, b) => {
        const aText = (a.url + ' ' + a.markdown.slice(0, 500)).toLowerCase();
        const bText = (b.url + ' ' + b.markdown.slice(0, 500)).toLowerCase();
        const aPri = LOW_KW.some(k => aText.includes(k)) ? 1 : HIGH_KW.some(k => aText.includes(k)) ? 3 : 2;
        const bPri = LOW_KW.some(k => bText.includes(k)) ? 1 : HIGH_KW.some(k => bText.includes(k)) ? 3 : 2;
        return bPri - aPri;
      });
      for (const p of sortedPages) {
        const cleaned = cleanMarkdown(p.markdown);
        if (cleaned.length >= MIN_PAGE_CHARS) {
          allText += `\n\n--- [${p.pageType}] ${p.url} ---\n\n` + cleaned;
        }
      }

      // 각 페이지 스크린샷 OCR (4장씩 배치 병렬 호출)
      let ocrSuccess = 0;
      let ocrEmpty = 0;
      const OCR_BATCH_SIZE = 4;

      // 전체 스크린샷을 flat 배열로 수집
      const allScreenshots: Array<{ buf: Buffer; pageIdx: number; captureIdx: number; pageType: string }> = [];
      for (let j = 0; j < pages.length; j++) {
        const p = pages[j];
        for (let k = 0; k < p.screenshotBuffers.length; k++) {
          allScreenshots.push({ buf: p.screenshotBuffers[k], pageIdx: j, captureIdx: k, pageType: p.pageType });
        }
      }

      const totalOcrBatches = Math.ceil(allScreenshots.length / OCR_BATCH_SIZE);
      for (let obi = 0; obi < allScreenshots.length; obi += OCR_BATCH_SIZE) {
        const ocrBatch = allScreenshots.slice(obi, obi + OCR_BATCH_SIZE);
        const ocrBatchNum = Math.floor(obi / OCR_BATCH_SIZE) + 1;
        console.log(`    [OPTIMIZE] OCR batch ${ocrBatchNum}/${totalOcrBatches} (${ocrBatch.length} images)`);

        const ocrSettled = await Promise.allSettled(
          ocrBatch.map(item => extractTextFromImage(item.buf)),
        );
        geminiCalls += ocrBatch.length;

        for (let ori = 0; ori < ocrBatch.length; ori++) {
          const item = ocrBatch[ori];
          const settled = ocrSettled[ori];
          const source = `page_${item.pageIdx}_${item.pageType}_capture_${item.captureIdx}`;

          if (settled.status === 'fulfilled') {
            const ocrText = settled.value;
            if (ocrText && ocrText !== '텍스트_없음') {
              allText += `\n\n--- [OCR: ${item.pageType}_capture_${item.captureIdx}] ---\n\n` + ocrText;
              ocrResults.push({ source, text: ocrText });
              ocrSuccess++;
            } else {
              ocrResults.push({ source, text: '텍스트_없음' });
              ocrEmpty++;
            }
          } else {
            console.log(`    ⚠️ OCR 실패 [${item.pageType}:${item.captureIdx}]: ${settled.reason}`);
          }
        }

        await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
      }
      console.log(`    OCR 결과: 성공 ${ocrSuccess}장, 텍스트없음 ${ocrEmpty}장`);

      // ── [v5.7] --ocr 모드: 추가 라이브 URL 스크린샷 촬영 ──
      if (ocrMode) {
        const ocrUrls = new Set<string>();
        for (const p of pages) {
          if (p.url && p.url.startsWith('http')) ocrUrls.add(p.url);
        }
        const ocrUrlList = [...ocrUrls];
        const ocrMaxUrls = Math.min(ocrUrlList.length, 10);
        console.log(`\n  📷 [v5.7 OCR] 추가 라이브 스크린샷: ${ocrUrlList.length}개 URL 중 ${ocrMaxUrls}개 촬영`);

        let ocrSsCount = 0;
        for (let oi = 0; oi < ocrMaxUrls; oi++) {
          const ocrUrl = ocrUrlList[oi];
          try {
            const ocrSr = await captureScreenshots(ocrUrl, {
              viewportWidth: 1280, viewportHeight: 800,
              maxScreenshots: 5, timeout: 10000, waitAfterScroll: 400,
            });
            for (const buf of ocrSr.screenshots) {
              playwrightScreenshots.push(buf);
            }
            ocrSsCount += ocrSr.screenshots.length;
            console.log(`    [${oi + 1}/${ocrMaxUrls}] ${new URL(ocrUrl).pathname.slice(0, 40)} → ${ocrSr.screenshots.length}장`);
          } catch (ocrErr) {
            console.log(`    [${oi + 1}/${ocrMaxUrls}] 실패: ${(ocrErr as Error).message.slice(0, 60)}`);
          }
        }
        console.log(`  📷 OCR 추가: ${ocrSsCount}장 (총 ${playwrightScreenshots.length}장, ≈${Math.round(playwrightScreenshots.length * 1290 / 1000)}K 토큰)`);
      }

      // ── [v5.5] 네비게이션 메뉴 텍스트 구성 ──
      const navMenuText = navTreatments.length > 0
        ? navTreatments.map(nt => `- ${nt}`).join('\n')
        : undefined;

      // ── Step 2: 분류 (전체 텍스트 → 7-category 구조화) ──
      const ssForGemini = playwrightScreenshots.length > 0 ? playwrightScreenshots : undefined;
      console.log(`\n  🧠 [v5.5 Step 2] 분류 — 전체 텍스트 구조화 (${allText.length.toLocaleString()}자)${navMenuText ? ` + 네비게이션 ${navTreatments.length}항목` : ''}${ssForGemini ? ` + 스크린샷 ${ssForGemini.length}장` : ''}`);
      try {
        const v54Result = await classifyHospitalData(allText, t.name, 0, navMenuText, ssForGemini);
        geminiCalls += 1;

        // v5.4 → v5 AnalysisResult 변환
        analysis = convertV54ToAnalysis(v54Result);

        const summary54 = v54Result.extraction_summary;
        const devCount = v54Result.medical_devices?.filter(d => d.device_type === 'device').length || 0;
        const injCount = v54Result.medical_devices?.filter(d => d.device_type === 'injectable').length || 0;
        const totalMedDev = v54Result.medical_devices?.length || summary54?.total_equipment || 0;
        console.log(`    Step 2 결과: 의사 ${summary54?.total_doctors || 0} | 학술 ${summary54?.total_academic || 0} | 의료기기 ${totalMedDev} (장비${devCount}+주사${injCount}) | 시술 ${summary54?.total_treatments || 0} | 이벤트 ${summary54?.total_events || 0} | 카테고리 ${summary54?.total_categories || 0}`);
        console.log(`    가격 확보율: ${summary54?.price_available_ratio || 'N/A'}`);

        // [v5.5] 병원명 불일치 감지 (Defect 7) + 위치명 검증 (Defect 6)
        const crawledName = v54Result.hospital_name;
        if (crawledName) {
          const dbName = t.name.replace(/\([^)]*\)/g, '').trim();
          const cName = crawledName.replace(/\([^)]*\)/g, '').trim();
          const nameMatch = dbName === cName || cName.includes(dbName) || dbName.includes(cName);
          if (!nameMatch) {
            console.log(`  ⚠️ [v5.5] 병원명 불일치 감지!`);
            console.log(`    DB 등록명: "${t.name}" → 크롤링 병원명: "${crawledName}"`);
            const addr = v54Result.contact_info?.address?.full_address;
            if (addr) console.log(`    크롤링 주소: ${addr}`);
            console.log(`    → DB URL 확인 필요: ${t.url}`);
          }
        }

        // [v5.5] 위치명 검증 (Defect 6): 주소 기반 region 우선
        resolvedRegion = resolveRegionFromAddress(
          v54Result.contact_info?.address?.full_address,
          v54Result.contact_info?.address?.sido,
          v54Result.contact_info?.address?.sigungu,
          t.region,
          t.url,
        );
        if (resolvedRegion.mismatch) {
          console.log(`  ⚠️ [v5.5] 위치명 불일치: DB="${t.region}" → 주소 기반="${resolvedRegion.region}" (${resolvedRegion.crawledAddress})`);
        }
        if (resolvedRegion.franchise) {
          console.log(`  🏢 [v5.5] 프랜차이즈 감지: ${resolvedRegion.franchise.domain} [${resolvedRegion.franchise.branch}점]`);
        }
        // region을 주소 기반으로 교체 (보고서에 반영)
        t.region = resolvedRegion.region;

        // [v5.5] 연락처 코드 레벨 패턴 매칭 → Gemini 결과 보완
        const codeContacts = extractContactsFromText(allText);
        if (codeContacts.length > 0 && v54Result.contact_info) {
          const merged = mergeContacts(v54Result.contact_info as unknown as Record<string, unknown>, codeContacts);
          // 병합된 결과를 v54에 반영
          for (const key of Object.keys(merged)) {
            (v54Result.contact_info as unknown as Record<string, unknown>)[key] = merged[key];
          }
          // analysis._v54도 업데이트
          if (analysis._v54) analysis._v54.contact_info = v54Result.contact_info;
        }

        // contact_info 로그
        if (v54Result.contact_info) {
          const ci = v54Result.contact_info;
          const channels = [
            ci.email?.length ? `이메일 ${ci.email.length}` : null,
            ci.phone?.length ? `전화 ${ci.phone.length}` : null,
            ci.kakao_channel ? '카카오' : null,
            ci.instagram ? '인스타' : null,
            ci.facebook ? '페이스북' : null,
            ci.youtube ? '유튜브' : null,
            ci.blog ? '블로그' : null,
            ci.naver_booking ? '네이버예약' : null,
          ].filter(Boolean);
          console.log(`    📞 연락처: ${channels.join(', ') || '없음'}`);
          if (codeContacts.length > 0) {
            const codeOnly = codeContacts.filter(c => !['phone', 'email'].includes(c.type));
            if (codeOnly.length > 0) console.log(`    📞 [v5.5] 코드 패턴 매칭 보완: ${codeOnly.map(c => c.type).join(', ')}`);
          }
        }

        // analysis_method 업데이트
        await supabase.from('scv_crawl_pages')
          .update({ analysis_method: 'v5.4_2step', gemini_analyzed: true })
          .eq('hospital_id', hospitalId);
      } catch (err) {
        console.log(`    ❌ Step 2 분류 실패: ${err}`);
        console.log(`    ⚠️ fallback → 기존 per-page 분석`);

        // fallback: 기존 per-page 분석
        const allPageResults: AnalysisResult[] = [];
        for (let j = 0; j < pages.length; j++) {
          const p = pages[j];
          const { result, method, geminiCalls: calls } = await analyzePage(t.name, p);
          allPageResults.push(result);
          geminiCalls += calls;
          await supabase.from('scv_crawl_pages')
            .update({ analysis_method: method }).eq('hospital_id', hospitalId).eq('url', p.url);
          if (j < pages.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
        }
        analysis = mergeAndDeduplicate(allPageResults);
      }
    } else {
      analysis = { equipments: [], treatments: [], doctors: [], events: [] };
    }

    // 네비게이션 시술 링크 → 시술/장비 목록 보강 (Gemini 호출 없이)
    if (navTreatments.length > 0) {
      const existingTreatNames = new Set(analysis.treatments.map(t2 => t2.name.toLowerCase()));
      let navAdded = 0;
      for (const navT of navTreatments) {
        if (!existingTreatNames.has(navT.toLowerCase())) {
          analysis.treatments.push({
            name: navT, category: 'other', price: null,
            price_note: null, is_promoted: false, combo_with: null,
          });
          existingTreatNames.add(navT.toLowerCase());
          navAdded++;
        }
      }
      if (navAdded > 0) {
        console.log(`  📋 네비게이션에서 시술 ${navAdded}개 추가`);
      }
      // 네비게이션 시술 링크에서 장비명도 추출
      const _v54Backup = analysis._v54;
      analysis = mergeAndDeduplicate([analysis]);  // 장비 정규화 재실행
      if (_v54Backup) analysis._v54 = _v54Backup;
    }

    console.log(`  📊 병합 결과: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length}`);

    // [v5.1] 카드+모달 자동 감지 → Puppeteer 의사 상세 보강
    if (!skipGemini && analysis.doctors.length > 0 && needsModalCrawl(analysis.doctors)) {
      const doctorPages = pages.filter(p => p.pageType === 'doctor');
      const targetPage = doctorPages.length > 0 ? doctorPages[0] : pages[0];
      console.log(`\n  ⚠️ 의사 ${analysis.doctors.length}명 중 경력/학력 비율 30% 미만 → 카드+모달 보강`);

      const modalResult = await crawlDoctorModals(targetPage.url, hospitalId);
      if (modalResult.success && modalResult.captures.length > 0) {
        // 각 모달 스크린샷을 Vision 분석하여 의사 데이터 보강
        const modalPrompt = buildExtractionPrompt(t.name, 'doctor_modal', '이미지');
        for (const cap of modalResult.captures) {
          try {
            const visionResult = await callGemini(modalPrompt, { type: 'images', buffers: [cap.buffer] });
            geminiCalls += 1;
            // 모달에서 추출된 의사 정보로 기존 데이터 보강
            if (visionResult.doctors && visionResult.doctors.length > 0) {
              for (const modalDr of visionResult.doctors) {
                const existing = analysis.doctors.find(d =>
                  d.name === modalDr.name || cap.doctorName.includes(d.name) || d.name.includes(cap.doctorName)
                );
                if (existing) {
                  if (modalDr.education && !existing.education) existing.education = modalDr.education;
                  if (modalDr.career && !existing.career) existing.career = modalDr.career;
                  if (modalDr.academic_activity && !existing.academic_activity) existing.academic_activity = modalDr.academic_activity;
                  if (modalDr.specialty && !existing.specialty) existing.specialty = modalDr.specialty;
                  if (cap.photoUrl && !existing.photo_url) existing.photo_url = cap.photoUrl;
                } else {
                  analysis.doctors.push({ ...modalDr, photo_url: cap.photoUrl || null });
                }
              }
            } else if (cap.photoUrl) {
              // Vision 분석 결과가 없어도 이름 매칭으로 사진 연결
              const existing = analysis.doctors.find(d =>
                cap.doctorName.includes(d.name) || d.name.includes(cap.doctorName)
              );
              if (existing && !existing.photo_url) existing.photo_url = cap.photoUrl;
            }
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
          } catch (err) {
            console.log(`    ⚠️ 모달 Vision 분석 실패: ${err}`);
          }
        }

        const withDetail = analysis.doctors.filter(d => d.education || d.career).length;
        console.log(`  📊 모달 보강 후: 의사 ${analysis.doctors.length}명 (경력/학력 ${withDetail}명, ${Math.round(withDetail / analysis.doctors.length * 100)}%)`);
      } else {
        console.log(`  ⚠️ 모달 크롤링 ${modalResult.reason || 'failed'} → 의사 상세 부분 누락 가능`);
      }
    }

    // ═══════════════════════════════════════════
    // [v5.8] 프로필 사진 없는 의사 → 페이지에서 직접 추출
    // ═══════════════════════════════════════════
    if (analysis.doctors.length > 0) {
      const doctorsWithoutPhoto = analysis.doctors.filter(d => !d.photo_url);
      if (doctorsWithoutPhoto.length > 0) {
        const doctorPages = pages.filter(p => p.pageType === 'doctor');
        const targetPage = doctorPages.length > 0 ? doctorPages[0] : pages[0];
        try {
          const photoResults = await extractDoctorPhotosFromPage(
            targetPage.url, hospitalId,
            doctorsWithoutPhoto.map(d => d.name),
          );
          for (const pr of photoResults) {
            if (!pr.photoUrl) continue;
            const dr = analysis.doctors.find(d => d.name === pr.doctorName);
            if (dr && !dr.photo_url) dr.photo_url = pr.photoUrl;
          }
        } catch (err) {
          console.log(`    ⚠️ 의사 프로필 사진 직접 추출 실패: ${(err as Error).message}`);
        }
      }
    }

    // ═══════════════════════════════════════════
    // [v5.4] 의사 이름 웹 검증
    // ═══════════════════════════════════════════
    if (!skipGemini && analysis.doctors.length > 0) {
      await verifyDoctorNames(analysis.doctors, t.name);
    }

    // ═══════════════════════════════════════════
    // [v5.6] 의사 필드 정규화 (career/education/academic 재분류)
    // ═══════════════════════════════════════════
    if (analysis.doctors.length > 0) {
      console.log(`  🔄 [v5.6] 의사 필드 정규화 (${analysis.doctors.length}명)...`);
      normalizeDoctorsBatch(analysis.doctors);
    }

    // ═══════════════════════════════════════════
    // [v5.6] 의사 데이터 웹 보강
    // ═══════════════════════════════════════════
    if (!skipGemini && analysis.doctors.length > 0) {
      const { enrichedNames } = await enrichDoctorBatch(analysis.doctors, t.name, hospitalId);
      if (enrichedNames.length > 0) {
        console.log(`  ✅ [v5.6] 웹 보강 완료: ${enrichedNames.join(', ')}`);
      }
    }

    // ═══════════════════════════════════════════
    // [v5.5] TORR RF 전용 감지 (Gemini 독립)
    // ═══════════════════════════════════════════
    const allTextForTorr = pages.map(p => p.markdown).join('\n\n') +
      (ocrResults.length > 0 ? '\n\n' + ocrResults.map(o => o.text).join('\n\n') : '');
    const torrResult = detectTorrRf(allTextForTorr, pages.map(p => ({
      url: p.url, markdown: p.markdown, pageType: p.pageType,
    })));
    if (torrResult.detected) {
      console.log(`  🔴 [v5.5] TORR RF 보유 감지! (${torrResult.confidence}) — ${torrResult.products_found.join(', ')}`);
      for (const e of torrResult.evidence.slice(0, 5)) {
        console.log(`    - "${e.keyword}" [${e.source}]${e.url ? ' → ' + e.url : ''}`);
      }
    } else {
      console.log(`  ✅ [v5.5] TORR RF 미보유 (텍스트+네비+URL 스캔 완료)`);
    }

    // ═══════════════════════════════════════════
    // [v5.4] SUFFICIENT에서도 팝업 이미지 OCR + 장비 0개 배너 재캡처
    // ═══════════════════════════════════════════
    if (!skipGemini) {
      // 팝업 이미지 OCR (이벤트 정보 보완)
      const allMdForPopup = pages.map(p => p.markdown).join('\n\n');
      const popupImageRegex = /(?:!\[[^\]]*pop[^\]]*\]\(([^)]+)\))|(?:src=["']([^"']*pop[^"']*\.(?:jpg|jpeg|png|gif|webp))["'])/gi;
      const popupUrls: string[] = [];
      let popupMatch;
      while ((popupMatch = popupImageRegex.exec(allMdForPopup)) !== null) {
        const url = popupMatch[1] || popupMatch[2];
        if (url) try { popupUrls.push(new URL(url, t.url).href); } catch { /* ignore */ }
      }

      if (popupUrls.length > 0) {
        console.log(`  🎪 [v5.4] 팝업 이미지 ${popupUrls.length}개 OCR 시도`);
        for (let pi = 0; pi < Math.min(popupUrls.length, 5); pi++) {
          try {
            const buf = await downloadScreenshotUrl(popupUrls[pi]);
            if (buf && buf.length > 5000) {
              const ocrText = await extractTextFromImage(buf);
              geminiCalls += 1;
              if (ocrText && ocrText !== '텍스트_없음') {
                ocrResults.push({ source: `popup_image_${pi}`, text: ocrText });
                console.log(`    ✅ 팝업 OCR [${pi}]: ${ocrText.substring(0, 80)}...`);
              }
            }
          } catch { /* ignore */ }
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
        }
      }

      // 장비 0개 → 배너 슬라이드 재캡처 + 2-step OCR→분류
      if (analysis.equipments.length === 0) {
        console.log(`  🔧 [v5.4] 장비 0개 → 메인 배너 재캡처 시도`);
        const sliderResult = await captureSliderImages(t.url, hospitalId);
        if (sliderResult.buffers.length > 0) {
          const bannerTexts: string[] = [];
          for (let bi = 0; bi < sliderResult.buffers.length; bi++) {
            try {
              const ocrText = await extractTextFromImage(sliderResult.buffers[bi]);
              geminiCalls += 1;
              if (ocrText && ocrText !== '텍스트_없음') {
                bannerTexts.push(ocrText);
                ocrResults.push({ source: `banner_recapture_${bi}`, text: ocrText });
              }
            } catch { geminiCalls += 1; }
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_GEMINI));
          }
          if (bannerTexts.length > 0) {
            // 2-step: OCR 텍스트를 classifyHospitalData로 재분류 (장비만 추출)
            try {
              const bannerV54 = await classifyHospitalData(bannerTexts.join('\n\n'), t.name);
              geminiCalls += 1;
              if (bannerV54.equipment?.length > 0) {
                const bannerEquips = bannerV54.equipment.map(e => ({
                  name: e.brand && e.model ? `${e.brand} ${e.model}` : (e.brand || e.model || e.name || 'Unknown'),
                  category: e.category === 'RF' ? 'rf' : e.category === '레이저' ? 'laser' : e.category === '초음파' ? 'hifu' : 'other',
                  manufacturer: e.manufacturer || null,
                }));
                analysis.equipments.push(...bannerEquips);
                const _v54b2 = analysis._v54;
                analysis = mergeAndDeduplicate([analysis]);
                if (_v54b2) analysis._v54 = _v54b2;
                console.log(`    ✅ 배너에서 장비 ${bannerEquips.length}개 추가 (2-step)`);
              }
            } catch { geminiCalls += 1; }
          }
        }
      }
    }

    // ═══════════════════════════════════════════
    // [v5.4] OCR raw text 저장
    // ═══════════════════════════════════════════
    if (ocrResults.length > 0 || analysis._v54) {
      const ocrOutputDir = path.resolve(__dirname, '..', 'output');
      if (!fs.existsSync(ocrOutputDir)) fs.mkdirSync(ocrOutputDir, { recursive: true });

      // OCR raw 저장
      if (ocrResults.length > 0) {
        const ocrPath = path.resolve(ocrOutputDir, `${hospitalId}_ocr_raw.json`);
        fs.writeFileSync(ocrPath, JSON.stringify(ocrResults, null, 2));
        console.log(`  📝 [v5.4] OCR raw 저장: ${ocrPath}`);
      }

      // v5.4 분류 결과 JSON 저장
      if (analysis._v54) {
        const analysisPath = path.resolve(ocrOutputDir, `${hospitalId}_analysis.json`);
        fs.writeFileSync(analysisPath, JSON.stringify(analysis._v54, null, 2));
        console.log(`  📝 [v5.4] 분류 결과 저장: ${analysisPath}`);
      }

      // contact_info DB 저장 (hospitals 테이블 phone/email 업데이트)
      if (analysis._v54?.contact_info) {
        const ci = analysis._v54.contact_info;
        const updateData: Record<string, unknown> = {};
        if (ci.phone?.[0]?.number) updateData.phone = ci.phone[0].number;
        if (ci.email?.[0]?.address) updateData.email = ci.email[0].address;
        if (Object.keys(updateData).length > 0) {
          await supabase.from('hospitals').update(updateData).eq('id', hospitalId);
          console.log(`  📞 [v5.4] 연락처 DB 업데이트: ${Object.keys(updateData).join(', ')}`);
        }
      }
    }

    // ═══════════════════════════════════════════
    // v5.2 2단계 검증
    // ═══════════════════════════════════════════
    let coverageOverall = 0;
    let status = 'pass';

    if (!skipGemini) {
      // ──────────────────────────────────
      // [1단계] Sanity Check (최소 기대치)
      // ──────────────────────────────────
      console.log(`\n  ═══ ${t.name} — v5.4 검증 결과 ═══`);
      console.log(`\n  [1단계: 최소 기대치]`);

      const sanity = checkSanity(analysis, pages);
      for (const d of sanity.details) console.log(`    ${d}`);

      if (!sanity.sufficient) {
        console.log(`    판정: ❌ INSUFFICIENT → 보강 크롤 시도`);

        const supplement = await supplementaryCrawl(t.url, hospitalId, t.name, sanity.missingTypes);
        credits += supplement.credits;
        geminiCalls += supplement.geminiCalls;

        if (supplement.analyses.length > 0) {
          // 보강 분석 결과를 기존에 병합
          const _v54b3 = analysis._v54;
          analysis = mergeAndDeduplicate([analysis, ...supplement.analyses]);
          if (_v54b3) analysis._v54 = _v54b3;
          pages.push(...supplement.pages);
          console.log(`    보강 후: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length}`);

          // 재검증
          const sanity2 = checkSanity(analysis, pages);
          for (const d of sanity2.details) console.log(`    ${d}`);

          if (!sanity2.sufficient) {
            // [v5.3] 원페이지 사이트 감지 → 이미지 강화 파이프라인
            if (isOnePageSite(pages)) {
              console.log(`    🖼️ 원페이지 사이트 감지 → v5.3 이미지 강화 시도`);
              const enhancement = await onePageImageEnhancement(hospitalId, t.name, t.url, pages, analysis);
              geminiCalls += enhancement.geminiCalls;

              if (enhancement.enhanced) {
                const _v54b4 = analysis._v54;
                analysis = mergeAndDeduplicate([analysis]);
                if (_v54b4) analysis._v54 = _v54b4;
                const sanity3 = checkSanity(analysis, pages);
                console.log(`    [v5.3 재검증]`);
                for (const d of sanity3.details) console.log(`      ${d}`);

                if (sanity3.sufficient) {
                  console.log(`    판정: ✅ v5.3 이미지 강화 후 SUFFICIENT`);
                  // SUFFICIENT → 2단계 커버리지 검증으로 계속 진행
                } else {
                  console.log(`    판정: ❌ v5.3 이미지 강화 후에도 INSUFFICIENT → manual_review`);
                  status = 'insufficient';
                  coverageOverall = 0;

                  await supabase.from('scv_crawl_validations').upsert({
                    hospital_id: hospitalId,
                    crawl_version: 'v5.4',
                    status: 'insufficient',
                    validation_result: {
                      stage: 'onepage_image_enhancement',
                      reason: sanity3.details.join('; '),
                      supplementary_tried: sanity.missingTypes,
                      supplementary_found: supplement.pages.length,
                      onepage_enhanced: true,
                    },
                    validated_at: new Date().toISOString(),
                  }, { onConflict: 'hospital_id,crawl_version' });

                  await saveAnalysis(hospitalId, analysis, t.url);
                  console.log(`  💾 저장 완료 (insufficient + v5.3 이미지 강화)`);
                  console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

                  totalGeminiCalls += geminiCalls;
                  summary.push({
                    no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
                    equip: analysis.equipments.length, treat: analysis.treatments.length,
                    doctors: analysis.doctors.length, events: analysis.events.length,
                    coverage: coverageOverall, status, v4: v4Counts,
                  });
                  await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
                  continue;
                }
              } else {
                // 이미지 강화 효과 없음 → insufficient 유지
                console.log(`    판정: ❌ 보강 후에도 INSUFFICIENT (이미지 강화 효과 없음) → manual_review`);
                status = 'insufficient';
                coverageOverall = 0;

                await supabase.from('scv_crawl_validations').upsert({
                  hospital_id: hospitalId,
                  crawl_version: 'v5.4',
                  status: 'insufficient',
                  validation_result: {
                    stage: 'onepage_image_enhancement',
                    reason: sanity2.details.join('; '),
                    supplementary_tried: sanity.missingTypes,
                    onepage_enhanced: false,
                  },
                  validated_at: new Date().toISOString(),
                }, { onConflict: 'hospital_id,crawl_version' });

                await saveAnalysis(hospitalId, analysis, t.url);
                console.log(`  💾 저장 완료 (insufficient)`);
                console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

                totalGeminiCalls += geminiCalls;
                summary.push({
                  no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
                  equip: analysis.equipments.length, treat: analysis.treatments.length,
                  doctors: analysis.doctors.length, events: analysis.events.length,
                  coverage: coverageOverall, status, v4: v4Counts,
                });
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
                continue;
              }
            } else {
              // 원페이지가 아닌데 INSUFFICIENT → 기존 로직
              console.log(`    판정: ❌ 보강 후에도 INSUFFICIENT → manual_review`);
              status = 'insufficient';
              coverageOverall = 0;

              await supabase.from('scv_crawl_validations').upsert({
                hospital_id: hospitalId,
                crawl_version: 'v5.4',
                status: 'insufficient',
                validation_result: {
                  stage: 'sanity_check',
                  reason: sanity2.details.join('; '),
                  supplementary_tried: sanity.missingTypes,
                  supplementary_found: supplement.pages.length,
                },
                validated_at: new Date().toISOString(),
              }, { onConflict: 'hospital_id,crawl_version' });

              await saveAnalysis(hospitalId, analysis, t.url);
              console.log(`  💾 저장 완료 (insufficient)`);
              console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

              totalGeminiCalls += geminiCalls;
              summary.push({
                no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
                equip: analysis.equipments.length, treat: analysis.treatments.length,
                doctors: analysis.doctors.length, events: analysis.events.length,
                coverage: coverageOverall, status, v4: v4Counts,
              });
              await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
              continue;
            }
          }
          console.log(`    판정: ✅ 보강 후 SUFFICIENT`);
        } else {
          // 보강 크롤 유효 페이지 없음
          // [v5.3] 원페이지 사이트인 경우 이미지 강화 시도
          if (isOnePageSite(pages)) {
            console.log(`    보강 크롤: 유효 페이지 없음 — 원페이지 사이트 감지 → v5.3 이미지 강화`);
            const enhancement = await onePageImageEnhancement(hospitalId, t.name, t.url, pages, analysis);
            geminiCalls += enhancement.geminiCalls;

            if (enhancement.enhanced) {
              const _v54b5 = analysis._v54;
              analysis = mergeAndDeduplicate([analysis]);
              if (_v54b5) analysis._v54 = _v54b5;
              const sanity3 = checkSanity(analysis, pages);
              console.log(`    [v5.3 재검증]`);
              for (const d of sanity3.details) console.log(`      ${d}`);

              if (sanity3.sufficient) {
                console.log(`    판정: ✅ v5.3 이미지 강화 후 SUFFICIENT`);
                // SUFFICIENT → 2단계 커버리지 검증으로 계속 진행
              } else {
                console.log(`    판정: ❌ v5.3 이미지 강화 후에도 INSUFFICIENT → manual_review`);
                status = 'insufficient';
                coverageOverall = 0;

                await supabase.from('scv_crawl_validations').upsert({
                  hospital_id: hospitalId,
                  crawl_version: 'v5.4',
                  status: 'insufficient',
                  validation_result: {
                    stage: 'onepage_no_supplement',
                    reason: sanity3.details.join('; '),
                    supplementary_tried: sanity.missingTypes,
                    onepage_enhanced: true,
                  },
                  validated_at: new Date().toISOString(),
                }, { onConflict: 'hospital_id,crawl_version' });

                await saveAnalysis(hospitalId, analysis, t.url);
                console.log(`  💾 저장 완료 (insufficient + v5.3)`);
                console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

                totalGeminiCalls += geminiCalls;
                summary.push({
                  no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
                  equip: analysis.equipments.length, treat: analysis.treatments.length,
                  doctors: analysis.doctors.length, events: analysis.events.length,
                  coverage: coverageOverall, status, v4: v4Counts,
                });
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
                continue;
              }
            } else {
              // 이미지 강화 효과 없음 → insufficient
              status = 'insufficient';
              coverageOverall = 0;

              await supabase.from('scv_crawl_validations').upsert({
                hospital_id: hospitalId,
                crawl_version: 'v5.4',
                status: 'insufficient',
                validation_result: {
                  stage: 'onepage_no_supplement',
                  reason: sanity.details.join('; '),
                  supplementary_tried: sanity.missingTypes,
                  onepage_enhanced: false,
                },
                validated_at: new Date().toISOString(),
              }, { onConflict: 'hospital_id,crawl_version' });

              await saveAnalysis(hospitalId, analysis, t.url);
              console.log(`  💾 저장 완료 (insufficient)`);
              console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

              totalGeminiCalls += geminiCalls;
              summary.push({
                no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
                equip: analysis.equipments.length, treat: analysis.treatments.length,
                doctors: analysis.doctors.length, events: analysis.events.length,
                coverage: coverageOverall, status, v4: v4Counts,
              });
              await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
              continue;
            }
          } else {
            // 원페이지 아닌 경우 기존 로직
            console.log(`    보강 크롤: 유효 페이지 없음 → manual_review`);
            status = 'insufficient';
            coverageOverall = 0;

            await supabase.from('scv_crawl_validations').upsert({
              hospital_id: hospitalId,
              crawl_version: 'v5.4',
              status: 'insufficient',
              validation_result: {
                stage: 'sanity_check',
                reason: sanity.details.join('; '),
                supplementary_tried: sanity.missingTypes,
                supplementary_found: 0,
              },
              validated_at: new Date().toISOString(),
            }, { onConflict: 'hospital_id,crawl_version' });

            await saveAnalysis(hospitalId, analysis, t.url);
            console.log(`  💾 저장 완료 (insufficient)`);
            console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);

            totalGeminiCalls += geminiCalls;
            summary.push({
              no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
              equip: analysis.equipments.length, treat: analysis.treatments.length,
              doctors: analysis.doctors.length, events: analysis.events.length,
              coverage: coverageOverall, status, v4: v4Counts,
            });
            await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
            continue;
          }
        }
      } else {
        console.log(`    판정: ✅ SUFFICIENT`);
      }

      // ──────────────────────────────────
      // [2단계] 커버리지 검증 (기존 로직)
      // ──────────────────────────────────
      console.log(`\n  [2단계: 커버리지]`);
      const allMd = pages.map(p => p.markdown).join('\n\n---\n\n');
      const resolvedSiteType = classifySiteType(siteFingerprint, t.url);
      const validation = await validateCoverage(hospitalId, t.name, analysis, allMd, resolvedSiteType);
      coverageOverall = validation.coverage_score?.overall || 0;
      status = validation._status || 'error';
      geminiCalls += 1;

      console.log(`    장비: ${validation.coverage_score?.equipment || 0}%${validation.missing_equipments?.length ? ` — 누락: ${validation.missing_equipments.join(', ')}` : ''}`);
      console.log(`    시술: ${validation.coverage_score?.treatment || 0}%${validation.missing_treatments?.length ? ` — 누락 상위: ${validation.missing_treatments.slice(0, 10).join(', ')}` : ''}`);
      console.log(`    의사: ${validation.coverage_score?.doctor || 0}%${validation.missing_doctors?.length ? ` — 누락: ${validation.missing_doctors.join(', ')}` : ''}`);
      console.log(`    전체: ${coverageOverall}% → ${status === 'pass' ? '✅ PASS' : status === 'partial' ? '⚠️ PARTIAL' : '❌ FAIL'}`);

      // 커버리지 70% 미만 → 재분석 (기존: >=50, 변경: >=20 — 이미지 기반 사이트 대응)
      if (coverageOverall < 70 && coverageOverall >= 20) {
        const reanalysis = await reanalyzeWithHints(t.name, allMd, validation);
        geminiCalls += splitIntoChunks(cleanMarkdown(allMd)).length;

        const combined: AnalysisResult[] = [analysis, reanalysis];
        const _v54b6 = analysis._v54;
        analysis = mergeAndDeduplicate(combined);
        if (_v54b6) analysis._v54 = _v54b6;
        console.log(`    🔄 재분석 후: 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length}`);

        const reValidation = await validateCoverage(hospitalId, t.name, analysis, allMd, resolvedSiteType);
        coverageOverall = reValidation.coverage_score?.overall || coverageOverall;
        status = reValidation._status || status;
        geminiCalls += 1;
        console.log(`    🔄 재검증: ${coverageOverall}% → ${status === 'pass' ? '✅ PASS' : status === 'partial' ? '⚠️ PARTIAL' : '❌ FAIL'}`);
      }

      if (coverageOverall < 20) {
        status = 'manual_review';
        console.log(`    🚩 manual_review 플래그 설정`);
        await supabase.from('scv_crawl_validations')
          .update({ status: 'manual_review' }).eq('hospital_id', hospitalId).eq('crawl_version', 'v5.3');
      }

      // DB 저장
      await saveAnalysis(hospitalId, analysis, t.url);
      console.log(`  💾 저장 완료`);

      // v4 대비
      console.log(`\n  [v4 대비] 장비: ${v4Counts.equip}→${analysis.equipments.length} | 시술: ${v4Counts.treat}→${analysis.treatments.length} | 의사: ${v4Counts.doctors}→${analysis.doctors.length} | 이벤트: ${v4Counts.events}→${analysis.events.length}`);
    }

    // [v5.5] 보고서 생성
    if (!skipGemini) {
      try {
        await generateReport({
          hospitalId, hospitalName: t.name, hospitalNo: t.no, region: t.region, url: t.url,
          pages, analysis, ocrResults, geminiCalls, credits,
          coverageOverall, status, v4Counts,
          elapsedMs: Date.now() - hospitalStartTime,
          torrResult,
          resolvedRegion,
        });
      } catch (err) {
        console.log(`  ⚠️ 보고서 생성 실패: ${err}`);
      }
    }

    totalGeminiCalls += geminiCalls;
    const hospitalElapsedMs = Date.now() - hospitalStartTime;
    summary.push({
      no: t.no, name: t.name, pages: pages.length, credits, geminiCalls,
      equip: analysis.equipments.length, treat: analysis.treatments.length,
      doctors: analysis.doctors.length, events: analysis.events.length,
      coverage: coverageOverall, status, v4: v4Counts, elapsedMs: hospitalElapsedMs,
      siteType: classifySiteType(siteFingerprint, t.url),
    });

    // [v5.6] 성공 시 연속 에러 카운터 리셋
    if (status !== 'error') {
      consecutiveErrors = 0;
    } else {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n🛑 연속 ${MAX_CONSECUTIVE_ERRORS}회 에러 — 자동 중단`);
        break;
      }
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));

    // [v5.8] 병원 단위 try-catch 닫기
    } catch (hospitalErr) {
      const errMsg = hospitalErr instanceof Error ? hospitalErr.message : String(hospitalErr);
      console.error(`  💥 [v5.8] 병원 처리 중 예외 발생 (다음 병원으로 계속): ${errMsg.slice(0, 200)}`);
      consecutiveErrors++;
      summary.push({
        no: t.no, name: t.name, pages: 0, credits: 0, geminiCalls: 0,
        equip: 0, treat: 0, doctors: 0, events: 0, coverage: 0, status: 'error',
        v4: { equip: 0, treat: 0, doctors: 0, events: 0 },
        error: errMsg.slice(0, 100), elapsedMs: Date.now() - hospitalStartTime,
      });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n🛑 연속 ${MAX_CONSECUTIVE_ERRORS}회 에러 — 자동 중단`);
        break;
      }
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
    }
  }

  // Playwright/Puppeteer 브라우저 정리
  try { await closePlaywright(); } catch { /* ignore */ }

  // [v5.6] 결과 저장 (기존 + 타임스탬프 버전)
  const outputPath = path.resolve(__dirname, 'data', 'recrawl-v5-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // [v5.7] site_type별 사전 집계 (JSON 저장 + 종합 보고 공용)
  const siteTypeBreakdown: Record<string, { count: number; totalCoverage: number; names: string[] }> = {};
  for (const s of summary) {
    const st = s.siteType || 'website';
    if (!siteTypeBreakdown[st]) siteTypeBreakdown[st] = { count: 0, totalCoverage: 0, names: [] };
    siteTypeBreakdown[st].count++;
    siteTypeBreakdown[st].totalCoverage += s.coverage;
    if (st !== 'website') siteTypeBreakdown[st].names.push(`${s.name}(${s.coverage}%)`);
  }

  const summaryPath = path.join(LOG_DIR, `run_${ts}_summary.json`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const stBreakdown: Record<string, { count: number; avg_score: number }> = {};
  for (const [st, info] of Object.entries(siteTypeBreakdown)) {
    stBreakdown[st] = { count: info.count, avg_score: info.count > 0 ? Math.round(info.totalCoverage / info.count) : 0 };
  }
  const summaryWithMeta = { hospitals: summary, site_type_breakdown: stBreakdown };
  fs.writeFileSync(summaryPath, JSON.stringify(summaryWithMeta, null, 2), 'utf8');

  // ═══════════════════════════════════════════════════
  // [v5.6] 종합 보고 (강화)
  // ═══════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  v5.6 종합 결과');
  console.log('═══════════════════════════════════════════════════\n');

  // 상태별 분류
  const passCount = summary.filter(s => s.status === 'pass').length;
  const partialCount = summary.filter(s => s.status === 'partial').length;
  const insuffCount = summary.filter(s => s.status === 'insufficient').length;
  const manualCount = summary.filter(s => s.status === 'manual_review').length;
  const failCount = summary.filter(s => s.status === 'fail').length;
  const errorCount = summary.filter(s => s.status === 'error').length;

  console.log(`📊 처리: ${summary.length}개 병원${skippedCount > 0 ? ` (+ ${skippedCount}개 스킵)` : ''}`);
  console.log(`   ✅ PASS: ${passCount}개 | ⚠️ PARTIAL: ${partialCount}개 | 🔸 INSUFFICIENT: ${insuffCount}개`);
  console.log(`   🚩 manual_review: ${manualCount}개 | ❌ FAIL: ${failCount}개 | 💥 ERROR: ${errorCount}개`);

  // 테이블
  console.log('\n| 병원 | 의료기기 | 시술 | 의사 | 이벤트 | 커버리지 | 소요 | 판정 |');
  console.log('|------|---------|------|------|--------|----------|------|------|');
  for (const s of summary) {
    const statusIcon = s.status === 'pass' ? '✅' : s.status === 'partial' ? '⚠️' :
      s.status === 'insufficient' ? '🔸' : s.status === 'manual_review' ? '🚩' : '❌';
    const elapsed = `${Math.floor(s.elapsedMs / 60000)}m${Math.round((s.elapsedMs % 60000) / 1000)}s`;
    console.log(`| ${s.name} | ${s.equip} | ${s.treat} | ${s.doctors} | ${s.events} | ${s.coverage}% | ${elapsed} | ${statusIcon} ${s.status} |`);
  }

  // 집계
  const totals = summary.reduce((a, s) => ({
    equip: a.equip + s.equip, treat: a.treat + s.treat,
    doctors: a.doctors + s.doctors, events: a.events + s.events,
  }), { equip: 0, treat: 0, doctors: 0, events: 0 });

  console.log(`\n📈 총합: 의료기기 ${totals.equip} | 시술 ${totals.treat} | 의사 ${totals.doctors} | 이벤트 ${totals.events}`);
  console.log(`💰 크레딧: Firecrawl ${totalCredits} | Gemini ${totalGeminiCalls}회`);

  // [v5.6] 병원당 소요 시간 통계
  const times = summary.map(s => s.elapsedMs).filter(t => t > 0);
  if (times.length > 0) {
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const avgT = times.reduce((a, b) => a + b, 0) / times.length;
    const totalT = times.reduce((a, b) => a + b, 0);
    const fmt = (ms: number): string => `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`;
    console.log(`\n⏱️ 소요 시간: 최소 ${fmt(minT)} / 최대 ${fmt(maxT)} / 평균 ${fmt(avgT)} / 총 ${fmt(totalT)}`);
  }

  // [v5.6] 에러/실패 병원 상세
  const errorHospitals = summary.filter(s => s.status === 'error' || s.status === 'fail' || s.status === 'manual_review');
  if (errorHospitals.length > 0) {
    console.log('\n🔴 에러/실패/manual_review 병원:');
    for (const e of errorHospitals) {
      const statusIcon = e.status === 'error' ? '💥' : e.status === 'fail' ? '❌' : '🚩';
      console.log(`  ${statusIcon} ${e.name}: ${e.status}${e.error ? ` — ${e.error}` : ''} (커버리지: ${e.coverage}%)`);
    }
  }

  // 최종 판정
  if (passCount === summary.length) {
    console.log(`\n✅ 전체 PASS — 승인 요청 가능`);
  } else if (passCount + partialCount === summary.length) {
    console.log(`\n⚠️ 전체 PASS+PARTIAL — 수동 검토 후 승인 가능`);
  } else {
    console.log(`\n⚠️ FAIL/ERROR 있음 — 원인 분석 + 수정 후 재테스트 필요`);
  }

  // [v5.7] site_type별 집계 (siteTypeBreakdown은 위에서 이미 계산됨)
  console.log('\n📊 사이트 유형별 집계:');
  for (const [st, info] of Object.entries(siteTypeBreakdown).sort((a, b) => b[1].count - a[1].count)) {
    const avg = info.count > 0 ? Math.round(info.totalCoverage / info.count) : 0;
    const label = st === 'website' ? '일반 홈페이지' : st === 'naver_blog' ? '네이버 블로그' : '기타 블로그';
    console.log(`  ${label}: ${info.count}개 (평균 ${avg}%)`);
    if (st !== 'website' && info.names.length > 0) {
      console.log(`    └ ${info.names.join(', ')}`);
    }
  }

  console.log(`\n📝 로그: ${logPath}`);
  console.log(`📄 요약: ${summaryPath}`);
  closeLogger();
}

// ============================================================
// --mode=analyze: scv_crawl_pages에서 읽어 Phase 2만 실행
// ============================================================
async function runAnalyzeMode(args: string[]): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Recrawl v5.5 — ANALYZE MODE (Phase 2 only)');
  console.log('  데이터 소스: scv_crawl_pages (madmedscv)');
  console.log('═══════════════════════════════════════════════════\n');

  const dryRun = args.includes('--dry-run');
  const nameIdx = args.indexOf('--name');
  const nameFilter = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
  const hidIdx = args.indexOf('--hospital-id');
  const hospitalIdFilter = hidIdx >= 0 ? args[hidIdx + 1] : undefined;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;

  // 1. 병원 목록 확보 (--hospital-id 또는 --name 필터)
  let targets: Array<{ id: string; name: string; website: string | null }>;
  if (hospitalIdFilter) {
    const { data: hosps, error: hErr } = await supabase
      .from('hospitals')
      .select('id, name, website')
      .eq('id', hospitalIdFilter);
    if (hErr || !hosps || hosps.length === 0) {
      console.error('❌ hospitals에서 id=' + hospitalIdFilter + ' 매칭 없음:', hErr?.message || '');
      return;
    }
    targets = hosps;
  } else if (nameFilter) {
    const { data: hosps, error: hErr } = await supabase
      .from('hospitals')
      .select('id, name, website')
      .ilike('name', `%${nameFilter}%`);
    if (hErr || !hosps || hosps.length === 0) {
      console.error('❌ hospitals에서 "' + nameFilter + '" 매칭 없음:', hErr?.message || '');
      return;
    }
    targets = hosps.slice(0, limit);
  } else {
    // 이름 필터 없으면 scv_crawl_pages에 데이터 있는 병원만
    const { data: distinctPages, error: dpErr } = await supabase
      .from('scv_crawl_pages')
      .select('hospital_id');
    if (dpErr || !distinctPages || distinctPages.length === 0) {
      console.error('❌ scv_crawl_pages 비어 있음:', dpErr?.message || '');
      return;
    }
    const uniqueIds = [...new Set(distinctPages.map(p => p.hospital_id))];
    const { data: hosps } = await supabase
      .from('hospitals')
      .select('id, name, website')
      .in('id', uniqueIds);
    targets = (hosps || []).slice(0, limit);
  }

  if (targets.length === 0) {
    console.error('❌ 분석 대상 병원 없음');
    return;
  }

  console.log(`📋 분석 대상: ${targets.length}개 병원`);

  // 2. 대상 병원의 scv_crawl_pages 로드
  const targetIds = targets.map(t => t.id);
  const hospitalPages = new Map<string, Array<{ hospital_id: string; url: string; page_type: string; markdown: string | null; char_count: number; gemini_analyzed: boolean }>>();

  for (const tid of targetIds) {
    const { data: pgs } = await supabase
      .from('scv_crawl_pages')
      .select('hospital_id, url, page_type, markdown, char_count, gemini_analyzed')
      .eq('hospital_id', tid);
    if (pgs && pgs.length > 0) {
      hospitalPages.set(tid, pgs);
      console.log(`  📄 ${targets.find(t => t.id === tid)?.name}: ${pgs.length}페이지 (${pgs.reduce((s, p) => s + (p.char_count || 0), 0).toLocaleString()}자)`);
    }
  }

  const summary: Array<{
    name: string; equip: number; treat: number;
    doctors: number; events: number; coverage: number; status: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    const hPages = hospitalPages.get(h.id) || [];
    console.log(`\n[${ i + 1}/${targets.length}] ${h.name} (${hPages.length}페이지)`);

    // 4. allText 구성 (scv_crawl_pages의 markdown 합산 — Gemini 토큰 절약을 위해 불필요 페이지 필터링)
    const EXCLUDE_URL_PATTERNS = [
      /\/member\//i,                   // 약관, 학회정보
      /\/about\/about\.php/i,          // 병원 인사말
      /\/about\/info\.php/i,           // 오시는길/진료시간
    ];
    const pagesWithMarkdown = hPages.filter(p => p.markdown);
    const filteredPages = pagesWithMarkdown.filter(p => {
      // 제외 패턴 매칭
      if (EXCLUDE_URL_PATTERNS.some(re => re.test(p.url))) return false;
      // clinicInfoPrima 하위: /special/만 허용, 나머지(wellAging, regeneration, signatureP 등) 제외
      if (/\/clinicInfoPrima\//i.test(p.url) && !/\/special\//i.test(p.url)) return false;
      return true;
    });

    const beforeChars = pagesWithMarkdown.reduce((s, p) => s + (p.markdown as string).length, 0);
    const afterChars = filteredPages.reduce((s, p) => s + (p.markdown as string).length, 0);
    const excludedPages = pagesWithMarkdown.filter(p => !filteredPages.includes(p));
    console.log(`  🔍 Gemini 입력 필터: ${pagesWithMarkdown.length}p (${beforeChars.toLocaleString()}자) → ${filteredPages.length}p (${afterChars.toLocaleString()}자) | 제외 ${excludedPages.length}p`);
    if (excludedPages.length > 0) {
      for (const ep of excludedPages) {
        const shortUrl = ep.url.replace(/^https?:\/\/[^/]+/, '');
        console.log(`    ✂️ ${shortUrl} (${(ep.char_count || 0).toLocaleString()}자)`);
      }
    }

    const allText = filteredPages
      .map(p => p.markdown as string)
      .join('\n\n---\n\n');

    if (allText.length < 100) {
      console.log('  ⚠️ 텍스트 부족 (< 100자), 건너뜀');
      continue;
    }

    console.log(`  📄 최종 텍스트: ${allText.length.toLocaleString()}자`);

    if (dryRun) {
      console.log('  [DRY-RUN] Phase 2 실행 건너뜀');
      continue;
    }

    // 5. Phase 2: 분류
    console.log(`  🧠 분류 시작...`);
    try {
      const v54Result = await classifyHospitalData(allText, h.name, 0);
      const analysis = convertV54ToAnalysis(v54Result);

      console.log(`  ✅ 장비 ${analysis.equipments.length} | 시술 ${analysis.treatments.length} | 의사 ${analysis.doctors.length} | 이벤트 ${analysis.events.length}`);

      // 6. DB 저장 (hospital_equipments, hospital_treatments 등)
      await saveAnalysis(h.id, analysis, h.website || hPages[0]?.url || '');
      console.log(`  💾 저장 완료`);

      summary.push({
        name: h.name,
        equip: analysis.equipments.length,
        treat: analysis.treatments.length,
        doctors: analysis.doctors.length,
        events: analysis.events.length,
        coverage: 0,
        status: 'analyzed',
      });
    } catch (err) {
      console.error(`  ❌ 분류 실패: ${err}`);
      summary.push({ name: h.name, equip: 0, treat: 0, doctors: 0, events: 0, coverage: 0, status: 'error' });
    }
  }

  // 7. 종합 보고
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Analyze Mode 종합 결과');
  console.log('═══════════════════════════════════════════════════\n');

  console.log('| 병원 | 의료기기 | 시술 | 의사 | 이벤트 | 판정 |');
  console.log('|------|---------|------|------|--------|------|');
  for (const s of summary) {
    console.log(`| ${s.name} | ${s.equip} | ${s.treat} | ${s.doctors} | ${s.events} | ${s.status} |`);
  }

  console.log(`\n분석 완료: ${summary.filter(s => s.status === 'analyzed').length}/${summary.length}개 병원`);
}

main().catch(console.error).finally(() => closePlaywright());
