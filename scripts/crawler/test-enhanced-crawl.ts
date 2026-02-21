/**
 * Enhanced crawl test script.
 * Tests the full pipeline on a single hospital (신사루비의원):
 * fetch main → find subpages → fetch subpages → combine text →
 * extract images → download images → Gemini text analysis →
 * Gemini image OCR → merge → output comparison.
 *
 * Usage: npx tsx scripts/crawler/test-enhanced-crawl.ts
 */
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { delayWithJitter } from '../utils/delay.js';
import {
  extractTextFromHtml,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  pickBestEmail,
  extractImageUrls,
} from './html-extractor.js';
import { findSubpageUrls } from './subpage-finder.js';
import { filterLikelyContentImages, downloadImages } from './image-downloader.js';
import { analyzeWithGemini } from '../analysis/analyze-web.js';
import { analyzeAllImages, mergeOcrIntoAnalysis, type ImageInput } from '../analysis/analyze-images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('test-enhanced');
const MAX_TEXT = 150000;
const REQUEST_TIMEOUT = 15000;

async function fetchPage(url: string): Promise<string | null> {
  try {
    let fullUrl = url;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = `https://${fullUrl}`;
    }
    const response = await axios.get<string>(fullUrl, {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      maxRedirects: 5,
      responseType: 'text',
    });
    return typeof response.data === 'string' ? response.data : null;
  } catch (err) {
    log.warn(`Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main(): Promise<void> {
  log.info('=== Enhanced Crawl Test ===');

  // Find 신사루비의원
  const { data: hospital, error } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .ilike('name', '%신사루비%')
    .limit(1)
    .single();

  if (error || !hospital) {
    log.error('Hospital not found. Trying first hospital with website...');
    const { data: fallback } = await supabase
      .from('hospitals')
      .select('id, name, website')
      .not('website', 'is', null)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (!fallback?.website) {
      log.error('No hospital with website found');
      process.exit(1);
    }
    Object.assign(hospital ?? {}, fallback);
  }

  const target = hospital!;
  log.info(`Target: ${target.name} (${target.website})`);

  // Step 1: Fetch main page
  log.info('\n--- Step 1: Fetch main page ---');
  const mainHtml = await fetchPage(target.website!);
  if (!mainHtml) {
    log.error('Failed to fetch main page');
    process.exit(1);
  }
  const mainText = extractTextFromHtml(mainHtml, MAX_TEXT);
  const mainEmails = extractEmailsFromHtml(mainHtml);
  const mainPhones = extractPhonesFromHtml(mainHtml);
  const mainImages = extractImageUrls(mainHtml, target.website!);
  log.info(`Main page: ${mainText.length} chars, ${mainEmails.length} emails, ${mainPhones.length} phones, ${mainImages.length} images`);

  // Step 2: Find subpages
  log.info('\n--- Step 2: Find subpages ---');
  const subpages = findSubpageUrls(mainHtml, target.website!);
  for (const sp of subpages) {
    log.info(`  [${sp.type}] ${sp.label} → ${sp.url}`);
  }

  // Step 3: Fetch subpages
  log.info('\n--- Step 3: Fetch subpages ---');
  const textParts = [mainText];
  const allEmails = [...mainEmails];
  const allImages = [...mainImages];

  for (const sp of subpages) {
    const spHtml = await fetchPage(sp.url);
    if (!spHtml) {
      log.info(`  [${sp.type}] FAILED: ${sp.url}`);
      continue;
    }
    textParts.push(extractTextFromHtml(spHtml, MAX_TEXT));
    allEmails.push(...extractEmailsFromHtml(spHtml));
    allImages.push(...extractImageUrls(spHtml, sp.url));
    log.info(`  [${sp.type}] OK: ${spHtml.length} bytes`);
    await delayWithJitter(500, 300);
  }

  const combinedText = textParts.join('\n\n').slice(0, MAX_TEXT);
  const uniqueEmails = [...new Set(allEmails)];
  const uniqueImages = [...new Set(allImages)];
  log.info(`Combined: ${combinedText.length} chars, ${uniqueEmails.length} emails, ${uniqueImages.length} images`);

  // Step 4: Filter and download images
  log.info('\n--- Step 4: Download images ---');
  const filteredImages = filterLikelyContentImages(uniqueImages);
  log.info(`Filtered to ${filteredImages.length} likely content images`);
  const downloaded = await downloadImages(filteredImages, 5);
  log.info(`Downloaded ${downloaded.length} images`);
  for (const img of downloaded) {
    log.info(`  ${img.mimeType} ${(img.sizeBytes / 1024).toFixed(1)}KB → ${img.url.slice(0, 80)}`);
  }

  // Step 5: Gemini text analysis
  log.info('\n--- Step 5: Gemini text analysis ---');
  const textAnalysis = await analyzeWithGemini(combinedText, target.id);
  if (!textAnalysis) {
    log.error('Text analysis failed');
    process.exit(1);
  }
  log.info(`Text analysis: ${textAnalysis.doctors.length} doctors, ${textAnalysis.equipments.length} equipments, ${textAnalysis.treatments.length} treatments`);

  // Step 6: Gemini image OCR
  log.info('\n--- Step 6: Image OCR ---');
  let finalAnalysis = textAnalysis;
  if (downloaded.length > 0) {
    const imageInputs: ImageInput[] = downloaded.map((d) => ({
      base64: d.base64,
      mimeType: d.mimeType,
      url: d.url,
    }));
    const ocrResults = await analyzeAllImages(imageInputs, target.id);
    log.info(`OCR results: ${ocrResults.equipments.length} equipments, ${ocrResults.treatments.length} treatments`);

    // Step 7: Merge
    log.info('\n--- Step 7: Merge ---');
    finalAnalysis = mergeOcrIntoAnalysis(textAnalysis, ocrResults);
  } else {
    log.info('No images to OCR, skipping');
  }

  // Final output
  log.info('\n=== RESULTS ===');
  log.info(`Doctors (${finalAnalysis.doctors.length}):`);
  for (const dr of finalAnalysis.doctors) {
    log.info(`  ${dr.name} | ${dr.title ?? '-'} | ${dr.specialty ?? '-'} | career: ${dr.career.length}`);
  }
  log.info(`Equipments (${finalAnalysis.equipments.length}):`);
  for (const eq of finalAnalysis.equipments) {
    log.info(`  ${eq.equipment_name} [${eq.equipment_category}] ${eq.manufacturer ? `(${eq.manufacturer})` : ''}`);
  }
  log.info(`Treatments (${finalAnalysis.treatments.length}):`);
  for (const tr of finalAnalysis.treatments) {
    const priceStr = tr.price ? `₩${tr.price.toLocaleString()}` : '-';
    const eventStr = tr.price_event ? `₩${tr.price_event.toLocaleString()}` : '-';
    log.info(`  ${tr.treatment_name} [${tr.treatment_category}] price=${priceStr} event=${eventStr}${tr.original_name ? ` (→${tr.original_name})` : ''}`);
  }
  log.info(`Email: ${pickBestEmail(uniqueEmails) ?? 'none'}`);
  log.info(`Phones: ${mainPhones.join(', ') || 'none'}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
