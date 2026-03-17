import { buildBulkDataMaps, supabase } from './data-loader.js';
import { profileHospital } from './hospital-profiler.js';
import { matchTorr } from './torr-matcher.js';
import { normalizeAndWeight } from './normalizer.js';
import type { HospitalDataBundle, ScoringResult, BulkDataMaps } from './types.js';

export { type ScoringResult } from './types.js';

export async function scoreAllHospitals(
  options?: { dryRun?: boolean; hospitalId?: string },
): Promise<ScoringResult[]> {
  const bulkData = await buildBulkDataMaps();

  // 대상 병원 식별
  let hospitalIds: string[];
  if (options?.hospitalId) {
    if (!bulkData.allHospitalIds.has(options.hospitalId)) {
      console.error(`❌ 병원 ${options.hospitalId} 데이터 없음`);
      return [];
    }
    hospitalIds = [options.hospitalId];
  } else {
    hospitalIds = [...bulkData.allHospitalIds];
  }

  console.log(`\n🏥 스코어링 대상: ${hospitalIds.length}개 병원`);

  // 각 병원별 raw score 계산
  const rawResults: ScoringResult[] = [];

  for (const id of hospitalIds) {
    const bundle = buildBundle(id, bulkData);
    const { scores: profiler, details: profilerDetails } = profileHospital(bundle);
    const { scores: torr, details: torrDetails } = matchTorr(bundle);

    const dataCompleteness = calcCompleteness(bundle);

    rawResults.push({
      hospitalId: id,
      profiler,
      torr,
      finalScore: 0, // normalizer가 계산
      dataCompleteness,
      details: {
        ...profilerDetails,
        torrDetails,
      },
    });
  }

  // 코호트 백분위 정규화
  const normalized = normalizeAndWeight(rawResults);

  // DB에 UPSERT
  if (!options?.dryRun) {
    await upsertScores(normalized);
  } else {
    console.log('🔍 DRY RUN — DB 저장 생략');
  }

  // final_target_score DESC 정렬
  normalized.sort((a, b) => b.finalScore - a.finalScore);

  return normalized;
}

function buildBundle(hospitalId: string, data: BulkDataMaps): HospitalDataBundle {
  return {
    hospitalId,
    snapshot: data.snapshots.get(hospitalId) || null,
    doctorCount: data.doctorCounts.get(hospitalId) || 0,
    equipment: data.equipmentMaster.get(hospitalId) || [],
    session: data.sessions.get(hospitalId) || null,
    pages: data.pageCounts.get(hospitalId) || { event: 0, blog: 0, price: 0, treatment: 0, total: 0 },
  };
}

function calcCompleteness(bundle: HospitalDataBundle): number {
  let sources = 0;
  const total = 5;
  if (bundle.snapshot) sources++;
  if (bundle.doctorCount > 0) sources++;
  if (bundle.equipment.length > 0) sources++;
  if (bundle.session) sources++;
  if (bundle.pages.total > 0) sources++;
  return Math.round((sources / total) * 100) / 100;
}

async function upsertScores(results: ScoringResult[]): Promise<void> {
  const BATCH_SIZE = 100;
  let upserted = 0;

  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE).map((r) => ({
      hospital_id: r.hospitalId,
      investment_score: r.profiler.investment,
      portfolio_score: r.profiler.portfolio,
      scale_score: r.profiler.scale,
      marketing_score: r.profiler.marketing,
      total_score: r.profiler.total,
      torr_bridge_score: r.torr.bridge,
      torr_postop_score: r.torr.postop,
      torr_mens_score: r.torr.mens,
      torr_painless_score: r.torr.painless,
      torr_body_score: r.torr.body,
      torr_total_score: r.torr.total,
      final_target_score: r.finalScore,
      data_completeness: r.dataCompleteness,
      scoring_details: r.details,
      scored_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('hospital_scores')
      .upsert(batch, { onConflict: 'hospital_id' });

    if (error) {
      console.error(`❌ UPSERT 실패 (batch ${i}): ${error.message}`);
      continue;
    }
    upserted += batch.length;
  }

  console.log(`💾 ${upserted}/${results.length}건 저장 완료`);
}
