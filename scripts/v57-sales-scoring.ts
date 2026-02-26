/**
 * v5.7 세일즈 앵글 매칭 엔진
 *
 * Phase 2: 병원별 JSON 데이터 → 4축 프로파일링 → 5카테고리 TORR RF 세일즈 앵글 매칭
 *
 * 4축 병원 프로파일링:
 *   1. Investment (투자성향): 고가 장비 보유 수, 최신 장비 비율, 장비 다양성
 *   2. Portfolio (시술 포트폴리오): 시술 종류 수, RF/리프팅 관련 시술 비중, 가격대
 *   3. Scale (규모): 의사 수, 시술 가격 총량
 *   4. Marketing (마케팅 활동): SNS 활성도, 이벤트 가격 비중
 *
 * 5카테고리 TORR RF 세일즈 앵글:
 *   1. 업그레이드: 구형 RF 장비 보유 → "기존 장비 대비 시술 시간 50% 단축"
 *   2. 포트폴리오 확장: RF 미보유, 리프팅 있음 → "리프팅 라인업에 RF 추가"
 *   3. 프리미엄 포지셔닝: 고가 시술 중심 → "최고급 RF로 프리미엄 가격 정당화"
 *   4. 비용 효율: 중소규모, 가격 경쟁 → "회당 소모품 비용 절감"
 *   5. 신규 도입: 개원 초기/장비 적음 → "첫 RF 장비로 검증된 TORR RF"
 *
 * 실행: npx tsx scripts/v57-sales-scoring.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEquipmentNormalizationMap, getEquipmentCategoryMap } from './crawler/dictionary-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

// ═══════════════════════════════════════════
// 타입 정의
// ═══════════════════════════════════════════

interface MedicalDevice {
  name: string;
  korean_name?: string;
  manufacturer?: string;
  device_type: string;
  subcategory: string;
  source?: string;
}

interface Treatment {
  name: string;
  category?: string;
  price?: number | null;
  regular_price?: number | null;
  event_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  source?: string;
}

interface Doctor {
  name: string;
  title?: string;
  specialty?: string;
  confidence?: string;
}

interface ContactInfo {
  phone?: Array<{ number: string }>;
  email?: Array<{ address: string }>;
  kakao_channel?: string;
  instagram?: string;
  youtube?: string;
  blog?: string;
  naver_booking?: string;
}

interface AnalysisFile {
  hospital_name: string;
  doctors: Doctor[];
  medical_devices: MedicalDevice[];
  treatments: Treatment[];
  events: unknown[];
  contact_info?: ContactInfo;
}

interface AxisScores {
  investment: number;
  portfolio: number;
  scale: number;
  marketing: number;
}

type SalesAngle = 'upgrade' | 'portfolio_expand' | 'premium' | 'cost_efficiency' | 'new_adoption';

interface SalesAngleResult {
  angle: SalesAngle;
  score: number;
  reason: string;
}

interface HospitalProfile {
  hospitalId: string;
  hospitalName: string;
  axisScores: AxisScores;
  overallScore: number;
  grade: 'S' | 'A' | 'B' | 'C';
  salesAngles: SalesAngleResult[];
  primaryAngle: SalesAngleResult;
  briefing: string;
  // 원시 데이터 요약
  deviceCount: number;
  rfDevices: string[];
  hifuDevices: string[];
  treatmentCount: number;
  liftingTreatmentCount: number;
  avgPrice: number | null;
  doctorCount: number;
  snsChannels: string[];
  hasOldRf: boolean;
  hasTorrRf: boolean;
}

// ═══════════════════════════════════════════
// 고가 장비 목록 (투자성향 지표)
// ═══════════════════════════════════════════
const PREMIUM_DEVICES = new Set([
  'thermage', 'ulthera', 'sofwave', 'picosure', 'picoway',
  'gentlemax', 'm22', 'inmode', 'oligio',
]);

const OLD_RF_DEVICES = new Set([
  'thermage',  // CPT 이전 모델
]);

const RF_SUBCATS = new Set(['rf', 'RF', 'RF_TIGHTENING', 'rf_tightening']);
const HIFU_SUBCATS = new Set(['hifu', 'HIFU']);
const LIFTING_KEYWORDS = ['리프팅', '타이트닝', '울쎄라', '써마지', '슈링크', '더블로', 'lifting', 'tightening'];

// ═══════════════════════════════════════════
// 4축 스코어링
// ═══════════════════════════════════════════

function scoreInvestment(devices: MedicalDevice[]): number {
  const deviceOnly = devices.filter(d => d.device_type === 'device');
  if (deviceOnly.length === 0) return 5;

  let score = 0;

  // 장비 수 (최대 30점)
  score += Math.min(deviceOnly.length * 3, 30);

  // 고가 장비 보유 (최대 40점)
  const premiumCount = deviceOnly.filter(d =>
    PREMIUM_DEVICES.has(d.name.toLowerCase().split(' ')[0])
  ).length;
  score += Math.min(premiumCount * 10, 40);

  // 장비 다양성 — 카테고리 수 (최대 20점)
  const categories = new Set(deviceOnly.map(d => d.subcategory.toLowerCase()));
  score += Math.min(categories.size * 5, 20);

  // RF 장비 보유 (보너스 10점)
  const hasRf = deviceOnly.some(d => RF_SUBCATS.has(d.subcategory));
  if (hasRf) score += 10;

  return Math.min(Math.round(score), 100);
}

function scorePortfolio(treatments: Treatment[], devices: MedicalDevice[]): number {
  if (treatments.length === 0) return 5;

  let score = 0;

  // 시술 수 (최대 30점)
  score += Math.min(treatments.length * 0.5, 30);

  // RF/리프팅 관련 시술 비중 (최대 30점)
  const liftingCount = treatments.filter(t =>
    LIFTING_KEYWORDS.some(k => t.name.toLowerCase().includes(k))
  ).length;
  const liftingRatio = liftingCount / treatments.length;
  score += Math.round(liftingRatio * 30);

  // 가격대 (최대 25점)
  const prices = treatments
    .map(t => t.price || t.regular_price || t.event_price || 0)
    .filter(p => p > 0);
  if (prices.length > 0) {
    const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
    if (avgPrice >= 500000) score += 25;
    else if (avgPrice >= 200000) score += 15;
    else if (avgPrice >= 50000) score += 10;
    else score += 5;
  }

  // RF 장비 있으면서 리프팅 시술도 있으면 보너스 (15점)
  const hasRfDevice = devices.some(d => RF_SUBCATS.has(d.subcategory) && d.device_type === 'device');
  if (hasRfDevice && liftingCount > 0) score += 15;

  return Math.min(Math.round(score), 100);
}

function scoreScale(doctors: Doctor[], treatments: Treatment[]): number {
  let score = 0;

  // 의사 수 (최대 40점)
  const confirmedDoctors = doctors.filter(d => d.confidence !== 'uncertain' && d.name !== '(학술활동 전용)');
  if (confirmedDoctors.length >= 10) score += 40;
  else if (confirmedDoctors.length >= 5) score += 30;
  else if (confirmedDoctors.length >= 3) score += 20;
  else if (confirmedDoctors.length >= 1) score += 10;

  // 시술 가격 총량 (최대 40점)
  const prices = treatments
    .map(t => t.price || t.regular_price || 0)
    .filter(p => p > 0);
  const totalRevenuePotential = prices.reduce((s, p) => s + p, 0);
  if (totalRevenuePotential >= 50000000) score += 40;
  else if (totalRevenuePotential >= 10000000) score += 30;
  else if (totalRevenuePotential >= 3000000) score += 20;
  else if (totalRevenuePotential > 0) score += 10;

  // 시술 다양성 (최대 20점)
  const categories = new Set(treatments.map(t => t.category || 'other'));
  score += Math.min(categories.size * 4, 20);

  return Math.min(Math.round(score), 100);
}

function scoreMarketing(treatments: Treatment[], contactInfo?: ContactInfo): number {
  let score = 0;

  // SNS 채널 수 (최대 40점)
  let snsCount = 0;
  if (contactInfo) {
    if (contactInfo.kakao_channel) snsCount++;
    if (contactInfo.instagram) snsCount++;
    if (contactInfo.youtube) snsCount++;
    if (contactInfo.blog) snsCount++;
    if (contactInfo.naver_booking) snsCount++;
  }
  score += Math.min(snsCount * 8, 40);

  // 이벤트 가격 비중 (최대 30점)
  const eventTreatments = treatments.filter(t =>
    t.event_price || t.source === 'landing' || t.source === 'event'
  ).length;
  if (treatments.length > 0) {
    const eventRatio = eventTreatments / treatments.length;
    score += Math.round(eventRatio * 30);
  }

  // 가격 공개 비중 (최대 30점 — 가격 공개 = 마케팅 적극성)
  const pricedCount = treatments.filter(t =>
    t.price || t.regular_price || t.event_price
  ).length;
  if (treatments.length > 0) {
    const priceRatio = pricedCount / treatments.length;
    score += Math.round(priceRatio * 30);
  }

  return Math.min(Math.round(score), 100);
}

// ═══════════════════════════════════════════
// 5카테고리 세일즈 앵글 매칭
// ═══════════════════════════════════════════

function matchSalesAngles(
  axis: AxisScores,
  devices: MedicalDevice[],
  treatments: Treatment[],
  doctors: Doctor[],
): SalesAngleResult[] {
  const results: SalesAngleResult[] = [];
  const deviceOnly = devices.filter(d => d.device_type === 'device');
  const rfDevices = deviceOnly.filter(d => RF_SUBCATS.has(d.subcategory));
  const hasRf = rfDevices.length > 0;
  const hasTorr = devices.some(d => d.name.toLowerCase().includes('torr'));
  const hasOldRf = rfDevices.some(d => {
    const baseName = d.name.toLowerCase().split(' ')[0];
    return OLD_RF_DEVICES.has(baseName);
  });
  const hasLifting = treatments.some(t =>
    LIFTING_KEYWORDS.some(k => t.name.toLowerCase().includes(k))
  );

  // 1. 업그레이드: 구형 RF 장비 보유
  if (hasRf && !hasTorr) {
    let score = 60;
    if (hasOldRf) score += 20;
    if (axis.investment >= 50) score += 10;
    if (hasLifting) score += 10;
    const rfNames = rfDevices.map(d => d.name).join(', ');
    results.push({
      angle: 'upgrade',
      score: Math.min(score, 100),
      reason: `RF 장비 보유 (${rfNames}) → TORR RF로 업그레이드 제안. ${hasOldRf ? '구형 모델 교체 시급.' : '추가 RF로 시술 확대.'}`
    });
  }

  // 2. 포트폴리오 확장: RF 미보유, 리프팅 있음
  if (!hasRf && hasLifting) {
    let score = 70;
    if (axis.portfolio >= 50) score += 15;
    if (axis.investment >= 40) score += 15;
    results.push({
      angle: 'portfolio_expand',
      score: Math.min(score, 100),
      reason: `RF 장비 미보유이나 리프팅 시술 진행 중 → RF 라인업 추가로 시술 범위 확대`
    });
  }

  // 3. 프리미엄 포지셔닝: 투자성향 높음 + 고가 시술
  if (axis.investment >= 60 || axis.portfolio >= 60) {
    let score = 50;
    if (axis.investment >= 70) score += 20;
    if (axis.portfolio >= 70) score += 15;
    if (axis.scale >= 50) score += 15;
    results.push({
      angle: 'premium',
      score: Math.min(score, 100),
      reason: `투자성향 ${axis.investment}점/포트폴리오 ${axis.portfolio}점 — 프리미엄 시장 포지셔닝에 적합`
    });
  }

  // 4. 비용 효율: 중소규모 + 가격 경쟁
  if (axis.scale < 50 && axis.marketing >= 30) {
    let score = 55;
    if (axis.scale < 30) score += 15;
    const avgPrice = getAvgPrice(treatments);
    if (avgPrice && avgPrice < 300000) score += 15;
    if (axis.portfolio >= 30) score += 15;
    results.push({
      angle: 'cost_efficiency',
      score: Math.min(score, 100),
      reason: `중소규모 병원 (규모 ${axis.scale}점) — 소모품 비용 절감으로 마진 개선 제안`
    });
  }

  // 5. 신규 도입: 장비 적음/개원 초기
  if (deviceOnly.length < 5 && !hasRf) {
    let score = 60;
    if (deviceOnly.length === 0) score += 20;
    else if (deviceOnly.length < 3) score += 10;
    if (doctors.length <= 2) score += 10;
    results.push({
      angle: 'new_adoption',
      score: Math.min(score, 100),
      reason: `장비 ${deviceOnly.length}개로 초기/소규모 병원 — 첫 RF 장비로 TORR RF 도입 제안`
    });
  }

  // 결과가 없으면 기본 앵글 배정
  if (results.length === 0) {
    if (hasRf) {
      results.push({
        angle: 'upgrade',
        score: 40,
        reason: `RF 장비 보유 — 추가/교체 장비로 TORR RF 제안 (기본 배정)`
      });
    } else if (hasLifting) {
      results.push({
        angle: 'portfolio_expand',
        score: 40,
        reason: `리프팅 시술 가능 — RF 라인업 추가 제안 (기본 배정)`
      });
    } else {
      results.push({
        angle: 'new_adoption',
        score: 30,
        reason: `RF 및 리프팅 정보 부족 — 신규 도입 앵글 (기본 배정)`
      });
    }
  }

  // 점수 내림차순 정렬
  results.sort((a, b) => b.score - a.score);
  return results;
}

function getAvgPrice(treatments: Treatment[]): number | null {
  const prices = treatments
    .map(t => t.price || t.regular_price || t.event_price || 0)
    .filter(p => p > 0);
  if (prices.length === 0) return null;
  return Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
}

function getGrade(score: number): 'S' | 'A' | 'B' | 'C' {
  if (score >= 75) return 'S';
  if (score >= 55) return 'A';
  if (score >= 35) return 'B';
  return 'C';
}

function buildBriefing(profile: HospitalProfile): string {
  const lines: string[] = [];
  lines.push(`■ ${profile.hospitalName} — ${profile.grade}등급 (${profile.overallScore}점)`);
  lines.push(`  4축: 투자${profile.axisScores.investment} | 포트폴리오${profile.axisScores.portfolio} | 규모${profile.axisScores.scale} | 마케팅${profile.axisScores.marketing}`);

  if (profile.rfDevices.length > 0) {
    lines.push(`  RF 장비: ${profile.rfDevices.join(', ')}`);
  }
  if (profile.hifuDevices.length > 0) {
    lines.push(`  HIFU 장비: ${profile.hifuDevices.join(', ')}`);
  }
  lines.push(`  시술 ${profile.treatmentCount}건 (리프팅 ${profile.liftingTreatmentCount}건)`);
  if (profile.avgPrice) {
    lines.push(`  평균 가격: ${profile.avgPrice.toLocaleString()}원`);
  }
  lines.push(`  의사 ${profile.doctorCount}명 | SNS ${profile.snsChannels.length}채널`);
  lines.push('');
  lines.push(`  ★ 추천 앵글: ${ANGLE_LABELS[profile.primaryAngle.angle]}`);
  lines.push(`    ${profile.primaryAngle.reason}`);

  if (profile.salesAngles.length > 1) {
    lines.push(`  ☆ 보조 앵글: ${ANGLE_LABELS[profile.salesAngles[1].angle]}`);
    lines.push(`    ${profile.salesAngles[1].reason}`);
  }

  return lines.join('\n');
}

const ANGLE_LABELS: Record<SalesAngle, string> = {
  upgrade: '🔄 업그레이드',
  portfolio_expand: '📈 포트폴리오 확장',
  premium: '👑 프리미엄 포지셔닝',
  cost_efficiency: '💰 비용 효율',
  new_adoption: '🆕 신규 도입',
};

// ═══════════════════════════════════════════
// 메인 실행
// ═══════════════════════════════════════════

function main(): void {
  const normMap = getEquipmentNormalizationMap();
  console.log(`📖 사전 로드: normMap ${normMap.size}항목\n`);

  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('_analysis.json'))
    .sort();

  if (files.length === 0) {
    console.log('❌ output/ 디렉토리에 *_analysis.json 파일이 없습니다.');
    return;
  }

  console.log(`📂 분석 대상: ${files.length}개 병원\n`);

  const profiles: HospitalProfile[] = [];

  for (const file of files) {
    const hospitalId = file.replace('_analysis.json', '');
    const filePath = path.resolve(OUTPUT_DIR, file);

    let data: AnalysisFile;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      console.log(`  ⚠️ ${file} 파싱 실패`);
      continue;
    }

    const hospitalName = data.hospital_name || hospitalId;
    const devices = data.medical_devices || [];
    const treatments = data.treatments || [];
    const doctors = data.doctors || [];
    const contactInfo = data.contact_info;

    // 4축 스코어링
    const axisScores: AxisScores = {
      investment: scoreInvestment(devices),
      portfolio: scorePortfolio(treatments, devices),
      scale: scoreScale(doctors, treatments),
      marketing: scoreMarketing(treatments, contactInfo),
    };

    // 종합 점수 (가중 평균)
    const overallScore = Math.round(
      axisScores.investment * 0.35 +
      axisScores.portfolio * 0.25 +
      axisScores.scale * 0.25 +
      axisScores.marketing * 0.15
    );
    const grade = getGrade(overallScore);

    // 세일즈 앵글 매칭
    const salesAngles = matchSalesAngles(axisScores, devices, treatments, doctors);

    // 부가 데이터
    const deviceOnly = devices.filter(d => d.device_type === 'device');
    const rfDevices = deviceOnly.filter(d => RF_SUBCATS.has(d.subcategory)).map(d => d.name);
    const hifuDevices = deviceOnly.filter(d => HIFU_SUBCATS.has(d.subcategory)).map(d => d.name);
    const liftingTreatmentCount = treatments.filter(t =>
      LIFTING_KEYWORDS.some(k => t.name.toLowerCase().includes(k))
    ).length;

    const snsChannels: string[] = [];
    if (contactInfo?.kakao_channel) snsChannels.push('카카오');
    if (contactInfo?.instagram) snsChannels.push('인스타');
    if (contactInfo?.youtube) snsChannels.push('유튜브');
    if (contactInfo?.blog) snsChannels.push('블로그');

    const profile: HospitalProfile = {
      hospitalId,
      hospitalName,
      axisScores,
      overallScore,
      grade,
      salesAngles,
      primaryAngle: salesAngles[0],
      briefing: '', // 아래에서 채움
      deviceCount: deviceOnly.length,
      rfDevices,
      hifuDevices,
      treatmentCount: treatments.length,
      liftingTreatmentCount,
      avgPrice: getAvgPrice(treatments),
      doctorCount: doctors.filter(d => d.name !== '(학술활동 전용)').length,
      snsChannels,
      hasOldRf: deviceOnly.some(d => OLD_RF_DEVICES.has(d.name.toLowerCase().split(' ')[0])),
      hasTorrRf: devices.some(d => d.name.toLowerCase().includes('torr')),
    };

    profile.briefing = buildBriefing(profile);
    profiles.push(profile);

    console.log(`  ${grade} ${hospitalName}: 투자${axisScores.investment} 포트${axisScores.portfolio} 규모${axisScores.scale} 마케${axisScores.marketing} → ${ANGLE_LABELS[salesAngles[0].angle]}`);
  }

  // ── 결과 저장 ──
  const reportPath = path.resolve(OUTPUT_DIR, 'v57-sales-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(profiles, null, 2));
  console.log(`\n📊 세일즈 리포트 저장: ${reportPath} (${profiles.length}개 병원)`);

  // ── 통계 ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  v5.7 세일즈 앵글 매칭 결과');
  console.log('═══════════════════════════════════════════════════\n');

  const gradeDist = { S: 0, A: 0, B: 0, C: 0 };
  for (const p of profiles) gradeDist[p.grade]++;
  console.log(`등급 분포: S ${gradeDist.S} | A ${gradeDist.A} | B ${gradeDist.B} | C ${gradeDist.C}`);

  const angleDist: Record<string, number> = {};
  for (const p of profiles) {
    const a = p.primaryAngle.angle;
    angleDist[a] = (angleDist[a] || 0) + 1;
  }
  console.log('\n주요 앵글 분포:');
  for (const [angle, count] of Object.entries(angleDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ANGLE_LABELS[angle as SalesAngle]}: ${count}곳`);
  }

  const noAngle = profiles.filter(p => p.salesAngles.length === 0);
  if (noAngle.length > 0) {
    console.log(`\n⚠️ 앵글 미매칭: ${noAngle.length}곳`);
    for (const p of noAngle) console.log(`  ${p.hospitalName}`);
  } else {
    console.log('\n✅ 전체 병원 앵글 매칭 완료 (미매칭 0건)');
  }

  // S/A 등급 브리핑
  const topProfiles = profiles.filter(p => p.grade === 'S' || p.grade === 'A');
  if (topProfiles.length > 0) {
    console.log(`\n═══ S/A 등급 병원 브리핑 (${topProfiles.length}곳) ═══\n`);
    for (const p of topProfiles) {
      console.log(p.briefing);
      console.log('');
    }
  }
}

main();
