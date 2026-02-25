/**
 * 4차 E2E 테스트 결과를 Supabase DB에 업로드
 *
 * 대상 테이블: crawl_snapshots, hospital_equipments, hospital_treatments, hospital_pricing
 * 소스: snapshots/2026-02-22-v4/{병원명}/gemini-analysis-v4.json
 */
import fs from 'fs';
import path from 'path';
import { supabase } from './utils/supabase.js';

// ── 스냅샷 폴더명 → DB 병원 이름 매핑 ──
const NAME_MAP: Record<string, string> = {
  '815의원': '815의원',
  '고운세상피부과명동': '고운세상피부과 명동',
  '닥터스피부과신사': '닥터스피부과 신사',
  '리멤버피부과': '리멤버피부과의원',   // 노원구 25d72526
  '바노바기피부과': '바노바기피부과의원',
  '신사루비의원': '신사루비의원',
  '이지함피부과망우': '이지함피부과 망우',
  '톡스앤필강서': '__CREATE_NEW__',
  '한미인의원': '한미인(韓美人)의원',
};

// 동일 이름 다지점 구분용 지역 힌트
const REGION_HINTS: Record<string, string> = {
  '리멤버피부과': '노원',
};

const SNAPSHOT_DIR = path.resolve('snapshots/2026-02-22-v4');
const CRAWLED_AT = '2026-02-22T09:40:00+09:00';

interface AnalysisEquipment {
  equipment_name: string;
  equipment_brand: string | null;
  equipment_category: string;
  manufacturer: string | null;
}

interface AnalysisTreatment {
  treatment_name: string;
  treatment_category: string | null;
  price: number | null;
  price_min?: number | null;
  price_max?: number | null;
  is_promoted: boolean;
}

interface AnalysisResult {
  equipments: AnalysisEquipment[];
  treatments: AnalysisTreatment[];
}

// 톡스앤필강서 신규 등록용 정보
const NEW_HOSPITALS: Record<string, {
  name: string; address: string; phone: string; sido: string; sigungu: string;
  department: string; hospital_type: string;
}> = {
  '톡스앤필강서': {
    name: '톡스앤필의원 강서점',
    address: '서울 강서구 공항대로 190 푸리마타워 2층',
    phone: '02-6958-8688',
    sido: '서울특별시',
    sigungu: '강서구',
    department: '피부과',
    hospital_type: '의원',
  },
};

async function resolveHospitalId(folderName: string): Promise<string | null> {
  const dbName = NAME_MAP[folderName] ?? folderName;

  // 신규 병원 생성
  if (dbName === '__CREATE_NEW__') {
    const info = NEW_HOSPITALS[folderName];
    if (!info) return null;

    // 이미 존재하는지 확인
    const { data: existing } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', info.name)
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`  기존 병원 발견: "${info.name}"`);
      return existing[0].id;
    }

    const { data: created, error: createErr } = await supabase
      .from('hospitals')
      .insert({
        ...info,
        status: 'active',
        is_target: true,
        data_quality_score: 0,
        source: 'crawl_v4',
      })
      .select('id')
      .single();

    if (createErr) {
      console.log(`  ERR 병원 생성: ${createErr.message}`);
      return null;
    }
    console.log(`  신규 생성: "${info.name}" → ${created.id}`);
    return created.id;
  }

  // 정확 매칭 (동일 이름 다지점 → 지역 힌트로 필터)
  const { data: exact } = await supabase
    .from('hospitals')
    .select('id, name, sido, sigungu')
    .eq('name', dbName);

  if (exact && exact.length === 1) return exact[0].id;
  if (exact && exact.length > 1) {
    // REGION_HINTS로 지점 구분
    const hint = REGION_HINTS[folderName];
    if (hint) {
      const matched = exact.find(h => h.sigungu?.includes(hint) || h.sido?.includes(hint));
      if (matched) {
        console.log(`  지역 매칭: "${folderName}" → "${matched.name}" (${matched.sigungu})`);
        return matched.id;
      }
    }
    // 힌트 없으면 첫 번째
    console.log(`  다지점 중 첫번째 선택: "${exact[0].name}" (${exact[0].sigungu})`);
    return exact[0].id;
  }

  // fuzzy 매칭
  const searchTerm = folderName.replace(/피부과|의원|성형외과/g, '').trim();
  const { data: fuzzy } = await supabase
    .from('hospitals')
    .select('id, name')
    .ilike('name', `%${searchTerm}%`)
    .limit(5);

  if (fuzzy && fuzzy.length > 0) {
    fuzzy.sort((a, b) => a.name.length - b.name.length);
    console.log(`  fuzzy 매칭: "${folderName}" → "${fuzzy[0].name}"`);
    return fuzzy[0].id;
  }

  return null;
}

