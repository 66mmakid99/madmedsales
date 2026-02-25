/**
 * CRM 병원 강제 크롤링.
 *
 * 배치 파이프라인의 스케줄 체크를 무시하고,
 * CRM 매칭된 병원만 run-single-pipeline 방식으로 크롤링.
 *
 * Usage: npx tsx scripts/crm-force-crawl.ts [--limit 5] [--offset 0]
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from './utils/supabase.js';
import { createLogger } from './utils/logger.js';
import { delayWithJitter } from './utils/delay.js';
import {
  extractTextFromHtml,
  extractEmailsFromHtml,
  extractPhonesFromHtml,
  pickBestEmail,
  extractImageUrls,
} from './crawler/html-extractor.js';
import { findSubpageUrls } from './crawler/subpage-finder.js';
import { analyzeWithGemini, type WebAnalysisResult } from './analysis/analyze-web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const log = createLogger('crm-crawl');
const DATA_DIR = path.resolve(__dirname, 'data/web-raw');
const MAX_TEXT = 150000;
const REQUEST_TIMEOUT = 15000;

function getArg(flag: string, defaultVal: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : defaultVal;
}
const LIMIT = parseInt(getArg('--limit', '30'), 10);
const OFFSET = parseInt(getArg('--offset', '0'), 10);

async function fetchPage(url: string): Promise<string | null> {
  try {
    let fullUrl = url;
    if (!fullUrl.startsWith('http')) fullUrl = `https://${fullUrl}`;
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
  } catch {
    return null;
  }
}

// 블로그/SNS URL 필터
function isActualWebsite(url: string): boolean {
  const skip = ['instagram.com', 'blog.naver.com', 'cafe.naver.com', 'pf.kakao.com', 'booking.naver.com', 'youtube.com', 'facebook.com'];
  return !skip.some((s) => url.includes(s));
}

async function processHospital(hospitalId: string, name: string, website: string): Promise<{ equipments: number; treatments: number; doctors: number } | null> {
  const emptyAnalysis: WebAnalysisResult = { doctors: [], equipments: [], treatments: [], hospital_profile: { main_focus: '', target_audience: '' }, contact_info: { emails: [], phones: [], contact_page_url: null } };

  // Clear old data
  await supabase.from('hospital_doctors').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_equipments').delete().eq('hospital_id', hospitalId);
  await supabase.from('hospital_treatments').delete().eq('hospital_id', hospitalId).eq('source', 'web_analysis');

  // Crawl main page
  const mainHtml = await fetchPage(website);
  if (!mainHtml) {
    log.warn(`  텍스트 크롤링 실패`);
    return null;
  }

  const textParts = [extractTextFromHtml(mainHtml, MAX_TEXT)];
  let allEmails = extractEmailsFromHtml(mainHtml);
  const phones = extractPhonesFromHtml(mainHtml);
  const allImages: string[] = extractImageUrls(mainHtml, website);
  const crawledSubpages: string[] = [];

  const subpages = findSubpageUrls(mainHtml, website);
  log.info(`  서브페이지: ${subpages.length}개`);

  for (const sp of subpages.slice(0, 8)) {
    const spHtml = await fetchPage(sp.url);
    if (!spHtml) continue;
    crawledSubpages.push(sp.url);
    textParts.push(extractTextFromHtml(spHtml, MAX_TEXT));
    allEmails = [...allEmails, ...extractEmailsFromHtml(spHtml)];
    allImages.push(...extractImageUrls(spHtml, sp.url));
    await delayWithJitter(300, 200);
  }

  const combinedText = textParts.join('\n\n').slice(0, MAX_TEXT);
  allEmails = [...new Set(allEmails)];
  const email = pickBestEmail(allEmails);

  log.info(`  텍스트: ${combinedText.length}자, 이메일: ${allEmails.length}개`);

  if (combinedText.length < 100) {
    log.warn(`  텍스트 부족 (${combinedText.length}자) — skip`);
    return null;
  }

  // Gemini analysis
  log.info(`  Gemini 분석 중...`);
  const analysis = await analyzeWithGemini(combinedText, hospitalId);
  const finalAnalysis = analysis ?? emptyAnalysis;

  // Save JSON
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, `${hospitalId}.json`),
    JSON.stringify({
      hospitalId, success: true, website, text: combinedText, email,
      emails: allEmails, phones, subpagesCrawled: crawledSubpages,
      crawledAt: new Date().toISOString(), analysis: finalAnalysis,
    }, null, 2),
    'utf-8'
  );

  // DB Upload
  let drCount = 0;
  for (const dr of finalAnalysis.doctors) {
    if (!dr.name) continue;
    const { error } = await supabase.from('hospital_doctors').insert({
      hospital_id: hospitalId, name: dr.name, title: dr.title ?? null,
      specialty: dr.specialty ?? null, career: dr.career ?? [], education: [],
      source: 'web_analysis',
    });
    if (!error) drCount++;
  }

  let eqCount = 0;
  for (const eq of finalAnalysis.equipments) {
    const { error } = await supabase.from('hospital_equipments').insert({
      hospital_id: hospitalId, equipment_name: eq.equipment_name,
      equipment_brand: eq.equipment_brand, equipment_category: eq.equipment_category,
      equipment_model: eq.equipment_model, estimated_year: eq.estimated_year,
      manufacturer: eq.manufacturer ?? null, is_confirmed: false, source: 'web_analysis',
    });
    if (!error) eqCount++;
  }

  let trCount = 0;
  for (const t of finalAnalysis.treatments) {
    const { error } = await supabase.from('hospital_treatments').insert({
      hospital_id: hospitalId, treatment_name: t.treatment_name,
      treatment_category: t.treatment_category, price_min: t.price_min,
      price_max: t.price_max, price: t.price ?? null, price_event: t.price_event ?? null,
      original_treatment_name: t.original_name ?? null,
      is_promoted: t.is_promoted, source: 'web_analysis',
    });
    if (!error) trCount++;
  }

  // Update hospital contact
  if (email) await supabase.from('hospitals').update({ email }).eq('id', hospitalId);
  if (phones.length > 0) await supabase.from('hospitals').update({ phone: phones[0] }).eq('id', hospitalId);
  await supabase.from('hospitals').update({ crawled_at: new Date().toISOString() }).eq('id', hospitalId);

  return { equipments: eqCount, treatments: trCount, doctors: drCount };
}

async function main(): Promise<void> {
  log.info('=== CRM 병원 강제 크롤링 ===');
  log.info(`limit=${LIMIT} offset=${OFFSET}`);

  // CRM 매칭된 병원 + hospitals.website 조회
  const { data: crmHospitals } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id')
    .not('sales_hospital_id', 'is', null)
    .order('name')
    .range(OFFSET, OFFSET + LIMIT - 1);

  if (!crmHospitals || crmHospitals.length === 0) {
    log.info('매칭된 CRM 병원 없음');
    return;
  }

  const hospitalIds = crmHospitals.map((h) => h.sales_hospital_id).filter(Boolean);
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .in('id', hospitalIds);

  const hospitalMap = new Map((hospitals ?? []).map((h) => [h.id, h]));

  // 실제 website가 있고 블로그/SNS가 아닌 것만 필터
  interface CrawlTarget {
    crmName: string;
    hospitalId: string;
    hospitalName: string;
    website: string;
  }

  const targets: CrawlTarget[] = [];
  for (const crm of crmHospitals) {
    const main = hospitalMap.get(crm.sales_hospital_id);
    if (!main?.website) continue;
    if (!isActualWebsite(main.website)) {
      log.info(`  ⚠️ ${crm.name} — 블로그/SNS URL skip (${main.website})`);
      continue;
    }
    targets.push({ crmName: crm.name, hospitalId: main.id, hospitalName: main.name, website: main.website });
  }

  log.info(`크롤링 대상: ${targets.length}개 (블로그/SNS 제외)\n`);

  let success = 0;
  let fail = 0;
  let totalEq = 0;
  let totalTr = 0;
  let totalDr = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    log.info(`\n[${i + 1}/${targets.length}] ${t.crmName} → ${t.website}`);

    const result = await processHospital(t.hospitalId, t.hospitalName, t.website);
    if (result) {
      success++;
      totalEq += result.equipments;
      totalTr += result.treatments;
      totalDr += result.doctors;
      log.info(`  ✅ 장비=${result.equipments} 시술=${result.treatments} 의사=${result.doctors}`);
    } else {
      fail++;
      log.info(`  ❌ 실패`);
    }

    await delayWithJitter(2000, 1000);
  }

  log.info('\n══════ CRM 크롤링 결과 ══════');
  log.info(`성공: ${success}/${targets.length}`);
  log.info(`실패: ${fail}`);
  log.info(`장비: ${totalEq}, 시술: ${totalTr}, 의사: ${totalDr}`);
}

main().catch((err) => {
  log.error('Fatal:', err);
  process.exit(1);
});
