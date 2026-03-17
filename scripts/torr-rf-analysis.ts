/**
 * TORR RF 기고객 역분석 — 축 1~7, 9 자동 추출
 *
 * 지침서: docs/engine/TORR_RF_Customer_Analysis_Guide.md
 *
 * 사용법:
 *   npx tsx scripts/torr-rf-analysis.ts                  # 전체 축 실행
 *   npx tsx scripts/torr-rf-analysis.ts --axis 1         # 축 1만
 *   npx tsx scripts/torr-rf-analysis.ts --axis 1,2,3     # 축 1,2,3만
 *   npx tsx scripts/torr-rf-analysis.ts --dry-run        # 저장 없이 결과만 출력
 *   npx tsx scripts/torr-rf-analysis.ts --json            # JSON 출력
 */

process.on('SIGINT', () => { console.log('\n[SIGINT] 종료'); process.exit(1); });

import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI 파싱 ──
const args = process.argv.slice(2);
const hasFlag = (f: string): boolean => args.includes(f);
const getArg = (f: string): string | null => {
  const idx = args.indexOf(f);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

const DRY_RUN = hasFlag('--dry-run');
const JSON_OUTPUT = hasFlag('--json');
const AXIS_FILTER = getArg('--axis')?.split(',').map(Number) || [1, 2, 3, 4, 5, 6, 7, 9];

// ── TORR RF 제품 ID 조회 ──
async function getTorrProductId(): Promise<string | null> {
  const { data } = await supabase
    .from('sales_products')
    .select('id')
    .eq('code', 'torr-rf')
    .single();
  return data?.id || null;
}

// ── 기고객 병원 ID 목록 로드 ──
async function loadCustomerHospitalIds(): Promise<string[]> {
  // 1. 크롤링 스크립트에서 생성한 매핑 파일
  const mappingPath = path.resolve(__dirname, '..', '..', 'madmedscv', 'scripts', 'torr-rf-hospital-ids.json');
  if (fs.existsSync(mappingPath)) {
    const mappings = JSON.parse(fs.readFileSync(mappingPath, 'utf-8')) as { hospitalId: string }[];
    return mappings.map(m => m.hospitalId);
  }

  // 2. 폴백: 마스터 파일에서 이름으로 조회
  const masterPath = path.resolve(__dirname, '..', 'torr-rf-master-71-v2.json');
  const master = JSON.parse(fs.readFileSync(masterPath, 'utf-8')) as { name: string; website: string; phase: string }[];
  const crawlable = master.filter(m => m.website && m.phase !== 'N/A' && m.phase !== 'FIND_URL');

  const ids: string[] = [];
  for (const m of crawlable) {
    const { data } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', m.name)
      .limit(1);
    if (data && data.length > 0) ids.push(data[0].id);
  }
  return ids;
}

// ══════════════════════════════════════════
// 축 1. 병원 기본 프로파일
// ══════════════════════════════════════════
interface Axis1Result {
  totalHospitals: number;
  regionDistribution: Record<string, number>;
  regionCategory: Record<string, number>; // 서울강남/서울비강남/수도권/지방
  openedYearDistribution: Record<string, number>;
  avgClinicAge: number;
  specialistRatio: number;
  doctorCountDistribution: Record<string, number>; // 1명/2~3명/4명+
  franchiseRatio: number;
}

async function axis1(hospitalIds: string[]): Promise<Axis1Result> {
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, address, sido, sigungu, hira_opened_at, hira_specialist_count, franchise_brand, address_normalized')
    .in('id', hospitalIds);

  const { data: personas } = await supabase
    .from('sales_personas')
    .select('hospital_id, doctor_type, specialist_count_scv, specialist_count_hira')
    .in('hospital_id', hospitalIds);

  const { data: doctors } = await supabase
    .from('hospital_doctors')
    .select('hospital_id')
    .in('hospital_id', hospitalIds);

  const h = hospitals || [];
  const now = new Date();

  // 지역 분류
  const regionCategory: Record<string, number> = { '서울강남': 0, '서울비강남': 0, '수도권': 0, '지방': 0 };
  const regionDist: Record<string, number> = {};
  const gangnamGu = ['강남구', '서초구', '송파구', '강동구'];

  for (const hosp of h) {
    const sido = hosp.sido || hosp.address?.match(/^(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)/)?.[0] || '미상';
    const sigungu = hosp.sigungu || '';
    regionDist[sido] = (regionDist[sido] || 0) + 1;

    if (sido === '서울' || sido === '서울특별시') {
      if (gangnamGu.some(g => sigungu.includes(g) || hosp.address?.includes(g))) {
        regionCategory['서울강남']++;
      } else {
        regionCategory['서울비강남']++;
      }
    } else if (['경기', '경기도', '인천', '인천광역시'].some(s => sido.includes(s))) {
      regionCategory['수도권']++;
    } else {
      regionCategory['지방']++;
    }
  }

  // 개원 연차
  const openedYearDist: Record<string, number> = {};
  let totalAge = 0;
  let ageCount = 0;
  for (const hosp of h) {
    const opened = hosp.hira_opened_at;
    if (opened) {
      const age = Math.floor((now.getTime() - new Date(opened).getTime()) / (365.25 * 24 * 3600 * 1000));
      const bucket = age < 3 ? '0~2년' : age < 5 ? '3~4년' : age < 10 ? '5~9년' : age < 20 ? '10~19년' : '20년+';
      openedYearDist[bucket] = (openedYearDist[bucket] || 0) + 1;
      totalAge += age;
      ageCount++;
    }
  }

  // 전문의 비율
  const personaMap = new Map((personas || []).map(p => [p.hospital_id, p]));
  let specialistCount = 0;
  for (const id of hospitalIds) {
    const p = personaMap.get(id);
    if (p?.doctor_type === 'specialist') specialistCount++;
    else if (!p) {
      const hosp = h.find(hh => hh.id === id);
      if (hosp?.hira_specialist_count && hosp.hira_specialist_count > 0) specialistCount++;
    }
  }

  // 의료진 수
  const doctorsByHospital: Record<string, number> = {};
  for (const d of doctors || []) {
    doctorsByHospital[d.hospital_id] = (doctorsByHospital[d.hospital_id] || 0) + 1;
  }
  const doctorCountDist: Record<string, number> = { '1명': 0, '2~3명': 0, '4명+': 0 };
  for (const id of hospitalIds) {
    const count = doctorsByHospital[id] || 0;
    if (count <= 1) doctorCountDist['1명']++;
    else if (count <= 3) doctorCountDist['2~3명']++;
    else doctorCountDist['4명+']++;
  }

  // 프랜차이즈 비율
  const franchiseCount = h.filter(hosp => hosp.franchise_brand).length;

  return {
    totalHospitals: hospitalIds.length,
    regionDistribution: regionDist,
    regionCategory,
    openedYearDistribution: openedYearDist,
    avgClinicAge: ageCount > 0 ? Math.round(totalAge / ageCount * 10) / 10 : 0,
    specialistRatio: Math.round(specialistCount / hospitalIds.length * 100 * 10) / 10,
    doctorCountDistribution: doctorCountDist,
    franchiseRatio: Math.round(franchiseCount / hospitalIds.length * 100 * 10) / 10,
  };
}

// ══════════════════════════════════════════
// 축 2. 장비 포트폴리오 분석
// ══════════════════════════════════════════
interface Axis2Result {
  avgEquipmentCount: number;
  equipmentCountDistribution: Record<string, number>;
  topCoExistingEquipment: { name: string; count: number }[];
  rfEquipmentCoExistence: { name: string; count: number }[];
  hospitalsWithNoEquipmentData: number;
}

async function axis2(hospitalIds: string[]): Promise<Axis2Result> {
  // scv_crawl_snapshots의 equipments_found JSONB에서 추출
  const { data: snapshots } = await supabase
    .from('scv_crawl_snapshots')
    .select('hospital_id, equipments_found')
    .in('hospital_id', hospitalIds)
    .not('equipments_found', 'is', null);

  // hospital_equipments도 체크 (있으면)
  const { data: hEquip } = await supabase
    .from('sales_hospital_equipments')
    .select('hospital_id, equipment_name, device_brand')
    .in('hospital_id', hospitalIds);

  const equipByHospital: Record<string, string[]> = {};
  let noDataCount = 0;

  // snapshots에서 장비 추출
  for (const s of snapshots || []) {
    const equips = s.equipments_found as { name?: string; normalized_name?: string }[] | null;
    if (!equips || equips.length === 0) continue;
    const names = equips.map(e => (e.normalized_name || e.name || '').trim()).filter(Boolean);
    equipByHospital[s.hospital_id] = [...(equipByHospital[s.hospital_id] || []), ...names];
  }

  // hospital_equipments에서 추가
  for (const e of hEquip || []) {
    const name = e.equipment_name || e.device_brand || '';
    if (name) {
      equipByHospital[e.hospital_id] = [...(equipByHospital[e.hospital_id] || []), name];
    }
  }

  // 중복 제거
  for (const id of Object.keys(equipByHospital)) {
    equipByHospital[id] = [...new Set(equipByHospital[id])];
  }

  noDataCount = hospitalIds.filter(id => !equipByHospital[id] || equipByHospital[id].length === 0).length;

  // 장비 수 분포
  const countDist: Record<string, number> = { '0개': 0, '1~5개': 0, '6~10개': 0, '11~20개': 0, '21개+': 0 };
  const counts: number[] = [];
  for (const id of hospitalIds) {
    const count = (equipByHospital[id] || []).length;
    counts.push(count);
    if (count === 0) countDist['0개']++;
    else if (count <= 5) countDist['1~5개']++;
    else if (count <= 10) countDist['6~10개']++;
    else if (count <= 20) countDist['11~20개']++;
    else countDist['21개+']++;
  }

  // 동시 보유 장비 빈도 (TORR 제외)
  const equipFreq: Record<string, number> = {};
  const rfEquipFreq: Record<string, number> = {};
  const torrKeywords = ['torr', '토르', 'TORR'];
  const rfKeywords = ['rf', 'RF', '써마지', 'thermage', '인모드', 'inmode', '올리지오', 'oligio', '스카렛', 'scarlet', '시크릿', 'secret', '아그네스', 'agnes', '인피니', 'infini', '포텐자', 'potenza', '멀티폴라', '비너스'];

  for (const equips of Object.values(equipByHospital)) {
    for (const name of equips) {
      const lower = name.toLowerCase();
      if (torrKeywords.some(k => lower.includes(k.toLowerCase()))) continue; // TORR 제외
      equipFreq[name] = (equipFreq[name] || 0) + 1;

      if (rfKeywords.some(k => lower.includes(k.toLowerCase()))) {
        rfEquipFreq[name] = (rfEquipFreq[name] || 0) + 1;
      }
    }
  }

  const topEquip = Object.entries(equipFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const rfEquip = Object.entries(rfEquipFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const avg = counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length * 10) / 10 : 0;

  return {
    avgEquipmentCount: avg,
    equipmentCountDistribution: countDist,
    topCoExistingEquipment: topEquip,
    rfEquipmentCoExistence: rfEquip,
    hospitalsWithNoEquipmentData: noDataCount,
  };
}

// ══════════════════════════════════════════
// 축 3. 시술 메뉴 구성 패턴
// ══════════════════════════════════════════
interface Axis3Result {
  avgTreatmentCount: number;
  treatmentCountDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  torrTreatmentNames: { name: string; hospitalCount: number }[];
  comboTreatmentRatio: number;
  hospitalsWithNoTreatmentData: number;
}

async function axis3(hospitalIds: string[]): Promise<Axis3Result> {
  const { data: treatments } = await supabase
    .from('sales_hospital_treatments')
    .select('hospital_id, treatment_name, treatment_category, price_min, price_max, is_promoted')
    .in('hospital_id', hospitalIds);

  const t = treatments || [];
  const byHospital: Record<string, typeof t> = {};
  for (const tr of t) {
    byHospital[tr.hospital_id] = [...(byHospital[tr.hospital_id] || []), tr];
  }

  // 시술 수 분포
  const countDist: Record<string, number> = { '0개': 0, '1~10개': 0, '11~20개': 0, '21~40개': 0, '41개+': 0 };
  const counts: number[] = [];
  for (const id of hospitalIds) {
    const count = (byHospital[id] || []).length;
    counts.push(count);
    if (count === 0) countDist['0개']++;
    else if (count <= 10) countDist['1~10개']++;
    else if (count <= 20) countDist['11~20개']++;
    else if (count <= 40) countDist['21~40개']++;
    else countDist['41개+']++;
  }

  // 카테고리 분포
  const catDist: Record<string, number> = {};
  for (const tr of t) {
    const cat = tr.treatment_category || '미분류';
    catDist[cat] = (catDist[cat] || 0) + 1;
  }

  // TORR RF 관련 시술
  const torrNames: Record<string, Set<string>> = {};
  const torrKeywords = ['토르', 'torr', 'TORR', '멀티폴라', 'multipolar'];
  for (const tr of t) {
    const name = tr.treatment_name || '';
    const lower = name.toLowerCase();
    if (torrKeywords.some(k => lower.includes(k.toLowerCase()))) {
      if (!torrNames[name]) torrNames[name] = new Set();
      torrNames[name].add(tr.hospital_id);
    }
  }

  // 콤보 시술 비율
  const comboKeywords = ['콤보', '패키지', 'combo', '+', '세트', '복합'];
  let comboHospitalCount = 0;
  for (const id of hospitalIds) {
    const hospTreatments = byHospital[id] || [];
    if (hospTreatments.some(tr => comboKeywords.some(k => (tr.treatment_name || '').toLowerCase().includes(k)))) {
      comboHospitalCount++;
    }
  }

  return {
    avgTreatmentCount: counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length * 10) / 10 : 0,
    treatmentCountDistribution: countDist,
    categoryDistribution: catDist,
    torrTreatmentNames: Object.entries(torrNames)
      .map(([name, hospitals]) => ({ name, hospitalCount: hospitals.size }))
      .sort((a, b) => b.hospitalCount - a.hospitalCount),
    comboTreatmentRatio: hospitalIds.length > 0 ? Math.round(comboHospitalCount / hospitalIds.length * 100 * 10) / 10 : 0,
    hospitalsWithNoTreatmentData: hospitalIds.filter(id => !byHospital[id] || byHospital[id].length === 0).length,
  };
}

// ══════════════════════════════════════════
// 축 4. 가격 전략 분석
// ══════════════════════════════════════════
interface Axis4Result {
  torrPriceRange: { min: number; max: number; avg: number; count: number };
  pricePublicRatio: number;
  pricePublicCount: number;
  avgPricePositioning: Record<string, number>; // 프리미엄/중간/이벤트형
  eventHeavyRatio: number;
}

async function axis4(hospitalIds: string[]): Promise<Axis4Result> {
  const { data: treatments } = await supabase
    .from('sales_hospital_treatments')
    .select('hospital_id, treatment_name, price_min, price_max, is_promoted')
    .in('hospital_id', hospitalIds);

  const t = treatments || [];

  // TORR RF 관련 시술 가격
  const torrKeywords = ['토르', 'torr', 'TORR', '멀티폴라'];
  const torrPrices: number[] = [];
  for (const tr of t) {
    const name = (tr.treatment_name || '').toLowerCase();
    if (torrKeywords.some(k => name.includes(k.toLowerCase()))) {
      if (tr.price_min && tr.price_min > 0) torrPrices.push(tr.price_min);
      if (tr.price_max && tr.price_max > 0 && tr.price_max !== tr.price_min) torrPrices.push(tr.price_max);
    }
  }

  // 가격 공개 비율 (가격 데이터가 있는 병원)
  const hospWithPrice = new Set<string>();
  for (const tr of t) {
    if (tr.price_min && tr.price_min > 0) hospWithPrice.add(tr.hospital_id);
  }

  // 이벤트/프로모션 비중
  const hospWithEvent = new Set<string>();
  for (const tr of t) {
    if (tr.is_promoted) hospWithEvent.add(tr.hospital_id);
  }

  // 가격 포지셔닝 (시술 평균가 기준)
  const positioning: Record<string, number> = { '프리미엄': 0, '중간': 0, '이벤트형': 0 };
  for (const id of hospitalIds) {
    const hospTr = t.filter(tr => tr.hospital_id === id && tr.price_min && tr.price_min > 0);
    if (hospTr.length === 0) continue;
    const avgPrice = hospTr.reduce((s, tr) => s + (tr.price_min || 0), 0) / hospTr.length;
    if (avgPrice >= 300000) positioning['프리미엄']++;
    else if (avgPrice >= 100000) positioning['중간']++;
    else positioning['이벤트형']++;
  }

  return {
    torrPriceRange: {
      min: torrPrices.length > 0 ? Math.min(...torrPrices) : 0,
      max: torrPrices.length > 0 ? Math.max(...torrPrices) : 0,
      avg: torrPrices.length > 0 ? Math.round(torrPrices.reduce((a, b) => a + b, 0) / torrPrices.length) : 0,
      count: torrPrices.length,
    },
    pricePublicRatio: hospitalIds.length > 0 ? Math.round(hospWithPrice.size / hospitalIds.length * 100 * 10) / 10 : 0,
    pricePublicCount: hospWithPrice.size,
    avgPricePositioning: positioning,
    eventHeavyRatio: hospitalIds.length > 0 ? Math.round(hospWithEvent.size / hospitalIds.length * 100 * 10) / 10 : 0,
  };
}

// ══════════════════════════════════════════
// 축 5. 온라인 마케팅 특성
// ══════════════════════════════════════════
interface Axis5Result {
  siteTypeDistribution: Record<string, number>;
  torrDedicatedPageRatio: number;
  kakaoChannelRatio: number;
  blogLinkRatio: number;
  onlineBookingRatio: number;
  emailPublicRatio: number;
}

async function axis5(hospitalIds: string[]): Promise<Axis5Result> {
  // 사이트 타입
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, site_type, contact_email, contact_kakao')
    .in('id', hospitalIds);

  // scv_crawl_pages에서 TORR 전용 페이지 체크
  const { data: pages } = await supabase
    .from('scv_crawl_pages')
    .select('hospital_id, url, page_type, markdown')
    .in('hospital_id', hospitalIds);

  const h = hospitals || [];
  const p = pages || [];

  // 사이트 타입 분포
  const siteTypeDist: Record<string, number> = {};
  for (const hosp of h) {
    const st = hosp.site_type || '미분류';
    siteTypeDist[st] = (siteTypeDist[st] || 0) + 1;
  }

  // TORR 전용 페이지
  const torrKeywords = ['토르', 'torr', 'TORR'];
  const hospWithTorrPage = new Set<string>();
  for (const page of p) {
    const url = (page.url || '').toLowerCase();
    const md = (page.markdown || '').toLowerCase();
    if (torrKeywords.some(k => url.includes(k.toLowerCase()) || md.includes(k.toLowerCase()))) {
      hospWithTorrPage.add(page.hospital_id);
    }
  }

  // 카카오 채널
  const kakaoCount = h.filter(hosp => hosp.contact_kakao).length;

  // 블로그/SNS
  const blogKeywords = ['blog.naver', 'instagram', 'youtube', 'facebook'];
  const hospWithBlog = new Set<string>();
  for (const page of p) {
    const url = (page.url || '').toLowerCase();
    if (blogKeywords.some(k => url.includes(k))) {
      hospWithBlog.add(page.hospital_id);
    }
  }

  // 온라인 예약
  const bookingKeywords = ['예약', 'booking', 'reservation', '카카오톡', 'kakao'];
  const hospWithBooking = new Set<string>();
  for (const page of p) {
    const md = (page.markdown || '').toLowerCase();
    if (bookingKeywords.some(k => md.includes(k))) {
      hospWithBooking.add(page.hospital_id);
    }
  }

  // 이메일 공개
  const emailCount = h.filter(hosp => hosp.contact_email).length;

  const total = hospitalIds.length || 1;
  return {
    siteTypeDistribution: siteTypeDist,
    torrDedicatedPageRatio: Math.round(hospWithTorrPage.size / total * 100 * 10) / 10,
    kakaoChannelRatio: Math.round(kakaoCount / total * 100 * 10) / 10,
    blogLinkRatio: Math.round(hospWithBlog.size / total * 100 * 10) / 10,
    onlineBookingRatio: Math.round(hospWithBooking.size / total * 100 * 10) / 10,
    emailPublicRatio: Math.round(emailCount / total * 100 * 10) / 10,
  };
}

// ══════════════════════════════════════════
// 축 6. 경쟁 환경 (상권 내 포지션)
// ══════════════════════════════════════════
interface Axis6Result {
  hospitalsWithCoordinates: number;
  avgCompetitorsIn2km: number;
  avgRfRatioIn2km: number;
  blueOceanRatio: number; // RF 보급률 <30%
  redOceanRatio: number;  // RF 보급률 >50%
}

async function axis6(hospitalIds: string[]): Promise<Axis6Result> {
  const { data: custHospitals } = await supabase
    .from('hospitals')
    .select('id, latitude, longitude, sido, sigungu')
    .in('id', hospitalIds)
    .not('latitude', 'is', null);

  const withCoords = custHospitals || [];

  if (withCoords.length === 0) {
    return {
      hospitalsWithCoordinates: 0,
      avgCompetitorsIn2km: 0,
      avgRfRatioIn2km: 0,
      blueOceanRatio: 0,
      redOceanRatio: 0,
    };
  }

  // 전체 병원 목록에서 좌표 있는 것 (비교용)
  const { data: allHospitals } = await supabase
    .from('hospitals')
    .select('id, latitude, longitude')
    .not('latitude', 'is', null)
    .limit(5000);

  // 장비 데이터가 있는 병원 (RF 보유 여부)
  const { data: equipSnapshots } = await supabase
    .from('scv_crawl_snapshots')
    .select('hospital_id, equipments_found')
    .not('equipments_found', 'is', null);

  const rfHospitalIds = new Set<string>();
  const rfKeywords = ['rf', 'RF', '써마지', 'thermage', '인모드', 'inmode', '올리지오', 'oligio', 'torr', '토르'];
  for (const s of equipSnapshots || []) {
    const equips = s.equipments_found as { name?: string; normalized_name?: string }[] | null;
    if (!equips) continue;
    if (equips.some(e => rfKeywords.some(k => ((e.normalized_name || e.name || '')).toLowerCase().includes(k.toLowerCase())))) {
      rfHospitalIds.add(s.hospital_id);
    }
  }

  // 거리 계산 함수 (km)
  function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  let totalCompetitors = 0;
  let totalRfRatio = 0;
  let blueOcean = 0;
  let redOcean = 0;
  let analyzed = 0;

  for (const cust of withCoords) {
    const lat = Number(cust.latitude);
    const lon = Number(cust.longitude);
    if (!lat || !lon) continue;

    const nearby = (allHospitals || []).filter(h =>
      h.id !== cust.id && h.latitude && h.longitude &&
      haversine(lat, lon, Number(h.latitude), Number(h.longitude)) <= 2,
    );

    const nearbyRf = nearby.filter(h => rfHospitalIds.has(h.id)).length;
    const rfRatio = nearby.length > 0 ? nearbyRf / nearby.length : 0;

    totalCompetitors += nearby.length;
    totalRfRatio += rfRatio;
    if (rfRatio < 0.3) blueOcean++;
    if (rfRatio > 0.5) redOcean++;
    analyzed++;
  }

  return {
    hospitalsWithCoordinates: withCoords.length,
    avgCompetitorsIn2km: analyzed > 0 ? Math.round(totalCompetitors / analyzed * 10) / 10 : 0,
    avgRfRatioIn2km: analyzed > 0 ? Math.round(totalRfRatio / analyzed * 100 * 10) / 10 : 0,
    blueOceanRatio: analyzed > 0 ? Math.round(blueOcean / analyzed * 100 * 10) / 10 : 0,
    redOceanRatio: analyzed > 0 ? Math.round(redOcean / analyzed * 100 * 10) / 10 : 0,
  };
}

// ══════════════════════════════════════════
// 축 7. 도입 맥락 추정
// ══════════════════════════════════════════
interface Axis7Result {
  hospitalsWithTimelineData: number;
  avgYearsBeforeAdoption: number;
  adoptionSeasonality: Record<string, number>;
  equipmentChangeBeforeAdoption: number;
}

async function axis7(hospitalIds: string[]): Promise<Axis7Result> {
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, hira_opened_at, crawled_at')
    .in('id', hospitalIds);

  const { data: snapshots } = await supabase
    .from('scv_crawl_snapshots')
    .select('hospital_id, crawled_at, equipments_found')
    .in('hospital_id', hospitalIds)
    .order('crawled_at', { ascending: true });

  const h = hospitals || [];
  const s = snapshots || [];

  // 개원 후 도입까지 기간 추정
  let totalYears = 0;
  let yearCount = 0;
  const seasonality: Record<string, number> = {};

  for (const hosp of h) {
    if (!hosp.hira_opened_at || !hosp.crawled_at) continue;
    const opened = new Date(hosp.hira_opened_at);
    const crawled = new Date(hosp.crawled_at);
    const years = (crawled.getTime() - opened.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > 0 && years < 50) {
      totalYears += years;
      yearCount++;
    }

    // 도입 시기 (크롤링에서 TORR 감지된 월)
    const month = `${crawled.getMonth() + 1}월`;
    seasonality[month] = (seasonality[month] || 0) + 1;
  }

  // 장비 변화 추정 (스냅샷 시계열이 2개 이상인 병원)
  const snapsByHospital: Record<string, typeof s> = {};
  for (const snap of s) {
    snapsByHospital[snap.hospital_id] = [...(snapsByHospital[snap.hospital_id] || []), snap];
  }

  let equipChangeCount = 0;
  for (const [, snaps] of Object.entries(snapsByHospital)) {
    if (snaps.length >= 2) equipChangeCount++;
  }

  return {
    hospitalsWithTimelineData: yearCount,
    avgYearsBeforeAdoption: yearCount > 0 ? Math.round(totalYears / yearCount * 10) / 10 : 0,
    adoptionSeasonality: seasonality,
    equipmentChangeBeforeAdoption: equipChangeCount,
  };
}

// ══════════════════════════════════════════
// 축 9. 웹사이트 구조적 특성
// ══════════════════════════════════════════
interface Axis9Result {
  siteTypeDistribution: Record<string, number>;
  equipmentPageRatio: number;
  pricePageRatio: number;
  doctorPageDetailRatio: number;
  eventPageRatio: number;
  avgPageCount: number;
}

async function axis9(hospitalIds: string[]): Promise<Axis9Result> {
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, site_type')
    .in('id', hospitalIds);

  const { data: pages } = await supabase
    .from('scv_crawl_pages')
    .select('hospital_id, page_type, char_count')
    .in('hospital_id', hospitalIds);

  const h = hospitals || [];
  const p = pages || [];

  // 사이트 타입 분포
  const siteTypeDist: Record<string, number> = {};
  for (const hosp of h) {
    const st = hosp.site_type || '미분류';
    siteTypeDist[st] = (siteTypeDist[st] || 0) + 1;
  }

  // 페이지 타입별 병원 보유 비율
  const pageTypes: Record<string, Set<string>> = {};
  const pageCountByHospital: Record<string, number> = {};
  for (const page of p) {
    const pt = page.page_type || 'other';
    if (!pageTypes[pt]) pageTypes[pt] = new Set();
    pageTypes[pt].add(page.hospital_id);
    pageCountByHospital[page.hospital_id] = (pageCountByHospital[page.hospital_id] || 0) + 1;
  }

  const total = hospitalIds.length || 1;
  const equipPage = pageTypes['equipment']?.size || 0;
  const pricePage = pageTypes['price']?.size || 0;
  const doctorPage = pageTypes['doctor']?.size || 0;
  const eventPage = pageTypes['event']?.size || 0;

  const pageCounts = hospitalIds.map(id => pageCountByHospital[id] || 0);
  const avgPages = pageCounts.length > 0 ? pageCounts.reduce((a, b) => a + b, 0) / pageCounts.length : 0;

  return {
    siteTypeDistribution: siteTypeDist,
    equipmentPageRatio: Math.round(equipPage / total * 100 * 10) / 10,
    pricePageRatio: Math.round(pricePage / total * 100 * 10) / 10,
    doctorPageDetailRatio: Math.round(doctorPage / total * 100 * 10) / 10,
    eventPageRatio: Math.round(eventPage / total * 100 * 10) / 10,
    avgPageCount: Math.round(avgPages * 10) / 10,
  };
}

// ══════════════════════════════════════════
// sales_insight_cards 저장
// ══════════════════════════════════════════
async function saveInsightCard(
  axisNum: number,
  summary: string,
  data: Record<string, unknown>,
  productId: string | null,
  tags: string[],
): Promise<void> {
  if (DRY_RUN) return;

  const { error } = await supabase
    .from('sales_insight_cards')
    .insert({
      source_channel: 'existing_customer',
      source_id: `torr-rf-axis-${axisNum}`,
      raw_text: summary,
      structured: {
        axis: axisNum,
        analysis_date: new Date().toISOString().split('T')[0],
        ...data,
      },
      tags: [`축${axisNum}`, ...tags],
      product_id: productId,
    });

  if (error) {
    console.error(`  ⚠️ 축${axisNum} 인사이트 카드 저장 실패: ${error.message}`);
  }
}

// ══════════════════════════════════════════
// 메인
// ══════════════════════════════════════════
async function main(): Promise<void> {
  console.log('\n═══ TORR RF 기고객 역분석 — 축 1~7, 9 ═══\n');

  const hospitalIds = await loadCustomerHospitalIds();
  console.log(`분석 대상: ${hospitalIds.length}개 병원`);

  if (hospitalIds.length === 0) {
    console.log('❌ 분석 대상 병원이 없습니다.');
    return;
  }

  const productId = await getTorrProductId();
  console.log(`TORR RF product_id: ${productId || '미발견'}`);
  console.log(`분석 축: ${AXIS_FILTER.join(', ')}`);
  console.log(`모드: ${DRY_RUN ? 'DRY RUN (저장 안 함)' : '실행 + 저장'}\n`);

  const allResults: Record<string, unknown> = {};

  // 축 1
  if (AXIS_FILTER.includes(1)) {
    console.log('── 축 1: 병원 기본 프로파일 ──');
    const r = await axis1(hospitalIds);
    allResults['axis1'] = r;
    const summary = `[축1] 기고객 ${r.totalHospitals}개 중 전문의 병원 ${r.specialistRatio}%. 개원 평균 ${r.avgClinicAge}년차. 지역: 서울강남 ${r.regionCategory['서울강남']}개, 수도권 ${r.regionCategory['수도권']}개, 지방 ${r.regionCategory['지방']}개. 프랜차이즈 ${r.franchiseRatio}%.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(1, summary, r as unknown as Record<string, unknown>, productId, ['프로파일', '지역', '전문의', '개원연차']);
  }

  // 축 2
  if (AXIS_FILTER.includes(2)) {
    console.log('── 축 2: 장비 포트폴리오 ──');
    const r = await axis2(hospitalIds);
    allResults['axis2'] = r;
    const topEquipStr = r.topCoExistingEquipment.slice(0, 5).map(e => `${e.name}(${e.count})`).join(', ');
    const summary = `[축2] 평균 장비 ${r.avgEquipmentCount}대. 장비 데이터 없음: ${r.hospitalsWithNoEquipmentData}개. 동시 보유 TOP5: ${topEquipStr}. RF 동시 보유: ${r.rfEquipmentCoExistence.map(e => `${e.name}(${e.count})`).join(', ') || '없음'}.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(2, summary, r as unknown as Record<string, unknown>, productId, ['장비', 'RF', '포트폴리오']);
  }

  // 축 3
  if (AXIS_FILTER.includes(3)) {
    console.log('── 축 3: 시술 메뉴 구성 ──');
    const r = await axis3(hospitalIds);
    allResults['axis3'] = r;
    const torrTrStr = r.torrTreatmentNames.slice(0, 5).map(t => `${t.name}(${t.hospitalCount})`).join(', ');
    const summary = `[축3] 평균 시술 ${r.avgTreatmentCount}종. 시술 데이터 없음: ${r.hospitalsWithNoTreatmentData}개. TORR 관련 시술: ${torrTrStr || '미발견'}. 콤보 운영: ${r.comboTreatmentRatio}%.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(3, summary, r as unknown as Record<string, unknown>, productId, ['시술', '콤보', '메뉴구성']);
  }

  // 축 4
  if (AXIS_FILTER.includes(4)) {
    console.log('── 축 4: 가격 전략 ──');
    const r = await axis4(hospitalIds);
    allResults['axis4'] = r;
    const summary = `[축4] TORR RF 시술 가격: ${r.torrPriceRange.count > 0 ? `평균 ${Math.round(r.torrPriceRange.avg / 10000)}만원 (${Math.round(r.torrPriceRange.min / 10000)}~${Math.round(r.torrPriceRange.max / 10000)}만원)` : '데이터 없음'}. 가격 공개: ${r.pricePublicRatio}% (${r.pricePublicCount}개). 이벤트형: ${r.eventHeavyRatio}%.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(4, summary, r as unknown as Record<string, unknown>, productId, ['가격', '이벤트', '프리미엄']);
  }

  // 축 5
  if (AXIS_FILTER.includes(5)) {
    console.log('── 축 5: 온라인 마케팅 ──');
    const r = await axis5(hospitalIds);
    allResults['axis5'] = r;
    const siteTypeStr = Object.entries(r.siteTypeDistribution).map(([k, v]) => `${k}:${v}`).join(', ');
    const summary = `[축5] site-type 분포: ${siteTypeStr}. TORR 전용 페이지: ${r.torrDedicatedPageRatio}%. 카카오: ${r.kakaoChannelRatio}%. 예약: ${r.onlineBookingRatio}%. 이메일 공개: ${r.emailPublicRatio}%.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(5, summary, r as unknown as Record<string, unknown>, productId, ['마케팅', '디지털', '카카오', '이메일']);
  }

  // 축 6
  if (AXIS_FILTER.includes(6)) {
    console.log('── 축 6: 경쟁 환경 ──');
    const r = await axis6(hospitalIds);
    allResults['axis6'] = r;
    const summary = `[축6] 좌표 보유: ${r.hospitalsWithCoordinates}개. 2km 내 평균 경쟁 ${r.avgCompetitorsIn2km}개. RF 보급률 평균 ${r.avgRfRatioIn2km}%. 블루오션(RF<30%): ${r.blueOceanRatio}%, 레드오션(RF>50%): ${r.redOceanRatio}%.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(6, summary, r as unknown as Record<string, unknown>, productId, ['상권', '경쟁', 'RF보급률']);
  }

  // 축 7
  if (AXIS_FILTER.includes(7)) {
    console.log('── 축 7: 도입 맥락 추정 ──');
    const r = await axis7(hospitalIds);
    allResults['axis7'] = r;
    const seasonStr = Object.entries(r.adoptionSeasonality).sort(([, a], [, b]) => b - a).slice(0, 3).map(([k, v]) => `${k}(${v})`).join(', ');
    const summary = `[축7] 시계열 데이터 보유: ${r.hospitalsWithTimelineData}개. 개원 후 평균 ${r.avgYearsBeforeAdoption}년차 도입. 도입 시기 피크: ${seasonStr || 'N/A'}. 장비 변화 이력: ${r.equipmentChangeBeforeAdoption}개.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(7, summary, r as unknown as Record<string, unknown>, productId, ['도입맥락', '시계열', '교체']);
  }

  // 축 9
  if (AXIS_FILTER.includes(9)) {
    console.log('── 축 9: 웹사이트 구조 ──');
    const r = await axis9(hospitalIds);
    allResults['axis9'] = r;
    const siteTypeStr = Object.entries(r.siteTypeDistribution).map(([k, v]) => `${k}:${v}`).join(', ');
    const summary = `[축9] site-type: ${siteTypeStr}. 장비페이지 보유: ${r.equipmentPageRatio}%. 가격표: ${r.pricePageRatio}%. 의료진: ${r.doctorPageDetailRatio}%. 이벤트: ${r.eventPageRatio}%. 평균 ${r.avgPageCount}페이지.`;
    console.log(`  ${summary}\n`);
    await saveInsightCard(9, summary, r as unknown as Record<string, unknown>, productId, ['웹사이트', '사이트타입', '디지털성숙도']);
  }

  // 결과 저장
  const outputPath = path.resolve(__dirname, 'data', 'torr-rf-analysis-results.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\n결과 저장: ${outputPath}`);

  if (JSON_OUTPUT) {
    console.log('\n── JSON 결과 ──');
    console.log(JSON.stringify(allResults, null, 2));
  }

  console.log('\n═══ 분석 완료 ═══');
  console.log('축 8(영업이력)은 수동 입력 필요');
  console.log('축 10(교차분석)은 축 1~9 완료 후 별도 실행\n');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
