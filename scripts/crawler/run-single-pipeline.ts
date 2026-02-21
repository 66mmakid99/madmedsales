/**
 * 단일 병원 2-pass 파이프라인.
 *
 * Pass 1 (텍스트): 크롤(enhanced) → Gemini 분석(v4.0) → 이미지 OCR → 머지
 * Pass 2 (스크린샷): Playwright 스크린샷 → Gemini Vision OCR → 머지
 *
 * Usage:
 *   npx tsx scripts/crawler/run-single-pipeline.ts --name "신사루비의원"
 *   npx tsx scripts/crawler/run-single-pipeline.ts --name "신사루비의원" --text-only
 */
import axios from 'axios';
import fs from 'fs/promises';
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
import {
  analyzeAllImages,
  mergeOcrIntoAnalysis,
  type ImageInput,
} from '../analysis/analyze-images.js';
import { screenshotOcr, closeBrowser } from './screenshot-ocr.js';
import { mergeScreenshotOcr } from './merge-ocr-results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('single-pipeline');
const DATA_DIR = path.resolve(__dirname, '../data/web-raw');
const MAX_TEXT = 150000;
const REQUEST_TIMEOUT = 15000;

const TEXT_ONLY = process.argv.includes('--text-only');

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

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
  const hospitalName = getArg('--name');
  if (!hospitalName) {
    log.error('Usage: npx tsx run-single-pipeline.ts --name "병원이름" [--text-only]');
    process.exit(1);
  }

  log.info(`=== Single Hospital Pipeline: ${hospitalName} ===`);
  log.info(`Mode: ${TEXT_ONLY ? 'text-only (pass 1)' : 'full (pass 1 + 2)'}`);

  // 1. Find hospital
  const { data: hospital, error: hErr } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .ilike('name', `%${hospitalName}%`)
    .limit(1)
    .single();

  if (hErr || !hospital?.website) {
    log.error(`Hospital not found or no website: ${hErr?.message}`);
    process.exit(1);
  }
  log.info(`Found: ${hospital.name} (${hospital.id}) — ${hospital.website}`);

  // 2. Clear old data for this hospital
  log.info('\n--- Clearing old data ---');
  const { count: delDocs } = await supabase.from('hospital_doctors').delete({ count: 'exact' }).eq('hospital_id', hospital.id);
  const { count: delEqs } = await supabase.from('hospital_equipments').delete({ count: 'exact' }).eq('hospital_id', hospital.id);
  const { count: delTrs } = await supabase.from('hospital_treatments').delete({ count: 'exact' }).eq('hospital_id', hospital.id).eq('source', 'web_analysis');
  log.info(`Deleted: ${delDocs ?? 0} doctors, ${delEqs ?? 0} equipments, ${delTrs ?? 0} web treatments`);

  // ═══════════════════════════════════════════════════════════════════
  // PASS 1 — Text crawl + Gemini text analysis + image OCR
  // ═══════════════════════════════════════════════════════════════════
  log.info('\n══════ PASS 1: Text Crawl + Analysis ══════');
  const mainHtml = await fetchPage(hospital.website);
  if (!mainHtml) { log.error('Failed to fetch main page'); process.exit(1); }

  const textParts = [extractTextFromHtml(mainHtml, MAX_TEXT)];
  let allEmails = extractEmailsFromHtml(mainHtml);
  const phones = extractPhonesFromHtml(mainHtml);
  const allImages: string[] = extractImageUrls(mainHtml, hospital.website);
  const crawledSubpages: string[] = [];

  const subpages = findSubpageUrls(mainHtml, hospital.website);
  log.info(`Found ${subpages.length} subpages`);

  for (const sp of subpages) {
    const spHtml = await fetchPage(sp.url);
    if (!spHtml) continue;
    crawledSubpages.push(sp.url);
    textParts.push(extractTextFromHtml(spHtml, MAX_TEXT));
    allEmails = [...allEmails, ...extractEmailsFromHtml(spHtml)];
    allImages.push(...extractImageUrls(spHtml, sp.url));
    log.info(`  [${sp.type}] ${sp.label}`);
    await delayWithJitter(500, 300);
  }

  const combinedText = textParts.join('\n\n').slice(0, MAX_TEXT);
  allEmails = [...new Set(allEmails)];
  const uniqueImages = [...new Set(allImages)];
  const email = pickBestEmail(allEmails);

  log.info(`Combined: ${combinedText.length} chars, ${allEmails.length} emails, ${uniqueImages.length} images`);

  // Gemini text analysis
  log.info('\n--- Gemini Analysis (v4.0) ---');
  const textAnalysis = await analyzeWithGemini(combinedText, hospital.id);
  if (!textAnalysis) { log.error('Analysis failed'); process.exit(1); }

  const pass1EqCount = textAnalysis.equipments.length;
  const pass1TrCount = textAnalysis.treatments.length;
  log.info(`Pass 1 text: ${textAnalysis.doctors.length} doctors, ${pass1EqCount} equipments, ${pass1TrCount} treatments`);

  // Image OCR (downloaded images)
  let finalAnalysis = textAnalysis;
  const filteredImages = filterLikelyContentImages(uniqueImages);
  const downloaded = await downloadImages(filteredImages, 5);
  if (downloaded.length > 0) {
    const imageInputs: ImageInput[] = downloaded.map((d) => ({
      base64: d.base64, mimeType: d.mimeType, url: d.url,
    }));
    const imgOcr = await analyzeAllImages(imageInputs, hospital.id);
    log.info(`Image OCR: +${imgOcr.equipments.length} eq, +${imgOcr.treatments.length} tr`);
    finalAnalysis = mergeOcrIntoAnalysis(textAnalysis, imgOcr);
  }

  const afterPass1Eq = finalAnalysis.equipments.length;
  const afterPass1Tr = finalAnalysis.treatments.length;

  // ═══════════════════════════════════════════════════════════════════
  // PASS 2 — Playwright screenshot + Gemini Vision OCR
  // ═══════════════════════════════════════════════════════════════════
  let pass2Stats = { newEquipments: 0, newTreatments: 0, updatedPrices: 0, updatedManufacturers: 0 };

  if (!TEXT_ONLY) {
    log.info('\n══════ PASS 2: Screenshot OCR ══════');

    // Select top pages for screenshots: main + treatment subpages
    const screenshotUrls = [
      hospital.website,
      ...subpages.filter((s) => s.type === 'treatment').map((s) => s.url),
    ];
    log.info(`Screenshotting ${Math.min(screenshotUrls.length, 5)} pages...`);

    try {
      const ocrResult = await screenshotOcr(screenshotUrls, hospital.id, 5);
      log.info(
        `Pass 2: ${ocrResult.pagesProcessed} pages → ${ocrResult.equipments.length} eq, ${ocrResult.treatments.length} tr ` +
        `(tokens: in=${ocrResult.tokensUsed.input} out=${ocrResult.tokensUsed.output})`
      );

      // Merge screenshot OCR into text analysis
      const merged = mergeScreenshotOcr(finalAnalysis, ocrResult.equipments, ocrResult.treatments);
      finalAnalysis = merged.result;
      pass2Stats = merged.stats;

      log.info(
        `Merge: +${pass2Stats.newEquipments} new eq, +${pass2Stats.newTreatments} new tr, ` +
        `${pass2Stats.updatedPrices} prices updated, ${pass2Stats.updatedManufacturers} mfr updated`
      );
    } catch (err) {
      log.warn(`Pass 2 failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await closeBrowser();
    }
  }

  // Save enriched JSON
  const rawData = {
    hospitalId: hospital.id,
    success: true,
    website: hospital.website,
    text: combinedText,
    email,
    emails: allEmails,
    phones,
    contactUrl: subpages.find((s) => s.type === 'contact')?.url ?? null,
    imageUrls: uniqueImages,
    subpagesCrawled: crawledSubpages,
    crawledAt: new Date().toISOString(),
  };
  const enrichedData = { ...rawData, analysis: finalAnalysis };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, `${hospital.id}.json`),
    JSON.stringify(enrichedData, null, 2),
    'utf-8'
  );

  // ═══════════════════════════════════════════════════════════════════
  // DB Upload
  // ═══════════════════════════════════════════════════════════════════
  log.info('\n--- DB Upload ---');

  let drCount = 0;
  for (const dr of finalAnalysis.doctors) {
    if (!dr.name) continue;
    const { error } = await supabase.from('hospital_doctors').insert({
      hospital_id: hospital.id, name: dr.name, title: dr.title ?? null,
      specialty: dr.specialty ?? null, career: dr.career ?? [], education: [],
      source: 'web_analysis',
    });
    if (error) log.warn(`Doctor insert error: ${error.message}`);
    else drCount++;
  }

  let eqCount = 0;
  for (const eq of finalAnalysis.equipments) {
    const { error } = await supabase.from('hospital_equipments').insert({
      hospital_id: hospital.id, equipment_name: eq.equipment_name,
      equipment_brand: eq.equipment_brand, equipment_category: eq.equipment_category,
      equipment_model: eq.equipment_model, estimated_year: eq.estimated_year,
      manufacturer: eq.manufacturer ?? null, is_confirmed: false, source: 'web_analysis',
    });
    if (error) log.warn(`Equipment insert error: ${error.message}`);
    else eqCount++;
  }

  let trCount = 0;
  for (const t of finalAnalysis.treatments) {
    const { error } = await supabase.from('hospital_treatments').insert({
      hospital_id: hospital.id, treatment_name: t.treatment_name,
      treatment_category: t.treatment_category, price_min: t.price_min,
      price_max: t.price_max, price: t.price ?? null, price_event: t.price_event ?? null,
      original_treatment_name: t.original_name ?? null,
      is_promoted: t.is_promoted, source: 'web_analysis',
    });
    if (error) log.warn(`Treatment insert error: ${error.message}`);
    else trCount++;
  }

  if (email) await supabase.from('hospitals').update({ email }).eq('id', hospital.id);
  if (phones.length > 0) await supabase.from('hospitals').update({ phone: phones[0] }).eq('id', hospital.id);

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════
  log.info('\n══════ FINAL RESULT ══════');
  log.info(`Doctors:    ${drCount}`);
  log.info(`Equipments: ${eqCount}  (pass1=${afterPass1Eq}, pass2=+${pass2Stats.newEquipments})`);
  log.info(`Treatments: ${trCount}  (pass1=${afterPass1Tr}, pass2=+${pass2Stats.newTreatments})`);
  log.info(`Email:      ${email ?? 'none'}`);
  log.info(`Phone:      ${phones[0] ?? 'none'}`);
  log.info('Done!');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
