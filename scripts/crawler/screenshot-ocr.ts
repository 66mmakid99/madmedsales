/**
 * Playwright screenshot → Gemini Vision OCR pipeline.
 *
 * Takes full-page screenshots of hospital websites via Playwright
 * (handles SPAs, dynamic rendering, image-only content) and sends
 * them to Gemini Flash Vision to extract equipment / treatment names.
 *
 * This is the "2nd pass" that complements the text-based 1st pass.
 */
import type { Browser, Page } from 'playwright';
import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from '../utils/usage-logger.js';
import { getAccessToken } from '../analysis/gemini-auth.js';
import { getGeminiModel, getGeminiEndpoint } from '../utils/gemini-model.js';
import { getEquipmentBrandList } from './dictionary-loader.js';

const log = createLogger('screenshot-ocr');

// ─── Types ────────────────────────────────────────────────────────────────

export interface OcrEquipment {
  equipment_name: string;
  equipment_category: string;
  manufacturer: string | null;
}

export interface OcrTreatment {
  treatment_name: string;
  treatment_category: string;
  price: number | null;
  price_event: number | null;
}

export interface ScreenshotOcrResult {
  equipments: OcrEquipment[];
  treatments: OcrTreatment[];
  pagesProcessed: number;
  tokensUsed: { input: number; output: number };
}