async function uploadHospital(folderName: string): Promise<{ eq: number; tr: number; pr: number }> {
  const analysisPath = path.join(SNAPSHOT_DIR, folderName, 'gemini-analysis-v4.json');

  if (!fs.existsSync(analysisPath)) {
    console.log(`  SKIP: ${folderName} — 분석 파일 없음`);
    return { eq: 0, tr: 0, pr: 0 };
  }

  const raw = fs.readFileSync(analysisPath, 'utf-8');
  const analysis: AnalysisResult = JSON.parse(raw);

  if (!analysis.equipments?.length && !analysis.treatments?.length) {
    console.log(`  SKIP: ${folderName} — 데이터 없음`);
    return { eq: 0, tr: 0, pr: 0 };
  }

  const hospitalId = await resolveHospitalId(folderName);
  if (!hospitalId) {
    console.log(`  SKIP: ${folderName} — DB에 병원 없음`);
    return { eq: 0, tr: 0, pr: 0 };
  }

  let eqCount = 0;
  let trCount = 0;
  let prCount = 0;

  // ── 1) hospital_equipments: 기존 삭제 후 재삽입 ──
  if (analysis.equipments.length > 0) {
    await supabase
      .from('hospital_equipments')
      .delete()
      .eq('hospital_id', hospitalId)
      .eq('source', 'crawl_v4');

    const eqRows = analysis.equipments.map((eq) => ({
      hospital_id: hospitalId,
      equipment_name: eq.equipment_name,
      equipment_brand: eq.equipment_brand ?? null,
      equipment_category: mapEquipmentCategory(eq.equipment_category),
      equipment_model: null,
      estimated_year: null,
      is_confirmed: false,
      source: 'crawl_v4',
    }));

    const { error: eqErr } = await supabase
      .from('hospital_equipments')
      .insert(eqRows);

    if (eqErr) {
      console.log(`  ERR equipments: ${eqErr.message}`);
    } else {
      eqCount = eqRows.length;
    }
  }

  // ── 2) hospital_treatments: 기존 삭제 후 재삽입 ──
  if (analysis.treatments.length > 0) {
    await supabase
      .from('hospital_treatments')
      .delete()
      .eq('hospital_id', hospitalId)
      .eq('source', 'crawl_v4');

    const trRows = analysis.treatments.map((tr) => ({
      hospital_id: hospitalId,
      treatment_name: tr.treatment_name,
      treatment_category: tr.treatment_category ?? null,
      price_min: tr.price_min ?? tr.price ?? null,
      price_max: tr.price_max ?? tr.price ?? null,
      is_promoted: tr.is_promoted ?? false,
      source: 'crawl_v4',
    }));

    const { error: trErr } = await supabase
      .from('hospital_treatments')
      .insert(trRows);

    if (trErr) {
      console.log(`  ERR treatments: ${trErr.message}`);
    } else {
      trCount = trRows.length;
    }
  }

  // ── 3) hospital_pricing: 가격 있는 시술만 ──
  const pricedTreatments = analysis.treatments.filter(
    (tr) => tr.price !== null && tr.price !== undefined && tr.price > 0
  );
  if (pricedTreatments.length > 0) {
    await supabase
      .from('hospital_pricing')
      .delete()
      .eq('hospital_id', hospitalId)
      .gte('crawled_at', '2026-02-22T00:00:00')
      .lte('crawled_at', '2026-02-23T00:00:00');

    const prRows = pricedTreatments.map((tr) => ({
      hospital_id: hospitalId,
      treatment_name: tr.treatment_name,
      standard_name: null,
      total_price: tr.price,
      unit_price: null,
      unit_type: null,
      is_event_price: tr.is_promoted ?? false,
      event_label: tr.is_promoted ? '프로모션' : null,
      confidence_level: 'EXACT',
      crawled_at: CRAWLED_AT,
    }));

    const { error: prErr } = await supabase
      .from('hospital_pricing')
      .insert(prRows);

    if (prErr) {
      console.log(`  ERR pricing: ${prErr.message}`);
    } else {
      prCount = prRows.length;
    }
  }

  // ── 4) crawl_snapshots ──
  await supabase
    .from('crawl_snapshots')
    .delete()
    .eq('hospital_id', hospitalId)
    .gte('crawled_at', '2026-02-22T00:00:00')
    .lte('crawled_at', '2026-02-23T00:00:00');

  const { error: snapErr } = await supabase
    .from('crawl_snapshots')
    .insert({
      hospital_id: hospitalId,
      crawled_at: CRAWLED_AT,
      tier: 'tier1',
      equipments_found: analysis.equipments,
      treatments_found: analysis.treatments,
      pricing_found: pricedTreatments.map((tr) => ({
        treatment_name: tr.treatment_name,
        total_price: tr.price,
        is_promoted: tr.is_promoted,
      })),
      diff_summary: `4차 E2E: 장비 ${analysis.equipments.length}개, 시술 ${analysis.treatments.length}개, 가격 ${pricedTreatments.length}건`,
    });

  if (snapErr) {
    console.log(`  ERR crawl_snapshot: ${snapErr.message}`);
  }

  return { eq: eqCount, tr: trCount, pr: prCount };
}

