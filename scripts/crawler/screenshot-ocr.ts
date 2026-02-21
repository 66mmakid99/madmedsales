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

const VIEWPORT = { width: 1280, height: 800 };
const PAGE_TIMEOUT = 25_000;
const POPUP_WAIT = 2_000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB per screenshot

// v1.0 — structured extraction, not raw OCR
const SCREENSHOT_PROMPT = `이 스크린샷은 한국 피부과/성형외과 병원 홈페이지입니다.
페이지에 보이는 모든 의료기기/장비명과 시술명을 추출하세요.

장비 참고 리스트:
- rf: 인모드, 써마지, 올리지오, 포텐자, 시크릿, 스카젠, 테너, 빈센자, TORR, 세르프, 덴서티
- hifu: 울쎄라, 슈링크, 리프테라, 더블로, 리니어지
- laser: 피코슈어, 피코웨이, 레블라이트, 클라리티, 엑셀V, 젠틀맥스, 프락셀, CO2
- booster: 리쥬란, 쥬베룩, 물광, 연어주사, 엑소좀
- body: 쿨스컬프팅, 바넥스, 리포셀, 온다, 벨라콜린
- lifting: 실리프팅, 민트실, PDO, 울핏

JSON 응답:
{
  "equipments": [{"equipment_name":"","equipment_category":"rf|hifu|laser|booster|body|lifting|other","manufacturer":""}],
  "treatments": [{"treatment_name":"","treatment_category":"","price":null,"price_event":null}]
}

규칙:
- 이미지/배너/갤러리 안에 보이는 장비명도 반드시 포함
- 가격은 KRW 정수 ("15만원" → 150000)
- 확실하지 않은 값은 null
- 해당 정보 없으면 빈 배열
- JSON만 응답`;

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

async function tryClosePopups(page: Page): Promise<void> {
  try {
    // Common close-button selectors
    const selectors = [
      'button:has-text("닫기")',
      'button:has-text("Close")',
      'button:has-text("X")',
      '[class*="close"]',
      '[class*="popup"] button',
      '[class*="modal"] button',
      '[aria-label="Close"]',
      '[aria-label="닫기"]',
    ];

    for (const sel of selectors) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ timeout: 1_000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  } catch {
    // Non-critical — continue even if popup dismissal fails
  }
}

// ─── Screenshot Capture ───────────────────────────────────────────────────

async function captureScreenshot(url: string): Promise<ScreenshotData | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'ko-KR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

    return {
      base64: buffer.toString('base64'),
      url,
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

    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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
      model: 'gemini-2.0-flash',
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
    const screenshot = await captureScreenshot(url);
    if (!screenshot) continue;

    const ocrResult = await analyzeScreenshot(screenshot, hospitalId);
    if (!ocrResult) continue;

    result.pagesProcessed++;
    result.tokensUsed.input += ocrResult.inputTokens;
    result.tokensUsed.output += ocrResult.outputTokens;

    result.equipments.push(...ocrResult.equipments);
    result.treatments.push(...ocrResult.treatments);
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
