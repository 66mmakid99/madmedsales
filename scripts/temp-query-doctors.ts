/**
 * temp-query-doctors.ts
 * 닥터스피부과 데이터 조회 (디버깅용 일회성 스크립트)
 *
 * 실행: npx tsx scripts/temp-query-doctors.ts
 */
import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // ============================================================
  // 1. "닥터스" 매칭 병원 목록
  // ============================================================
  console.log('\n========================================');
  console.log('1. 병원 검색: "닥터스" 매칭');
  console.log('========================================');

  const { data: hospitals, error: hospErr } = await supabase
    .from('hospitals')
    .select('id, name, address, sido, sigungu, department, email, phone, website, crawled_at, data_quality_score')
    .ilike('name', '%닥터스%');

  if (hospErr) {
    console.error('hospitals query error:', hospErr.message);
    return;
  }

  console.log(JSON.stringify({
    total_matches: hospitals?.length ?? 0,
    hospitals: hospitals ?? [],
  }, null, 2));

  if (!hospitals || hospitals.length === 0) {
    console.log('No hospitals matching "닥터스" found.');
    return;
  }

  const hospitalIds = hospitals.map((h) => h.id);
  const hospitalNames = new Map(hospitals.map((h) => [h.id, h.name]));

  // ============================================================
  // 2. 의사 데이터 (sales_hospital_doctors)
  // ============================================================
  console.log('\n========================================');
  console.log('2. 의사 데이터 (sales_hospital_doctors)');
  console.log('========================================');

  const { data: doctors, error: docErr } = await supabase
    .from('sales_hospital_doctors')
    .select('id, hospital_id, name, title, specialty, education, career, academic_activity, photo_url, enrichment_source, enriched_at')
    .in('hospital_id', hospitalIds);

  if (docErr) {
    console.error('sales_hospital_doctors query error:', docErr.message);
    // fallback without enrichment columns
    const { data: d2, error: e2 } = await supabase
      .from('sales_hospital_doctors')
      .select('id, hospital_id, name, title, specialty, education, career, academic_activity')
      .in('hospital_id', hospitalIds);
    if (e2) {
      console.error('fallback query also failed:', e2.message);
    } else {
      console.log(JSON.stringify({
        note: 'fallback query (no photo_url/enrichment columns)',
        total_doctors: d2?.length ?? 0,
        by_hospital: groupByHospital(d2 ?? [], hospitalNames),
      }, null, 2));
    }
  } else {
    console.log(JSON.stringify({
      total_doctors: doctors?.length ?? 0,
      by_hospital: groupByHospital(doctors ?? [], hospitalNames),
    }, null, 2));
  }

  // ============================================================
  // 3. 구조화 학술활동 (doctor_academic_activities) — 연도 중복 확인
  // ============================================================
  console.log('\n========================================');
  console.log('3. 학술활동 (doctor_academic_activities)');
  console.log('========================================');

  const { data: academics, error: acaErr } = await supabase
    .from('doctor_academic_activities')
    .select('id, hospital_id, doctor_name, activity_type, title, year, source')
    .in('hospital_id', hospitalIds)
    .order('hospital_id')
    .order('doctor_name')
    .order('year', { ascending: true, nullsFirst: false });

  if (acaErr) {
    console.error('doctor_academic_activities query error (table may not exist):', acaErr.message);
  } else {
    // 연도 중복 분석
    const yearDupMap = new Map<string, Array<{ id: string; title: string; year: string | null; type: string }>>();
    for (const a of (academics ?? [])) {
      const key = `${a.hospital_id}::${a.doctor_name}::${a.activity_type}::${a.title}`;
      const arr = yearDupMap.get(key) || [];
      arr.push({ id: a.id, title: a.title, year: a.year, type: a.activity_type });
      yearDupMap.set(key, arr);
    }

    const duplicates = [...yearDupMap.entries()]
      .filter(([, arr]) => arr.length > 1)
      .map(([key, arr]) => ({ key, count: arr.length, entries: arr }));

    console.log(JSON.stringify({
      total_academic_activities: academics?.length ?? 0,
      by_hospital: groupAcademicByHospital(academics ?? [], hospitalNames),
      year_duplication_analysis: {
        total_duplicate_groups: duplicates.length,
        duplicate_samples: duplicates.slice(0, 10),
      },
      all_activities: academics ?? [],
    }, null, 2));
  }

  // ============================================================
  // 4. 보유 장비 (sales_hospital_equipments)
  // ============================================================
  console.log('\n========================================');
  console.log('4. 보유 장비 (sales_hospital_equipments)');
  console.log('========================================');

  const { data: equips, error: eqErr } = await supabase
    .from('sales_hospital_equipments')
    .select('*')
    .in('hospital_id', hospitalIds);

  if (eqErr) {
    console.error('sales_hospital_equipments query error:', eqErr.message);
  } else {
    console.log(JSON.stringify({
      total_equipment: equips?.length ?? 0,
      by_hospital: groupEquipByHospital(equips ?? [], hospitalNames),
    }, null, 2));
  }

  // ============================================================
  // 5. 시술 메뉴 (sales_hospital_treatments)
  // ============================================================
  console.log('\n========================================');
  console.log('5. 시술 메뉴 (sales_hospital_treatments)');
  console.log('========================================');

  const { data: treats, error: trErr } = await supabase
    .from('sales_hospital_treatments')
    .select('*')
    .in('hospital_id', hospitalIds);

  if (trErr) {
    console.error('sales_hospital_treatments query error:', trErr.message);
  } else {
    console.log(JSON.stringify({
      total_treatments: treats?.length ?? 0,
      by_hospital: groupTreatByHospital(treats ?? [], hospitalNames),
    }, null, 2));
  }

  // ============================================================
  // 6. 의료기기 (sales_medical_devices)
  // ============================================================
  console.log('\n========================================');
  console.log('6. 의료기기 (sales_medical_devices)');
  console.log('========================================');

  const { data: devices, error: devErr } = await supabase
    .from('sales_medical_devices')
    .select('*')
    .in('hospital_id', hospitalIds);

  if (devErr) {
    console.error('sales_medical_devices query error:', devErr.message);
  } else {
    console.log(JSON.stringify({
      total_devices: devices?.length ?? 0,
      by_hospital: groupEquipByHospital(devices ?? [], hospitalNames),
    }, null, 2));
  }

  // ============================================================
  // 7. 요약 — 닥터스피부과 핵심 2개 병원 비교
  // ============================================================
  console.log('\n========================================');
  console.log('7. 핵심 병원 요약 (doctors365 계열만)');
  console.log('========================================');

  const doctors365 = hospitals.filter((h) =>
    h.website?.includes('doctors365') || h.name.includes('닥터스피부과')
  );

  const summary = doctors365.map((h) => ({
    id: h.id,
    name: h.name,
    address: h.address,
    website: h.website,
    doctor_count: (doctors ?? []).filter((d) => (d as Record<string, unknown>).hospital_id === h.id).length,
    academic_count: (academics ?? []).filter((a) => (a as Record<string, unknown>).hospital_id === h.id).length,
    equip_count: (equips ?? []).filter((e) => (e as Record<string, unknown>).hospital_id === h.id).length,
    treat_count: (treats ?? []).filter((t) => (t as Record<string, unknown>).hospital_id === h.id).length,
    device_count: (devices ?? []).filter((d) => (d as Record<string, unknown>).hospital_id === h.id).length,
  }));

  console.log(JSON.stringify(summary, null, 2));
}

