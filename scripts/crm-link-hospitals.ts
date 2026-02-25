/**
 * CRM 병원 → hospitals 테이블 매칭 + website 확보.
 *
 * 1. crm_hospitals에서 sales_hospital_id가 null인 것 조회
 * 2. hospitals 테이블에서 이름으로 매칭
 * 3. 매칭되면 sales_hospital_id 업데이트 + crm_hospitals.website 채우기
 * 4. 매칭 안 되면 리포트
 *
 * Usage: npx tsx scripts/crm-link-hospitals.ts
 */
import { supabase } from './utils/supabase.js';

interface CrmHospital {
  id: string;
  name: string;
  branch_name: string | null;
  sales_hospital_id: string | null;
  website: string | null;
  region: string | null;
}

interface MainHospital {
  id: string;
  name: string;
  website: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

async function main(): Promise<void> {
  console.log('=== CRM → hospitals 매칭 스크립트 ===\n');

  // 1. CRM 병원 전체 조회
  const { data: crmHospitals, error: crmErr } = await supabase
    .from('crm_hospitals')
    .select('id, name, branch_name, sales_hospital_id, website, region')
    .order('name');

  if (crmErr || !crmHospitals) {
    console.error('CRM 병원 조회 실패:', crmErr?.message);
    process.exit(1);
  }

  console.log(`CRM 병원 총: ${crmHospitals.length}개`);
  const unlinked = crmHospitals.filter((h: CrmHospital) => !h.sales_hospital_id);
  console.log(`미연결: ${unlinked.length}개\n`);

  let matched = 0;
  let withWebsite = 0;
  const noMatch: string[] = [];
  const matchedNoWebsite: string[] = [];

  for (const crm of unlinked as CrmHospital[]) {
    // 이름에서 괄호 내용 제거 (예: "포에버의원(신사)" → "포에버의원")
    const cleanName = crm.name.replace(/\s*\(.*?\)\s*/g, '').trim();

    // hospitals 테이블에서 검색 — 정확 매칭 우선, ilike 폴백
    let { data: matches } = await supabase
      .from('hospitals')
      .select('id, name, website, address, phone, email')
      .eq('name', crm.name)
      .limit(1);

    if (!matches || matches.length === 0) {
      ({ data: matches } = await supabase
        .from('hospitals')
        .select('id, name, website, address, phone, email')
        .eq('name', cleanName)
        .limit(1));
    }

    if (!matches || matches.length === 0) {
      ({ data: matches } = await supabase
        .from('hospitals')
        .select('id, name, website, address, phone, email')
        .ilike('name', `%${cleanName}%`)
        .limit(5));
    }

    if (!matches || matches.length === 0) {
      noMatch.push(crm.name);
      console.log(`  ❌ ${crm.name} — 매칭 없음`);
      continue;
    }

    // 매칭 결과 중 가장 적합한 것 선택
    const best: MainHospital = matches[0];
    matched++;

    // sales_hospital_id 업데이트
    const updateData: Record<string, unknown> = {
      sales_hospital_id: best.id,
    };

    // website 채우기 (CRM에 없고 hospitals에 있으면)
    if (!crm.website && best.website) {
      updateData.website = best.website;
      withWebsite++;
    }

    // phone, email도 채우기
    if (best.phone) updateData.phone = best.phone;
    if (best.email) updateData.email = best.email;

    const { error: upErr } = await supabase
      .from('crm_hospitals')
      .update(updateData)
      .eq('id', crm.id);

    if (upErr) {
      console.log(`  ⚠️ ${crm.name} — 매칭(${best.name}) but 업데이트 실패: ${upErr.message}`);
    } else {
      const hasWeb = best.website ? '🌐' : '⚠️ no website';
      console.log(`  ✅ ${crm.name} → ${best.name} (${best.id.slice(0, 8)}) ${hasWeb}`);
      if (!best.website) matchedNoWebsite.push(crm.name);
    }
  }

  console.log('\n══════ 결과 ══════');
  console.log(`매칭 성공: ${matched}/${unlinked.length}`);
  console.log(`website 확보: ${withWebsite}`);
  console.log(`매칭 실패: ${noMatch.length}`);
  if (noMatch.length > 0) {
    console.log('\n매칭 실패 목록:');
    noMatch.forEach((n) => console.log(`  - ${n}`));
  }
  if (matchedNoWebsite.length > 0) {
    console.log('\n매칭됐지만 website 없음:');
    matchedNoWebsite.forEach((n) => console.log(`  - ${n}`));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
