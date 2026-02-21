/**
 * 배치 병원 5-Stage 파이프라인 (v3.1).
 *
 * Stage 1: 수집 (2-Pass: Text + Playwright Screenshot OCR)
 * Stage 2: 정규화 (normalizer.ts)
 * Stage 3: 합성어 분해 (decomposer.ts)
 * Stage 4: 가격 파싱 (price-parser.ts)
 * Stage 5: 저장 (DB + crawl_snapshots + 변동 감지)
 *
 * 3티어 차등 크롤링:
 *   Tier1 (PRIME/HIGH): 매주 Full (Text+OCR)
 *   Tier2 (MID): 2주마다 Text, 변동 감지 시 OCR
 *   Tier3 (LOW): 월1회 Text, 변동 감지 시 OCR
 *
 * Usage:
 *   npx tsx scripts/crawler/run-batch-pipeline.ts [--limit 50] [--text-only] [--offset 0]
 *   npx tsx scripts/crawler/run-batch-pipeline.ts --tier tier1 --limit 20
 *   npx tsx scripts/crawler/run-batch-pipeline.ts --source medchecker --limit 20
 *   npx tsx scripts/crawler/run-batch-pipeline.ts --dry-run
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
// v3.1 신규 모듈
import { normalizeEquipmentNames, normalizeTreatmentNames, extractKnownKeywords } from './normalizer.js';
import { decomposeAll } from './decomposer.js';
import { parsePrices, toHospitalPricingRow } from './price-parser.js';
import { detectChanges, saveSnapshot, detectEquipmentChanges } from './change-detector.js';
import { classifySignals } from './signal-classifier.js';
import type { ScoringCriteriaV31, SalesSignalRule } from '@madmedsales/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('batch-pipeline');
const DATA_DIR = path.resolve(__dirname, '../data/web-raw');
const MAX_TEXT = 150000;
const REQUEST_TIMEOUT = 15000;
const DELAY_BETWEEN_HOSPITALS = 3000;
const PROXY_URL = process.env.PROXY_URL ?? null;

// CLI args
function getArg(flag: string, defaultVal: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}

const LIMIT = parseInt(getArg('--limit', '50'), 10);
const OFFSET = parseInt(getArg('--offset', '0'), 10);
const TEXT_ONLY = process.argv.includes('--text-only');
const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE = getArg('--source', '');
const TIER_FILTER = getArg('--tier', ''); // tier1, tier2, tier3

/** 3티어 결정: 프로파일 등급 기반 */
function determineTier(profileGrade: string | null): 'tier1' | 'tier2' | 'tier3' {
  if (profileGrade === 'PRIME' || profileGrade === 'HIGH') return 'tier1';
  if (profileGrade === 'MID') return 'tier2';
  return 'tier3';
}

/** 티어별 크롤링 주기 판단 */
function shouldCrawl(tier: string, lastCrawledAt: string | null): boolean {
  if (!lastCrawledAt) return true; // 한 번도 안 크롤링됨
  const daysSince = (Date.now() - new Date(lastCrawledAt).getTime()) / (1000 * 60 * 60 * 24);
  switch (tier) {
    case 'tier1': return daysSince >= 7;   // 주1회
    case 'tier2': return daysSince >= 14;  // 2주1회
    case 'tier3': return daysSince >= 30;  // 월1회
    default: return true;
  }
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    let fullUrl = url;
    if (!fullUrl.startsWith('http')) fullUrl = `https://${fullUrl}`;

    const axiosConfig: Record<string, unknown> = {
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      maxRedirects: 5,
      responseType: 'text',
    };

    // 프록시 설정 (환경변수 PROXY_URL 사용)
    if (PROXY_URL) {
      axiosConfig.proxy = false; // axios 기본 프록시 비활성
      axiosConfig.httpsAgent = undefined; // 프록시 에이전트는 별도 설정 필요
      // 프록시 로테이션: PROXY_URL이 설정되면 axios-https-proxy-agent 등 사용
      // 현재는 placeholder — 실제 프록시 에이전트 라이브러리 연결 필요
    }

    const response = await axios.get<string>(fullUrl, axiosConfig);
    return typeof response.data === 'string' ? response.data : null;
  } catch {
    return null;
  }
}