function mapEquipmentCategory(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('rf') || lower.includes('고주파')) return 'rf';
  if (lower.includes('hifu') || lower.includes('초음파')) return 'hifu';
  if (lower.includes('리프팅') || lower.includes('타이트닝')) return 'lifting';
  if (lower.includes('레이저')) return 'laser';
  if (lower.includes('바디')) return 'body';
  if (lower.includes('부스터') || lower.includes('스킨')) return 'booster';
  return 'other';
}

async function main(): Promise<void> {
  console.log('=== 4차 E2E 테스트 결과 → Supabase DB 업로드 ===\n');

  const folders = fs.readdirSync(SNAPSHOT_DIR).filter((f) => {
    const fullPath = path.join(SNAPSHOT_DIR, f);
    return fs.statSync(fullPath).isDirectory();
  });

  console.log(`대상 폴더: ${folders.length}개\n`);

  let totalEq = 0;
  let totalTr = 0;
  let totalPr = 0;
  let successCount = 0;

  for (const folder of folders) {
    console.log(`[${folder}]`);
    const result = await uploadHospital(folder);
    if (result.eq > 0 || result.tr > 0 || result.pr > 0) {
      successCount++;
      console.log(`  ✓ 장비 ${result.eq}건, 시술 ${result.tr}건, 가격 ${result.pr}건`);
    }
    totalEq += result.eq;
    totalTr += result.tr;
    totalPr += result.pr;
  }

  console.log(`\n=== 완료 ===`);
  console.log(`성공: ${successCount} / ${folders.length}`);
  console.log(`장비: ${totalEq}건, 시술: ${totalTr}건, 가격: ${totalPr}건`);
}

main().catch(console.error);
