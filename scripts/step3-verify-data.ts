/**
 * step3-verify-data.ts
 *
 * TORR RF 71 병원 데이터 수집 결과 검증
 * - CRM 등록 병원 수, 연결 상태
 * - 장비/시술/의사 데이터 현황
 * - 데이터 유무별 병원 목록
 *
 * 실행: npx tsx scripts/step3-verify-data.ts
 */

import { supabase } from './utils/supabase.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface CrmHospitalRow {
  id: string;
  name: string;
  website: string | null;
  sales_hospital_id: string | null;
}

interface HospitalDetail {
  name: string;
  hospitalId: string;
  equip: number;
  treat: number;
  doctors: number;
  crawled: boolean;
}

async function main(): Promise<void> {
  console.log('');
  console.log('=======================================================');
  console.log('  TORR RF 71 hospital data collection verification');
  console.log('=======================================================');
  console.log('');

  // 1. CRM 병원 전체 목록
  const { data: crmHospitals, error: crmErr } = await supabase
    .from('crm_hospitals')
    .select('id, name, website, sales_hospital_id')
    .eq('tenant_id', TENANT_ID)
    .order('name');

  if (crmErr) {
    console.error('CRM 병원 조회 실패:', crmErr.message);
    return;
  }

  const hospitals = (crmHospitals || []) as CrmHospitalRow[];

  console.log(`CRM 등록 병원 수: ${hospitals.length}개`);

  // 연결된 병원
  const linked = hospitals.filter(h => h.sales_hospital_id);
  const withWebsite = hospitals.filter(h => h.website);
  console.log(`hospitals 테이블 연결: ${linked.length}개`);
  console.log(`웹사이트 보유: ${withWebsite.length}개`);
  console.log('');

  // 2. 각 연결 병원의 장비/시술/의사 수
  let totalEquip = 0;
  let totalTreat = 0;
  let totalDoctors = 0;
  let crawledCount = 0;
  let emptyCount = 0;

  const details: HospitalDetail[] = [];

  for (const h of linked) {
    const hid = h.sales_hospital_id as string;

    // 장비
    const { count: eqCount } = await supabase
      .from('hospital_equipments')
      .select('*', { count: 'exact', head: true })
      .eq('hospital_id', hid);

    // 시술
    const { count: trCount } = await supabase
      .from('hospital_treatments')
      .select('*', { count: 'exact', head: true })
      .eq('hospital_id', hid);

    // 의사
    const { count: drCount } = await supabase
      .from('hospital_doctors')
      .select('*', { count: 'exact', head: true })
      .eq('hospital_id', hid);

    // crawled_at 확인
    const { data: hospital } = await supabase
      .from('hospitals')
      .select('crawled_at')
      .eq('id', hid)
      .single();

    const eq = eqCount || 0;
    const tr = trCount || 0;
    const dr = drCount || 0;
    const crawled = !!hospital?.crawled_at;

    totalEquip += eq;
    totalTreat += tr;
    totalDoctors += dr;
    if (crawled) crawledCount++;
    if (eq === 0 && tr === 0 && dr === 0) emptyCount++;

    details.push({
      name: h.name,
      hospitalId: hid,
      equip: eq,
      treat: tr,
      doctors: dr,
      crawled,
    });
  }

  console.log('----- 데이터 현황 요약 -----');
  console.log(`크롤링 완료: ${crawledCount}개`);
  console.log(`총 장비: ${totalEquip}개`);
  console.log(`총 시술: ${totalTreat}개`);
  console.log(`총 의사: ${totalDoctors}명`);
  console.log(`데이터 없음 (eq=0,tr=0,dr=0): ${emptyCount}개`);
  console.log('');

  // 3. 데이터 있는 병원
  console.log('----- 데이터 보유 병원 -----');
  const withData = details.filter(d => d.equip > 0 || d.treat > 0 || d.doctors > 0);
  for (const d of withData.sort((a, b) => (b.equip + b.treat) - (a.equip + a.treat))) {
    console.log(`  ${d.name.padEnd(20)} | 장비 ${String(d.equip).padStart(3)} | 시술 ${String(d.treat).padStart(3)} | 의사 ${String(d.doctors).padStart(2)}`);
  }

  if (withData.length === 0) {
    console.log('  (없음)');
  }

  // 4. 데이터 없는 병원
  console.log('');
  console.log('----- 데이터 없는 병원 (연결됨) -----');
  const noData = details.filter(d => d.equip === 0 && d.treat === 0 && d.doctors === 0);
  for (const d of noData) {
    console.log(`  ${d.name} (crawled: ${d.crawled})`);
  }

  if (noData.length === 0) {
    console.log('  (없음)');
  }

  // 5. hospitals 미연결 (crm만 존재)
  const unlinked = hospitals.filter(h => !h.sales_hospital_id);
  if (unlinked.length > 0) {
    console.log('');
    console.log(`----- hospitals 미연결 (${unlinked.length}개) -----`);
    for (const h of unlinked) {
      console.log(`  ${h.name} ${h.website ? '(웹사이트: ' + h.website + ')' : '(웹사이트 없음)'}`);
    }
  }

  console.log('');
  console.log('=======================================================');
  console.log('  검증 완료');
  console.log('=======================================================');
}

main().catch(console.error);