interface ScreenshotData {
  base64: string;
  url: string;
  sizeBytes: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

const VIEWPORT_DESKTOP = { width: 1280, height: 800 };
const VIEWPORT_MOBILE = { width: 390, height: 844 };
const PAGE_TIMEOUT = 30_000;
const POPUP_WAIT = 2_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB per screenshot

// v3.0 - 2026-02-26 - 데이터 사전 동적 로드, unregistered 필드 추가
function buildScreenshotPrompt(): string {
  const brandList = getEquipmentBrandList();
  return `당신은 한국 피부과/성형외과 웹사이트의 스크린샷을 분석하는 전문가입니다.
이 스크린샷에서 아래 정보를 최대한 빠짐없이 추출하세요.

1. **장비 (equipments)**: 페이지에 보이는 모든 의료 장비명.
   메뉴, 배너, 이벤트 팝업, 본문 어디든 장비명이 보이면 추출.
   이미지 안의 텍스트도 읽어야 합니다.

2. **시술 (treatments)**: 제공하는 모든 시술/서비스명.

3. **가격 (prices)**: 시술명+가격 세트. 이벤트가, 정가, 할인가 구분.
   이미지 배너 안의 가격표를 특히 주의 깊게 확인하세요.
   한국 피부과는 가격을 텍스트가 아닌 이미지(배너/표)로 표시하는 경우가 대부분입니다.
   한국 가격 표기: "55만원"=550000, "39만"=390000, "550,000원"=550000

4. **의료진 (doctors)**: 의사 이름, 전문의 여부, 경력

5. **병원 정보**: 진료시간, 주소, 전화번호, 특화 분야

6. **이벤트/프로모션**: 현재 진행 중인 이벤트, 할인, 패키지

## 장비 이중 분류 규칙 (R1-1, 최우선 적용)
한국 피부과에서는 "장비명 = 시술명"입니다. 아래 브랜드명이 보이면 반드시 equipments에 포함:
${brandList}

★ 위 목록에 없는 장비도 발견하면 반드시 추출. 절대 버리지 마라.

JSON 응답:`;
{
  "equipments": [{"equipment_name":"","equipment_category":"rf|hifu|laser|booster|body|lifting|other","manufacturer":""}],
  "treatments": [{"treatment_name":"","treatment_category":"","price":null,"price_event":null}]
}

규칙:
- 이미지/배너/갤러리 안에 보이는 장비명도 반드시 포함
- 가격은 KRW 정수 ("15만원" → 150000)
- 확실하지 않은 값은 null
- 해당 정보 없으면 빈 배열
- 한 글자라도 놓치지 마세요. 이미지 안의 한글 텍스트를 정확하게 읽는 것이 핵심입니다.
- JSON만 응답`;
}

const SCREENSHOT_PROMPT = buildScreenshotPrompt();

// ─── Browser Management ───────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  // Dynamic import so the module doesn't crash when Playwright is missing
  const pw = await import('playwright');
  _browser = await pw.chromium.launch({ headless: true });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

// ─── Popup Dismissal ──────────────────────────────────────────────────────

// v2.0 - 2026-02-22: Enhanced popup dismissal for Korean clinic sites
async function tryClosePopups(page: Page): Promise<void> {
  const selectors = [
    // Korean-specific popup close patterns
    '[class*="popup"] [class*="close"]',
    '[class*="modal"] [class*="close"]',
    '[class*="layer"] [class*="close"]',
    'a[href*="popup_close"]',
    'button:has-text("닫기")',
    'button:has-text("하루동안")',
    'button:has-text("오늘 하루")',
    'a:has-text("하루동안 보지 않기")',
    'a:has-text("닫기")',
    'button:has-text("Close")',
    'button:has-text("X")',
    '[id*="close"]',
    '.btn_close',
    '.close_btn',
    '.popup_close',
    '[class*="popup"] button',
    '[class*="modal"] button',
    '[aria-label="Close"]',
    '[aria-label="닫기"]',
  ];

  for (const sel of selectors) {
    try {
      const elements = await page.locator(sel).all();
      for (const el of elements) {
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          await el.click({ timeout: 1_000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
      }
    } catch {
      // Non-critical — continue
    }
  }
}

// ─── Screenshot Capture ───────────────────────────────────────────────────

interface ViewportConfig {
  width: number;
  height: number;
}

async function captureScreenshot(
  url: string,
  viewport: ViewportConfig = VIEWPORT_DESKTOP
): Promise<ScreenshotData | null> {
  const browser = await getBrowser();
  const isMobile = viewport.width < 500;
  const userAgent = isMobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const context = await browser.newContext({
    viewport,
    locale: 'ko-KR',
    userAgent,
    isMobile,
  });
  const page = await context.newPage();

  try {
    let fullUrl = url;
    if (!fullUrl.startsWith('http')) fullUrl = `https://${fullUrl}`;

    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT });

    // Wait for dynamic content + dismiss popups
    await page.waitForTimeout(POPUP_WAIT);
    await tryClosePopups(page);

    // Full-page screenshot as PNG buffer
    const buffer = await page.screenshot({ fullPage: true, type: 'png' });

    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      log.warn(`Screenshot too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB), skipping: ${url}`);
      return null;
    }

    const label = isMobile ? '[mobile]' : '[desktop]';
    log.info(`${label} Screenshot: ${(buffer.length / 1024).toFixed(0)} KB — ${url.slice(0, 60)}`);

    return {
      base64: buffer.toString('base64'),
      url: `${url}${isMobile ? ' [mobile]' : ''}`,
      sizeBytes: buffer.length,
    };
  } catch (err) {
    log.warn(`Screenshot failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await context.close();
  }
}

// ─── Gemini Vision OCR ───────────────────────────────────────────────────

interface GeminiVisionResponse {
  equipments: OcrEquipment[];
  treatments: OcrTreatment[];
  inputTokens: number;
  outputTokens: number;
}

async function analyzeScreenshot(
  screenshot: ScreenshotData,
  hospitalId?: string
): Promise<GeminiVisionResponse | null> {
  try {
    const token = await getAccessToken();

    const geminiModel = getGeminiModel();
    log.info(`Using model: ${geminiModel}`);
    const response = await axios.post(
      getGeminiEndpoint(geminiModel),
      {
        contents: [
          {
            parts: [
              { text: SCREENSHOT_PROMPT },
              {
                inline_data: {
                  mime_type: 'image/png',
                  data: screenshot.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 3000,
          responseMimeType: 'application/json',
        },
      },
      { timeout: 60_000, headers: { Authorization: `Bearer ${token}` } }
    );

    const usage = response.data?.usageMetadata;
    const inputTokens = usage?.promptTokenCount ?? 0;
    const outputTokens = usage?.candidatesTokenCount ?? 0;

    log.info(
      `Vision OCR: in=${inputTokens} out=${outputTokens} (${(screenshot.sizeBytes / 1024).toFixed(0)} KB) ${screenshot.url.slice(0, 60)}`
    );

    await logApiUsage({
      service: 'gemini',
      model: geminiModel,
      purpose: 'screenshot_ocr',
      inputTokens,
      outputTokens,
      hospitalId,
    });

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as { equipments?: unknown[]; treatments?: unknown[] };
    return {
      equipments: Array.isArray(parsed.equipments) ? (parsed.equipments as OcrEquipment[]) : [],
      treatments: Array.isArray(parsed.treatments) ? (parsed.treatments as OcrTreatment[]) : [],
      inputTokens,
      outputTokens,
    };
  } catch (err) {
    log.warn(`Vision OCR failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Run the full screenshot → Gemini Vision pipeline on a list of URLs.
 * v2.0: Desktop + mobile dual viewport, enhanced popup handling.
 *
 * @param urls   Page URLs to screenshot (main + subpages)
 * @param hospitalId  Optional hospital ID for usage tracking
 * @param maxPages    Max pages to screenshot (default 5 — main + top subpages)
 */
export async function screenshotOcr(
  urls: string[],
  hospitalId?: string,
  maxPages = 5
): Promise<ScreenshotOcrResult> {
  const result: ScreenshotOcrResult = {
    equipments: [],
    treatments: [],
    pagesProcessed: 0,
    tokensUsed: { input: 0, output: 0 },
  };

  const pagesToProcess = urls.slice(0, maxPages);

  for (const url of pagesToProcess) {
    // Desktop screenshot
    const desktopShot = await captureScreenshot(url, VIEWPORT_DESKTOP);
    if (desktopShot) {
      const ocrResult = await analyzeScreenshot(desktopShot, hospitalId);
      if (ocrResult) {
        result.pagesProcessed++;
        result.tokensUsed.input += ocrResult.inputTokens;
        result.tokensUsed.output += ocrResult.outputTokens;
        result.equipments.push(...ocrResult.equipments);
        result.treatments.push(...ocrResult.treatments);
      }
    }

    // Mobile screenshot (main page only — captures mobile-only content)
    if (url === pagesToProcess[0]) {
      const mobileShot = await captureScreenshot(url, VIEWPORT_MOBILE);
      if (mobileShot) {
        const ocrResult = await analyzeScreenshot(mobileShot, hospitalId);
        if (ocrResult) {
          result.pagesProcessed++;
          result.tokensUsed.input += ocrResult.inputTokens;
          result.tokensUsed.output += ocrResult.outputTokens;
          result.equipments.push(...ocrResult.equipments);
          result.treatments.push(...ocrResult.treatments);
        }
      }
    }
  }

  // Deduplicate by equipment_name (case-insensitive)
  result.equipments = deduplicateEquipments(result.equipments);
  result.treatments = deduplicateTreatments(result.treatments);

  return result;
}

// ─── Dedup Helpers ───────────────────────────────────────────────────────

function deduplicateEquipments(items: OcrEquipment[]): OcrEquipment[] {
  const seen = new Map<string, OcrEquipment>();
  for (const eq of items) {
    const key = eq.equipment_name.toLowerCase().trim();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, eq);
    } else if (eq.manufacturer && !seen.get(key)!.manufacturer) {
      seen.get(key)!.manufacturer = eq.manufacturer;
    }
  }
  return Array.from(seen.values());
}

function deduplicateTreatments(items: OcrTreatment[]): OcrTreatment[] {
  const seen = new Map<string, OcrTreatment>();
  for (const tr of items) {
    const key = tr.treatment_name.toLowerCase().trim();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.set(key, tr);
    } else {
      // Prefer non-null prices
      const existing = seen.get(key)!;
      if (tr.price != null && existing.price == null) existing.price = tr.price;
      if (tr.price_event != null && existing.price_event == null) existing.price_event = tr.price_event;
    }
  }
  return Array.from(seen.values());
}
