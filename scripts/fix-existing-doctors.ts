/**
 * fix-existing-doctors.ts
 *
 * 기존 sales_hospital_doctors 데이터에 소급 적용:
 * 1. career/education/academic_activity 재분류 (normalizeDoctorFields)
 * 2. doctor_academic_activities 테이블에 구조화 저장
 * 3. (선택) --enrich 플래그로 웹 보강까지 실행
 *
 * 실행: npx tsx scripts/fix-existing-doctors.ts
 * 옵션: --enrich  (웹 검색 보강 포함)
 *       --dry-run (DB 변경 없이 미리보기)
 *       --limit N (처리 건수 제한)
 *
 * v1.0 - 2026-03-02
 */

import { supabase } from './utils/supabase.js';
import { normalizeDoctorFields } from './v5/doctor-normalize.js';
import { enrichDoctorBatch } from './v5/doctor-enrich.js';
import type { StructuredAcademic } from './v5/types.js';

// ============================================================
// CLI 옵션
// ============================================================

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const doEnrich = args.includes('--enrich');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

// ============================================================
// 메인
// ============================================================

async function main(): Promise<void> {
  console.log('🔄 기존 의사 데이터 정규화 시작...');
  if (dryRun) console.log('  (dry-run 모드 — DB 변경 없음)');
  if (doEnrich) console.log('  (--enrich 모드 — 웹 보강 포함)');

  // 전체 의사 조회
  let query = supabase.from('sales_hospital_doctors')
    .select('id, hospital_id, name, education, career, academic_activity');

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data: doctors, error } = await query;
  if (error) {
    console.error(`❌ 의사 조회 실패: ${error.message}`);
    process.exit(1);
  }
  if (!doctors || doctors.length === 0) {
    console.log('ℹ️ 처리할 의사 데이터 없음');
    return;
  }

  console.log(`  총 ${doctors.length}명 처리 예정\n`);

  let normalizedCount = 0;
  let academicInserted = 0;
  const stats: Record<string, number> = {};

  for (const doc of doctors) {
    const result = normalizeDoctorFields({
      education: doc.education,
      career: doc.career,
      academic_activity: doc.academic_activity,
    });

    // 통계
    for (const a of result.academic_activities) {
      stats[a.type] = (stats[a.type] || 0) + 1;
    }

    if (dryRun) {
      if (result.academic_activities.length > 0) {
        console.log(`  ${doc.name}: edu=${result.education.length}, career=${result.career.length}, academic=${result.academic_activities.length}`);
        for (const a of result.academic_activities) {
          console.log(`    [${a.type}] ${a.title}`);
        }
      }
      normalizedCount++;
      academicInserted += result.academic_activities.length;
      continue;
    }

    // education/career UPDATE
    const { error: updateErr } = await supabase.from('sales_hospital_doctors')
      .update({
        education: result.education,
        career: result.career,
        academic_activity: result.academic_activities.length > 0
          ? result.academic_activities.map(a => `[${a.type}] ${a.title}`).join(', ')
          : doc.academic_activity,
      })
      .eq('id', doc.id);

    if (updateErr) {
      console.log(`  ⚠️ ${doc.name} UPDATE 실패: ${updateErr.message}`);
      continue;
    }

    // doctor_academic_activities INSERT
    if (result.academic_activities.length > 0) {
      const rows = result.academic_activities.map((a: StructuredAcademic) => ({
        hospital_id: doc.hospital_id,
        doctor_name: doc.name,
        activity_type: a.type,
        title: a.title,
        year: a.year,
        source: 'crawl',
        source_text: a.source_text || null,
      }));

      const { error: insertErr } = await supabase.from('doctor_academic_activities').insert(rows);
      if (insertErr) {
        console.log(`  ⚠️ ${doc.name} academic INSERT 실패: ${insertErr.message}`);
      } else {
        academicInserted += rows.length;
      }
    }

    normalizedCount++;
    if (normalizedCount % 50 === 0) {
      console.log(`  ... ${normalizedCount}/${doctors.length} 처리됨`);
    }
  }

  console.log(`\n✅ 정규화 완료: ${normalizedCount}명`);
  console.log(`  학술활동 INSERT: ${academicInserted}건`);
  console.log('  활동 유형별:');
  for (const [type, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // 웹 보강 (--enrich)
  if (doEnrich && !dryRun) {
    console.log('\n🔍 웹 보강 시작...');

    // 병원별로 그룹핑
    const hospitalMap = new Map<string, typeof doctors>();
    for (const doc of doctors) {
      const list = hospitalMap.get(doc.hospital_id) || [];
      list.push(doc);
      hospitalMap.set(doc.hospital_id, list);
    }

    for (const [hospitalId, hospitalDoctors] of hospitalMap) {
      // 병원명 조회
      const { data: hospital } = await supabase.from('hospitals')
        .select('name').eq('id', hospitalId).single();
      const hospitalName = hospital?.name || '알 수 없는 병원';

      const enrichable = hospitalDoctors.map(d => ({
        name: d.name,
        education: Array.isArray(d.education) ? d.education.join('\n') : d.education,
        career: Array.isArray(d.career) ? d.career.join('\n') : d.career,
        academic_activity: d.academic_activity,
      }));

      const { enrichedNames } = await enrichDoctorBatch(enrichable, hospitalName, hospitalId);

      // 보강 결과 DB 반영
      for (const enriched of enrichable) {
        if (!enrichedNames.includes(enriched.name)) continue;

        const result = normalizeDoctorFields({
          education: enriched.education,
          career: enriched.career,
          academic_activity: enriched.academic_activity,
        });

        const original = hospitalDoctors.find(d => d.name === enriched.name);
        if (!original) continue;

        await supabase.from('sales_hospital_doctors')
          .update({
            education: result.education,
            career: result.career,
            academic_activity: result.academic_activities.length > 0
              ? result.academic_activities.map(a => `[${a.type}] ${a.title}`).join(', ')
              : enriched.academic_activity,
            enrichment_source: 'web_search',
            enriched_at: new Date().toISOString(),
          })
          .eq('id', original.id);

        if (result.academic_activities.length > 0) {
          await supabase.from('doctor_academic_activities')
            .delete()
            .eq('hospital_id', hospitalId)
            .eq('doctor_name', enriched.name);

          await supabase.from('doctor_academic_activities').insert(
            result.academic_activities.map(a => ({
              hospital_id: hospitalId,
              doctor_name: enriched.name,
              activity_type: a.type,
              title: a.title,
              year: a.year,
              source: 'enrich',
              source_text: a.source_text || null,
            })),
          );
        }
      }
    }

    console.log('✅ 웹 보강 완료');
  }
}

main().catch(err => {
  console.error('❌ 실행 실패:', err);
  process.exit(1);
});
