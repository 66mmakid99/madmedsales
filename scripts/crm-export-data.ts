/**
 * CRM 병원 전체 데이터 추출 (분석용).
 * 장비, 시술, 의사, 프로파일, 매칭 스코어 포함.
 *
 * Usage: npx tsx scripts/crm-export-data.ts
 */
import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface HospInfo {
  id: string;
  name: string;
  website: string | null;
  sido: string | null;
  sigungu: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  crawled_at: string | null;
}

async function main(): Promise<void> {
  // 1. CRM 병원 목록 (grade→customer_grade, status→health_status)
  const { data: crm, error: crmErr } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id, customer_grade, health_status, region, district')
    .not('sales_hospital_id', 'is', null)
    .order('name');

  if (crmErr) {
    console.error('CRM query error:', crmErr.message);
    return;
  }
  if (!crm || crm.length === 0) {
    console.log('No linked CRM hospitals found');
    return;
  }

  const hospitalIds = crm.map((h) => h.sales_hospital_id).filter(Boolean) as string[];
  console.log(`CRM linked hospitals: ${crm.length}`);

  // 2. hospitals 기본 정보
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu, department, email, phone, crawled_at')
    .in('id', hospitalIds);

  const hospMap = new Map((hospitals ?? []).map((h: HospInfo) => [h.id, h]));

  // 3. 장비
  const { data: equips } = await supabase
    .from('hospital_equipments')
    .select('hospital_id, equipment_name, equipment_category, equipment_brand, equipment_model, manufacturer, estimated_year')
    .in('hospital_id', hospitalIds);

  // 4. 시술
  const { data: treats } = await supabase
    .from('hospital_treatments')
    .select('hospital_id, treatment_name, treatment_category, price, price_event, price_min, price_max, is_promoted')
    .in('hospital_id', hospitalIds);

  // 5. 의사
  const { data: doctors } = await supabase
    .from('hospital_doctors')
    .select('hospital_id, name, title, specialty, career')
    .in('hospital_id', hospitalIds);

  // 6. 프로파일
  const { data: profiles } = await supabase
    .from('hospital_profiles')
    .select('hospital_id, profile_score, profile_grade, investment_score, portfolio_diversity_score, practice_scale_score, marketing_activity_score, investment_tendency')
    .in('hospital_id', hospitalIds);

  // 7. 매칭 스코어
  const { data: matches } = await supabase
    .from('product_match_scores')
    .select('hospital_id, product_id, total_score, grade, angle_scores, top_pitch_points')
    .in('hospital_id', hospitalIds);

  // 그룹핑
  function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const item of arr) {
      const k = item[key] as string;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(item);
    }
    return m;
  }

  const equipMap = groupBy(equips ?? [], 'hospital_id');
  const treatMap = groupBy(treats ?? [], 'hospital_id');
  const docMap = groupBy(doctors ?? [], 'hospital_id');
  const profMap = new Map((profiles ?? []).map((p) => [p.hospital_id as string, p]));
  const matchMap = groupBy(matches ?? [], 'hospital_id');

  // 결과 조합
  const result = crm.map((c) => {
    const h = hospMap.get(c.sales_hospital_id) as HospInfo | undefined;
    const prof = profMap.get(c.sales_hospital_id as string);
    const hId = c.sales_hospital_id as string;

    return {
      crm_name: c.name,
      crm_grade: c.customer_grade,
      crm_status: c.health_status,
      crm_region: [c.region, c.district].filter(Boolean).join(' '),
      hospital_name: h?.name ?? null,
      website: h?.website ?? null,
      region: [h?.sido, h?.sigungu].filter(Boolean).join(' '),
      department: h?.department ?? null,
      email: h?.email ?? null,
      phone: h?.phone ?? null,
      crawled_at: h?.crawled_at ?? null,
      profile: prof ? {
        grade: prof.profile_grade,
        score: prof.profile_score,
        investment: prof.investment_score,
        portfolio: prof.portfolio_diversity_score,
        scale_trust: prof.practice_scale_score,
        marketing: prof.marketing_activity_score,
        tendency: prof.investment_tendency,
      } : null,
      match_scores: (matchMap.get(hId) ?? []).map((m) => ({
        grade: m.grade,
        score: m.total_score,
        angles: m.angle_scores,
        top_pitch: m.top_pitch_points,
      })),
      equipments: (equipMap.get(hId) ?? []).map((e) => ({
        name: e.equipment_name,
        category: e.equipment_category,
        brand: e.equipment_brand,
        model: e.equipment_model,
        manufacturer: e.manufacturer,
        year: e.estimated_year,
      })),
      treatments: (treatMap.get(hId) ?? []).map((t) => ({
        name: t.treatment_name,
        category: t.treatment_category,
        price: t.price,
        price_event: t.price_event,
        is_promoted: t.is_promoted,
      })),
      doctors: (docMap.get(hId) ?? []).map((d) => ({
        name: d.name,
        title: d.title,
        specialty: d.specialty,
        career: d.career,
      })),
    };
  });

  const outPath = path.resolve(__dirname, 'data/crm-hospitals-full-export.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`\nExported ${result.length} hospitals → ${outPath}`);
  console.log(`Equip records: ${(equips ?? []).length}`);
  console.log(`Treatment records: ${(treats ?? []).length}`);
  console.log(`Doctor records: ${(doctors ?? []).length}`);
  console.log(`Profile records: ${(profiles ?? []).length}`);
  console.log(`Match records: ${(matches ?? []).length}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
