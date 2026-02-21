/**
 * 병원 웹사이트 크롤러
 * 병원 홈페이지에서 HTML 텍스트를 수집하여
 * 이후 Gemini 분석에 사용할 데이터를 저장합니다.
 *
 * --enhanced: 서브페이지 크롤링 + 이미지URL 수집
 * --recrawl-no-email: 이메일 없는 파일만 재크롤
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { delayWithJitter } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';
import { isHospitalOwnedWebsite } from '../utils/url-classifier.js';
import {
  extractTextFromHtml,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  pickBestEmail,
  extractImageUrls,
} from './html-extractor.js';
import { findSubpageUrls, type SubpageUrl } from './subpage-finder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('crawl-web');
const DATA_DIR = path.resolve(__dirname, '../data/web-raw');
const DELAY_MS = 1000;
const JITTER_MS = 500;
const REQUEST_TIMEOUT = 15000;
const MAX_TEXT_LENGTH = 50000;
const MAX_TEXT_LENGTH_ENHANCED = 150000;

const RECRAWL_NO_EMAIL = process.argv.includes('--recrawl-no-email');
const ENHANCED = process.argv.includes('--enhanced');

async function fetchPage(url: string): Promise<string | null> {
  try {
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

interface CrawlResult {
  hospitalId: string;
  success: boolean;
  website?: string;
  text?: string;
  email?: string | null;
  emails?: string[];
  phones?: string[];
  contactUrl?: string | null;
  imageUrls?: string[];
  subpagesCrawled?: string[];
  crawledAt?: string;
  error?: string;
}

async function crawlHospital(
  hospitalId: string,
  website: string
): Promise<CrawlResult> {
  const html = await fetchPage(website);

  if (!html) {
    return { hospitalId, success: false, error: 'Failed to fetch page' };
  }

  const maxLen = ENHANCED ? MAX_TEXT_LENGTH_ENHANCED : MAX_TEXT_LENGTH;
  const textParts: string[] = [extractTextFromHtml(html, maxLen)];
  let allEmails = extractEmailsFromHtml(html);
  const phones = extractPhonesFromHtml(html);
  const allImageUrls: string[] = extractImageUrls(html, website);
  const crawledSubpages: string[] = [];

  if (ENHANCED) {
    // Discover and crawl subpages
    const subpages = findSubpageUrls(html, website);
    log.info(`  Found ${subpages.length} subpages: ${subpages.map((s) => s.type).join(', ')}`);

    for (const sp of subpages) {
      const spHtml = await fetchPage(sp.url);
      if (!spHtml) continue;

      crawledSubpages.push(sp.url);
      textParts.push(extractTextFromHtml(spHtml, maxLen));
      allEmails = [...allEmails, ...extractEmailsFromHtml(spHtml)];

      // Collect images from subpages
      const spImages = extractImageUrls(spHtml, sp.url);
      allImageUrls.push(...spImages);

      await delayWithJitter(500, 300);
    }
  } else {
    // Legacy mode: only crawl contact subpages for email discovery
    const subpages = findSubpageUrls(html, website);
    const contactPages = subpages.filter((s) => s.type === 'contact');

    if (allEmails.length === 0 && contactPages.length > 0) {
      log.info(`  No email on main page, crawling ${contactPages.length} contact pages...`);
      for (const sp of contactPages) {
        const spHtml = await fetchPage(sp.url);
        if (!spHtml) continue;
        allEmails = [...allEmails, ...extractEmailsFromHtml(spHtml)];
        await delayWithJitter(500, 300);
      }
    }
  }

  // Combine all text, deduplicate emails/images
  const combinedText = textParts.join('\n\n').slice(0, maxLen);
  allEmails = [...new Set(allEmails)];
  const uniqueImageUrls = [...new Set(allImageUrls)];
  const email = pickBestEmail(allEmails);
  const contactUrl = findSubpageUrls(html, website)
    .find((s) => s.type === 'contact')?.url ?? null;

  return {
    hospitalId,
    success: true,
    website,
    text: combinedText,
    email,
    emails: allEmails,
    phones,
    contactUrl,
    imageUrls: ENHANCED ? uniqueImageUrls : undefined,
    subpagesCrawled: ENHANCED ? crawledSubpages : undefined,
    crawledAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  log.info(`Starting hospital website crawl (enhanced: ${ENHANCED})`);

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
    const filePath = path.join(DATA_DIR, `${hospital.id}.json`);

    if (RECRAWL_NO_EMAIL) {
      try {
        const existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        if (existing.email) continue;
      } catch {
        continue;
      }
    } else {
      try {
        await fs.access(filePath);
        continue;
      } catch {
        // File doesn't exist, proceed
      }
    }

    if (!hospital.website) continue;

    if (!isHospitalOwnedWebsite(hospital.website)) {
      log.info(`[${processed}/${hospitals.length}] Skipping non-hospital URL: ${hospital.website}`);
      continue;
    }

    log.info(`[${processed}/${hospitals.length}] Crawling: ${hospital.name} (${hospital.website})`);

    const result = await crawlHospital(hospital.id, hospital.website);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf-8');

    if (result.success) {
      success++;
      const imgCount = result.imageUrls?.length ?? 0;
      const spCount = result.subpagesCrawled?.length ?? 0;
      log.info(
        `Saved: ${hospital.name} (${result.text?.length ?? 0} chars, email: ${result.email ?? 'none'}, phones: ${result.phones?.length ?? 0}${ENHANCED ? `, images: ${imgCount}, subpages: ${spCount}` : ''})`
      );
    }

    await delayWithJitter(DELAY_MS, JITTER_MS);
  }

  log.info(`Crawl complete. Processed: ${processed}, Success: ${success}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