interface BatchStats {
  processed: number;
  succeeded: number;
  failed: number;
  skippedBySchedule: number;
  skippedNoChange: number;
  totalEquipments: number;
  totalTreatments: number;
  totalDoctors: number;
  totalPrices: number;
  pass2NewEquipments: number;
  pass2NewTreatments: number;
  normalizerMatchRate: number;
  newCompoundCandidates: number;
  tokensInput: number;
  tokensOutput: number;
}

async function processHospital(
  hospitalId: string,
  website: string,
  tier: string,
  stats: BatchStats
): Promise<boolean> {
  try {
    // ═══════════════════════════════════════════════════════════════
    // Stage 1: 수집 (2-Pass)
    // ═══════════════════════════════════════════════════════════════

    // Clear old data
    await supabase.from('hospital_doctors').delete().eq('hospital_id', hospitalId);
    await supabase.from('hospital_equipments').delete().eq('hospital_id', hospitalId);
    await supabase.from('hospital_treatments').delete().eq('hospital_id', hospitalId).eq('source', 'web_analysis');
    await supabase.from('hospital_pricing').delete().eq('hospital_id', hospitalId);

    // PASS 1: Text crawl
    const mainHtml = await fetchPage(website);
    if (!mainHtml) return false;

    const textParts = [extractTextFromHtml(mainHtml, MAX_TEXT)];
    let allEmails = extractEmailsFromHtml(mainHtml);
    const phones = extractPhonesFromHtml(mainHtml);
    const allImages: string[] = extractImageUrls(mainHtml, website);

    const subpages = findSubpageUrls(mainHtml, website);
    const crawledUrls: string[] = [];

    for (const sp of subpages.slice(0, 10)) {
      const spHtml = await fetchPage(sp.url);
      if (!spHtml) continue;
      crawledUrls.push(sp.url);
      textParts.push(extractTextFromHtml(spHtml, MAX_TEXT));
      allEmails = [...allEmails, ...extractEmailsFromHtml(spHtml)];
      allImages.push(...extractImageUrls(spHtml, sp.url));
      await delayWithJitter(300, 200);
    }

    const combinedText = textParts.join('\n\n').slice(0, MAX_TEXT);
    allEmails = [...new Set(allEmails)];
    const email = pickBestEmail(allEmails);

    // 변동 감지 (Stage 5 선행 체크)
    const equipmentNames = extractKnownKeywords(combinedText).map((k) => k.standardName);
    const changeResult = await detectChanges(hospitalId, combinedText, null, equipmentNames, []);

    if (!changeResult.isFirstCrawl && !changeResult.hasTextChanged) {
      stats.skippedNoChange++;
      log.info(`  → 텍스트 변동 없음 (skip)`);
      return true;
    }

    // Gemini text analysis
    const textAnalysis = await analyzeWithGemini(combinedText, hospitalId);
    if (!textAnalysis) return false;

    // Image OCR
    let finalAnalysis = textAnalysis;
    const filtered = filterLikelyContentImages([...new Set(allImages)]);
    const downloaded = await downloadImages(filtered, 3);
    if (downloaded.length > 0) {
      const inputs: ImageInput[] = downloaded.map((d) => ({ base64: d.base64, mimeType: d.mimeType, url: d.url }));
      const imgOcr = await analyzeAllImages(inputs, hospitalId);
      finalAnalysis = mergeOcrIntoAnalysis(textAnalysis, imgOcr);
    }

    // PASS 2: Screenshot OCR (변동 감지 기반 선택적 실행)
    let p2NewEq = 0;
    let p2NewTr = 0;
    const shouldRunOcr = !TEXT_ONLY && changeResult.shouldRunOcr;

    if (shouldRunOcr) {
      try {
        const screenshotUrls = [website, ...subpages.filter((s) => s.type === 'treatment').slice(0, 3).map((s) => s.url)];
        const ocrResult = await screenshotOcr(screenshotUrls, hospitalId, 4);
        stats.tokensInput += ocrResult.tokensUsed.input;
        stats.tokensOutput += ocrResult.tokensUsed.output;

        const merged = mergeScreenshotOcr(finalAnalysis, ocrResult.equipments, ocrResult.treatments);
        finalAnalysis = merged.result;
        p2NewEq = merged.stats.newEquipments;
        p2NewTr = merged.stats.newTreatments;
      } catch {
        // Non-fatal
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Stage 2: 정규화
    // ═══════════════════════════════════════════════════════════════
    const eqNames = finalAnalysis.equipments.map((e) => e.equipment_name);
    const trNames = finalAnalysis.treatments.map((t) => t.treatment_name);
    const eqNorm = normalizeEquipmentNames(eqNames);
    const trNorm = normalizeTreatmentNames(trNames);

    const totalItems = eqNorm.normalized.length + trNorm.normalized.length;
    const matchedItems = eqNorm.normalized.filter((n) => n.standardName).length
      + trNorm.normalized.filter((n) => n.standardName).length;
    const matchRate = totalItems > 0 ? matchedItems / totalItems : 0;

    // ═══════════════════════════════════════════════════════════════
    // Stage 3: 합성어 분해
    // ═══════════════════════════════════════════════════════════════
    const unmatchedAll = [...eqNorm.unmatched, ...trNorm.unmatched];
    const decompResult = await decomposeAll(unmatchedAll, hospitalId);

    // ═══════════════════════════════════════════════════════════════
    // Stage 4: 가격 파싱
    // ═══════════════════════════════════════════════════════════════
    const priceResult = parsePrices(combinedText);

    // ═══════════════════════════════════════════════════════════════
    // Stage 5: 저장
    // ═══════════════════════════════════════════════════════════════

    // Save JSON
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      path.join(DATA_DIR, `${hospitalId}.json`),
      JSON.stringify({
        hospitalId, success: true, website, text: combinedText, email,
        emails: allEmails, phones, subpagesCrawled: crawledUrls,
        crawledAt: new Date().toISOString(), analysis: finalAnalysis,
        normalization: { matchRate, unmatched: unmatchedAll },
        compounds: { newCandidates: decompResult.newCandidates },
        pricing: { count: priceResult.prices.length },
      }, null, 2),
      'utf-8'
    );

    // DB Upload: doctors
    for (const dr of finalAnalysis.doctors) {
      if (!dr.name) continue;
      await supabase.from('hospital_doctors').insert({
        hospital_id: hospitalId, name: dr.name, title: dr.title ?? null,
        specialty: dr.specialty ?? null, career: dr.career ?? [], education: [],
        source: 'web_analysis',
      });
    }

    // DB Upload: equipments
    for (let i = 0; i < finalAnalysis.equipments.length; i++) {
      const eq = finalAnalysis.equipments[i];
      const norm = eqNorm.normalized[i];
      await supabase.from('hospital_equipments').insert({
        hospital_id: hospitalId,
        equipment_name: norm?.standardName ?? eq.equipment_name,
        equipment_brand: eq.equipment_brand, equipment_category: norm?.category ?? eq.equipment_category,
        equipment_model: eq.equipment_model, estimated_year: eq.estimated_year,
        manufacturer: eq.manufacturer ?? null, is_confirmed: false, source: 'web_analysis',
      });
    }

    // DB Upload: treatments
    for (let i = 0; i < finalAnalysis.treatments.length; i++) {
      const t = finalAnalysis.treatments[i];
      await supabase.from('hospital_treatments').insert({
        hospital_id: hospitalId, treatment_name: t.treatment_name,
        treatment_category: t.treatment_category, price_min: t.price_min,
        price_max: t.price_max, price: t.price ?? null, price_event: t.price_event ?? null,
        original_treatment_name: t.original_name ?? null,
        is_promoted: t.is_promoted, source: 'web_analysis',
      });
    }

    // DB Upload: hospital_pricing (v3.1 신규)
    for (const price of priceResult.prices) {
      if (price.isOutlier) continue; // 이상치 제외
      const row = toHospitalPricingRow(price, hospitalId);
      await supabase.from('hospital_pricing').insert(row);
    }

    // Update hospital contact
    if (email) await supabase.from('hospitals').update({ email }).eq('id', hospitalId);
    if (phones.length > 0) await supabase.from('hospitals').update({ phone: phones[0] }).eq('id', hospitalId);

    // crawl_snapshots 저장 (이벤트 컨텍스트 포함 — 황금 데이터)
    // pass1_text_hash에는 stripped 해시 저장 (비용 방어용 비교 기준)
    await saveSnapshot(hospitalId, {
      tier,
      textHash: changeResult.currentHashes.strippedHash,
      ocrHash: changeResult.currentHashes.ocrHash,
      equipmentsFound: finalAnalysis.equipments.map((e) => e.equipment_name),
      treatmentsFound: finalAnalysis.treatments.map((t) => t.treatment_name),
      pricingFound: priceResult.prices.map((p) => ({
        name: p.treatmentName, price: p.totalPrice, unitPrice: p.unitPrice,
      })),
      eventPricingSnapshot: priceResult.prices
        .filter((p) => p.isEventPrice)
        .map((p) => ({
          standardName: p.standardName,
          treatmentName: p.treatmentName,
          totalPrice: p.totalPrice,
          unitPrice: p.unitPrice,
          eventLabel: p.eventContext.label,
          eventConditions: p.eventContext.conditions,
          eventEndDate: p.eventContext.endDate,
          isEventPrice: true,
        })),
      newCompounds: decompResult.newCandidates,
      diffSummary: changeResult.diffSummary,
    });

    // ═══════════════════════════════════════════════════════════════
    // Stage 6: 변동 감지 + 시그널 분류
    // ═══════════════════════════════════════════════════════════════
    try {
      const currEquipNames = finalAnalysis.equipments.map((e) => e.equipment_name);
      const currTreatNames = finalAnalysis.treatments.map((t) => t.treatment_name);

      const equipChanges = await detectEquipmentChanges(
        hospitalId,
        changeResult.previousSnapshot,
        currEquipNames,
        currTreatNames
      );

      if (equipChanges.length > 0) {
        log.info(`  → 변동 감지: ${equipChanges.length}건 (${equipChanges.map((c) => `${c.change_type}:${c.item_name}`).join(', ')})`);

        // 등록된 모든 제품에 대해 시그널 분류
        const { data: products } = await supabase
          .from('products')
          .select('id, scoring_criteria')
          .eq('status', 'active');

        for (const product of (products ?? [])) {
          const criteria = product.scoring_criteria as ScoringCriteriaV31 | null;
          const rules = criteria?.sales_signals as SalesSignalRule[] | undefined;
          if (!rules || rules.length === 0) continue;

          const signals = await classifySignals(equipChanges, product.id as string, rules);
          if (signals.length > 0) {
            log.info(`  → 시그널 ${signals.length}건 (product=${product.id}): ${signals.map((s) => s.title).join(', ')}`);
          }
        }
      }
    } catch {
      // Stage 6 실패는 non-fatal
    }

    // Stats
    stats.totalEquipments += finalAnalysis.equipments.length;
    stats.totalTreatments += finalAnalysis.treatments.length;
    stats.totalDoctors += finalAnalysis.doctors.length;
    stats.totalPrices += priceResult.prices.length;
    stats.pass2NewEquipments += p2NewEq;
    stats.pass2NewTreatments += p2NewTr;
    stats.normalizerMatchRate += matchRate;
    stats.newCompoundCandidates += decompResult.newCandidates.length;

    return true;
  } catch (err) {
    log.warn(`Error processing ${hospitalId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main(): Promise<void> {
  log.info('=== Batch Pipeline v3.1 (5-Stage) ===');
  log.info(`Mode: ${TEXT_ONLY ? 'text-only' : 'full (text + screenshot)'} | limit=${LIMIT} offset=${OFFSET}`);
  if (TIER_FILTER) log.info(`Tier filter: ${TIER_FILTER}`);
  if (PROXY_URL) log.info(`Proxy: ${PROXY_URL}`);
  if (DRY_RUN) log.info('DRY RUN — estimating costs only');

  // Find hospitals to process
  let query = supabase
    .from('hospitals')
    .select('id, name, website, crawled_at')
    .eq('status', 'active')
    .eq('is_target', true)
    .not('website', 'is', null);

  if (SOURCE) query = query.eq('source' as string, SOURCE);

  query = query.order('data_quality_score', { ascending: true }).range(OFFSET, OFFSET + LIMIT - 1);

  const { data: hospitals, error } = await query;
  if (error || !hospitals) {
    log.error(`Query failed: ${error?.message}`);
    process.exit(1);
  }

  // 프로파일 등급 조회하여 티어 결정
  interface HospitalWithTier {
    id: string;
    name: string;
    website: string;
    crawled_at: string | null;
    tier: string;
  }

  const hospitalsWithTier: HospitalWithTier[] = [];

  for (const h of hospitals) {
    const { data: profile } = await supabase
      .from('hospital_profiles')
      .select('profile_grade')
      .eq('hospital_id', h.id)
      .limit(1)
      .single();

    const tier = determineTier(profile?.profile_grade ?? null);
    hospitalsWithTier.push({ ...h, website: h.website!, tier });
  }

  // 티어 필터
  let filtered = hospitalsWithTier;
  if (TIER_FILTER) {
    filtered = filtered.filter((h) => h.tier === TIER_FILTER);
  }

  // 크롤링 주기 필터
  const toProcess = filtered.filter((h) => shouldCrawl(h.tier, h.crawled_at));

  log.info(`Found ${hospitals.length} candidates → ${filtered.length} (tier) → ${toProcess.length} (schedule)`);

  if (DRY_RUN) {
    const tierCounts = { tier1: 0, tier2: 0, tier3: 0 };
    for (const h of toProcess) tierCounts[h.tier as keyof typeof tierCounts]++;

    const pagesPerHospital = TEXT_ONLY ? 0 : 4;
    const tokensPerHospital = 18000 + 4000 * 3 + 4000 * pagesPerHospital;
    const totalTokens = toProcess.length * tokensPerHospital;
    const estimatedCost = (totalTokens / 1_000_000) * 0.10 + (toProcess.length * 3000 / 1_000_000) * 0.40;

    log.info('\n=== Cost Estimate ===');
    log.info(`Hospitals: ${toProcess.length} (tier1=${tierCounts.tier1} tier2=${tierCounts.tier2} tier3=${tierCounts.tier3})`);
    log.info(`Estimated cost: $${estimatedCost.toFixed(2)} (₩${Math.round(estimatedCost * 1450).toLocaleString()})`);
    log.info(`Estimated time: ${Math.round(toProcess.length * (TEXT_ONLY ? 15 : 60) / 60)} min`);
    return;
  }

  const stats: BatchStats = {
    processed: 0, succeeded: 0, failed: 0,
    skippedBySchedule: filtered.length - toProcess.length,
    skippedNoChange: 0,
    totalEquipments: 0, totalTreatments: 0, totalDoctors: 0, totalPrices: 0,
    pass2NewEquipments: 0, pass2NewTreatments: 0,
    normalizerMatchRate: 0, newCompoundCandidates: 0,
    tokensInput: 0, tokensOutput: 0,
  };

  for (let i = 0; i < toProcess.length; i++) {
    const h = toProcess[i];
    stats.processed++;
    log.info(`\n[${i + 1}/${toProcess.length}] ${h.name} (${h.tier}) — ${h.website}`);

    const ok = await processHospital(h.id, h.website, h.tier, stats);
    if (ok) stats.succeeded++;
    else stats.failed++;

    // crawled_at 업데이트
    await supabase.from('hospitals').update({ crawled_at: new Date().toISOString() }).eq('id', h.id);

    await delayWithJitter(DELAY_BETWEEN_HOSPITALS, 1000);
  }

  await closeBrowser();

  // Final report
  const costInput = (stats.tokensInput / 1_000_000) * 0.10;
  const costOutput = (stats.tokensOutput / 1_000_000) * 0.40;
  const totalCost = costInput + costOutput;
  const avgMatchRate = stats.succeeded > 0 ? (stats.normalizerMatchRate / stats.succeeded * 100).toFixed(1) : '0';

  log.info('\n══════ BATCH RESULT (v3.1) ══════');
  log.info(`Processed: ${stats.processed} | Success: ${stats.succeeded} | Failed: ${stats.failed}`);
  log.info(`Skipped: schedule=${stats.skippedBySchedule} noChange=${stats.skippedNoChange}`);
  log.info(`Equipments: ${stats.totalEquipments} (pass2: +${stats.pass2NewEquipments})`);
  log.info(`Treatments: ${stats.totalTreatments} (pass2: +${stats.pass2NewTreatments})`);
  log.info(`Doctors:    ${stats.totalDoctors}`);
  log.info(`Prices:     ${stats.totalPrices} (hospital_pricing rows)`);
  log.info(`Normalizer: avg match rate ${avgMatchRate}%`);
  log.info(`Compounds:  ${stats.newCompoundCandidates} new candidates`);
  log.info(`OCR tokens: in=${stats.tokensInput} out=${stats.tokensOutput}`);
  log.info(`OCR cost:   $${totalCost.toFixed(4)} (₩${Math.round(totalCost * 1450).toLocaleString()})`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
