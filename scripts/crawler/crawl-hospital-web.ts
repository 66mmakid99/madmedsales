/**
 * 병원 웹사이트 크롤러
 * 병원 홈페이지에서 HTML 텍스트를 수집하여
 * 이후 Gemini 분석에 사용할 데이터를 저장합니다.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { delayWithJitter } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('crawl-web');
const DATA_DIR = path.resolve(__dirname, '../data/web-raw');
const DELAY_MS = 1000;
const JITTER_MS = 500;
const REQUEST_TIMEOUT = 15000;
const MAX_TEXT_LENGTH = 50000;

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Remove scripts, styles, and other non-content elements
  $('script, style, noscript, iframe, svg, nav, footer, header').remove();

  const text = $('body').text();

  // Clean up whitespace
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    // Ensure URL has protocol
    let fullUrl = url;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = `https://${fullUrl}`;
    }

    const response = await axios.get<string>(fullUrl, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      maxRedirects: 5,
      responseType: 'text',
    });

    return typeof response.data === 'string' ? response.data : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to fetch ${url}: ${message}`);
    return null;
  }
}

async function extractEmailFromHtml(html: string): Promise<string | null> {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex);

  if (!matches || matches.length === 0) return null;

  // Filter out common non-contact emails
  const filtered = matches.filter(
    (email) =>
      !email.includes('example.com') &&
      !email.includes('sentry.io') &&
      !email.includes('googletagmanager') &&
      !email.endsWith('.png') &&
      !email.endsWith('.jpg')
  );

  return filtered.length > 0 ? filtered[0] : null;
}

async function main(): Promise<void> {
  log.info('Starting hospital website crawl');

  await fs.mkdir(DATA_DIR, { recursive: true });

  const { data: hospitals, error } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .eq('status', 'active')
    .not('website', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    log.error('Failed to fetch hospitals', error);
    process.exit(1);
  }

  if (!hospitals || hospitals.length === 0) {
    log.warn('No hospitals with websites found');
    return;
  }

  log.info(`Found ${hospitals.length} hospitals with websites`);

  let processed = 0;
  let success = 0;

  for (const hospital of hospitals) {
    processed++;

    // Skip if already crawled
    const filePath = path.join(DATA_DIR, `${hospital.id}.json`);
    try {
      await fs.access(filePath);
      continue;
    } catch {
      // File doesn't exist, proceed
    }

    if (!hospital.website) continue;

    log.info(
      `[${processed}/${hospitals.length}] Crawling: ${hospital.name} (${hospital.website})`
    );

    const html = await fetchPage(hospital.website);

    if (!html) {
      await fs.writeFile(
        filePath,
        JSON.stringify({
          hospitalId: hospital.id,
          success: false,
          error: 'Failed to fetch page',
        }, null, 2),
        'utf-8'
      );
      await delayWithJitter(DELAY_MS, JITTER_MS);
      continue;
    }

    const text = extractTextFromHtml(html);
    const email = await extractEmailFromHtml(html);

    const result = {
      hospitalId: hospital.id,
      success: true,
      website: hospital.website,
      text,
      email,
      crawledAt: new Date().toISOString(),
    };

    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');
    success++;

    log.info(
      `Saved web data for ${hospital.name} (${text.length} chars, email: ${email ?? 'none'})`
    );

    await delayWithJitter(DELAY_MS, JITTER_MS);
  }

  log.info(`Crawl complete. Processed: ${processed}, Success: ${success}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
