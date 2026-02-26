/**
 * v5.7 배치 결과 분석 스크립트
 *
 * recrawl-v5.ts 배치 실행 후 output/{hospitalId}_analysis.json 파일들을 분석하여:
 * 1. output/v57-batch-summary.json — 49개 병원 전체 요약 통계
 * 2. output/v57-unmatched-devices.json — 미등록 장비 목록 (사전 v1.4 입력)
 *
 * 실행: npx tsx scripts/v57-batch-analyze.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEquipmentNormalizationMap, getEquipmentCategoryMap } from './crawler/dictionary-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

interface AnalysisFile {
  hospital_name: string;
  doctors: Array<{ name: string; title?: string; confidence?: string }>;
  academic_activities: unknown[];
  medical_devices: Array<{
    name: string;
    korean_name?: string;
    manufacturer?: string;
    device_type: string;
    subcategory: string;
    source?: string;
  }>;
  treatments: Array<{
    name: string;
    category?: string;
    price?: number | null;
    regular_price?: number | null;
    event_price?: number | null;
    source?: string;
  }>;
  events: unknown[];
  contact_info?: {
    phone?: Array<{ number: string }>;
    email?: Array<{ address: string }>;
    kakao_channel?: string;
    instagram?: string;
    youtube?: string;
    blog?: string;
  };
  extraction_summary?: {
    total_doctors: number;
    total_academic: number;
    total_equipment: number;
    total_treatments: number;
    total_events: number;
    total_categories: number;
    price_available_ratio: string;
  };
}

interface HospitalSummary {
  hospitalId: string;
  hospitalName: string;
  totalDevices: number;
  deviceOnly: number;
  injectableOnly: number;
  matchedDevices: number;
  unmatchedDevices: number;
  matchRate: string;
  totalTreatments: number;
  pricedTreatments: number;
  nongeubyeoTreatments: number;
  eventTreatments: number;
  doctors: number;
  events: number;
  phone: string;
  kakao: string;
  instagram: string;
  sourceDist: Record<string, number>;
  unmatchedList: string[];
}

function analyzeAll(): void {
  const normMap = getEquipmentNormalizationMap();
  const catMap = getEquipmentCategoryMap();
  console.log(`📖 사전 로드: normMap ${normMap.size}항목, catMap ${catMap.size}항목`);

  // output 디렉토리에서 *_analysis.json 파일 수집
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('_analysis.json'))
    .sort();

  console.log(`📂 분석 파일: ${files.length}개\n`);

  if (files.length === 0) {
    console.log('❌ output/ 디렉토리에 *_analysis.json 파일이 없습니다.');
    console.log('   먼저 npx tsx scripts/recrawl-v5.ts --ocr 로 배치 실행하세요.');
    return;
  }

  const summaries: HospitalSummary[] = [];
  const allUnmatched: Array<{ device: string; hospitals: string[] }> = [];
  const unmatchedMap = new Map<string, Set<string>>();

  for (const file of files) {
    const hospitalId = file.replace('_analysis.json', '');
    const filePath = path.resolve(OUTPUT_DIR, file);

    let data: AnalysisFile;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      console.log(`  ⚠️ ${file} 파싱 실패 — 스킵`);
      continue;
    }

    const hospitalName = data.hospital_name || hospitalId;
    const devices = data.medical_devices || [];
    const treatments = data.treatments || [];
    const doctors = data.doctors || [];

    // 장비/주사제 분리
    const deviceOnly = devices.filter(d => d.device_type === 'device');
    const injectableOnly = devices.filter(d => d.device_type === 'injectable');

    // 사전 매칭 (device만 — injectable은 제외)
    let matched = 0;
    let unmatched = 0;
    const unmatchedList: string[] = [];

    for (const d of deviceOnly) {
      const key = d.name.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
      const korKey = d.korean_name?.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
      if (normMap.has(key) || normMap.has(d.name.toLowerCase()) || (korKey && normMap.has(korKey))) {
        matched++;
      } else {
        unmatched++;
        unmatchedList.push(d.name);

        // 전역 미등록 집계
        const normKey = d.name.toLowerCase().trim();
        if (!unmatchedMap.has(normKey)) unmatchedMap.set(normKey, new Set());
        unmatchedMap.get(normKey)!.add(hospitalName);
      }
    }

    // 시술 가격 분석
    const pricedTreatments = treatments.filter(t =>
      t.price || t.regular_price || t.event_price
    ).length;
    const nongeubyeoTreatments = treatments.filter(t => t.source === 'nongeubyeo').length;
    const eventTreatments = treatments.filter(t => t.source === 'landing' || t.source === 'event').length;

    // source 분포
    const sourceDist: Record<string, number> = {};
    for (const t of treatments) {
      const src = t.source || 'website';
      sourceDist[src] = (sourceDist[src] || 0) + 1;
    }

    const ci = data.contact_info;
    const matchRate = deviceOnly.length > 0
      ? `${((matched / deviceOnly.length) * 100).toFixed(0)}%`
      : 'N/A';

    summaries.push({
      hospitalId,
      hospitalName,
      totalDevices: devices.length,
      deviceOnly: deviceOnly.length,
      injectableOnly: injectableOnly.length,
      matchedDevices: matched,
      unmatchedDevices: unmatched,
      matchRate,
      totalTreatments: treatments.length,
      pricedTreatments,
      nongeubyeoTreatments,
      eventTreatments,
      doctors: doctors.length,
      events: (data.events || []).length,
      phone: ci?.phone?.[0]?.number || '(없음)',
      kakao: ci?.kakao_channel || '(없음)',
      instagram: ci?.instagram || '(없음)',
      sourceDist,
      unmatchedList,
    });

    console.log(`  ✅ ${hospitalName}: 장비 ${deviceOnly.length}(${matchRate} 매칭) | 시술 ${treatments.length}(가격 ${pricedTreatments}) | 의사 ${doctors.length}`);
  }

  // ── v57-batch-summary.json 저장 ──
  const summaryPath = path.resolve(OUTPUT_DIR, 'v57-batch-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summaries, null, 2));
  console.log(`\n📊 배치 요약 저장: ${summaryPath} (${summaries.length}개 병원)`);

  // ── v57-unmatched-devices.json 저장 ──
  const unmatchedDevices = [...unmatchedMap.entries()]
    .map(([device, hospitals]) => ({
      device,
      count: hospitals.size,
      hospitals: [...hospitals].sort(),
    }))
    .sort((a, b) => b.count - a.count);

  const unmatchedPath = path.resolve(OUTPUT_DIR, 'v57-unmatched-devices.json');
  fs.writeFileSync(unmatchedPath, JSON.stringify(unmatchedDevices, null, 2));
  console.log(`📊 미등록 장비 저장: ${unmatchedPath} (${unmatchedDevices.length}종)`);

  // ── 통계 출력 ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  v5.7 배치 분석 결과');
  console.log('═══════════════════════════════════════════════════\n');

  const totalHospitals = summaries.length;
  const avgTreatments = totalHospitals > 0
    ? (summaries.reduce((s, h) => s + h.totalTreatments, 0) / totalHospitals).toFixed(1) : '0';
  const avgDevices = totalHospitals > 0
    ? (summaries.reduce((s, h) => s + h.deviceOnly, 0) / totalHospitals).toFixed(1) : '0';
  const avgDoctors = totalHospitals > 0
    ? (summaries.reduce((s, h) => s + h.doctors, 0) / totalHospitals).toFixed(1) : '0';
  const totalMatched = summaries.reduce((s, h) => s + h.matchedDevices, 0);
  const totalDeviceOnly = summaries.reduce((s, h) => s + h.deviceOnly, 0);
  const overallMatchRate = totalDeviceOnly > 0
    ? `${((totalMatched / totalDeviceOnly) * 100).toFixed(1)}%` : 'N/A';

  console.log(`병원 수: ${totalHospitals}`);
  console.log(`평균 시술: ${avgTreatments}건/병원`);
  console.log(`평균 장비: ${avgDevices}개/병원`);
  console.log(`평균 의사: ${avgDoctors}명/병원`);
  console.log(`전체 장비 매칭률: ${overallMatchRate} (${totalMatched}/${totalDeviceOnly})`);
  console.log(`미등록 장비: ${unmatchedDevices.length}종`);

  // 2개 이상 병원에서 출현한 미등록 장비
  const multiHospital = unmatchedDevices.filter(d => d.count >= 2);
  if (multiHospital.length > 0) {
    console.log(`\n🔍 2개+ 병원에서 출현한 미등록 장비 (사전 추가 후보):`);
    for (const d of multiHospital.slice(0, 30)) {
      console.log(`  ${d.device} (${d.count}곳): ${d.hospitals.join(', ')}`);
    }
  }

  // 가격 0건 병원
  const zeroPriceHospitals = summaries.filter(h => h.pricedTreatments === 0);
  if (zeroPriceHospitals.length > 0) {
    console.log(`\n⚠️ 가격 0건 병원 (${zeroPriceHospitals.length}곳):`);
    for (const h of zeroPriceHospitals) {
      console.log(`  ${h.hospitalName}: 시술 ${h.totalTreatments}건 (가격 미공개 또는 크롤 실패)`);
    }
  }
}

analyzeAll();