// ============================================================
// Helpers
// ============================================================
function groupByHospital(
  rows: Array<Record<string, unknown>>,
  nameMap: Map<string, string>,
): Record<string, { hospital_name: string; count: number; doctors: Array<Record<string, unknown>> }> {
  const result: Record<string, { hospital_name: string; count: number; doctors: Array<Record<string, unknown>> }> = {};
  for (const row of rows) {
    const hid = row.hospital_id as string;
    if (!result[hid]) {
      result[hid] = { hospital_name: nameMap.get(hid) || '(unknown)', count: 0, doctors: [] };
    }
    result[hid].count++;
    result[hid].doctors.push(row);
  }
  return result;
}

function groupAcademicByHospital(
  rows: Array<Record<string, unknown>>,
  nameMap: Map<string, string>,
): Record<string, { hospital_name: string; count: number; activities: Array<Record<string, unknown>> }> {
  const result: Record<string, { hospital_name: string; count: number; activities: Array<Record<string, unknown>> }> = {};
  for (const row of rows) {
    const hid = row.hospital_id as string;
    if (!result[hid]) {
      result[hid] = { hospital_name: nameMap.get(hid) || '(unknown)', count: 0, activities: [] };
    }
    result[hid].count++;
    result[hid].activities.push(row);
  }
  return result;
}

function groupEquipByHospital(
  rows: Array<Record<string, unknown>>,
  nameMap: Map<string, string>,
): Record<string, { hospital_name: string; count: number; equipment: Array<Record<string, unknown>> }> {
  const result: Record<string, { hospital_name: string; count: number; equipment: Array<Record<string, unknown>> }> = {};
  for (const row of rows) {
    const hid = row.hospital_id as string;
    if (!result[hid]) {
      result[hid] = { hospital_name: nameMap.get(hid) || '(unknown)', count: 0, equipment: [] };
    }
    result[hid].count++;
    result[hid].equipment.push(row);
  }
  return result;
}

function groupTreatByHospital(
  rows: Array<Record<string, unknown>>,
  nameMap: Map<string, string>,
): Record<string, { hospital_name: string; count: number; treatments: Array<Record<string, unknown>> }> {
  const result: Record<string, { hospital_name: string; count: number; treatments: Array<Record<string, unknown>> }> = {};
  for (const row of rows) {
    const hid = row.hospital_id as string;
    if (!result[hid]) {
      result[hid] = { hospital_name: nameMap.get(hid) || '(unknown)', count: 0, treatments: [] };
    }
    result[hid].count++;
    result[hid].treatments.push(row);
  }
  return result;
}

main().catch(console.error);
