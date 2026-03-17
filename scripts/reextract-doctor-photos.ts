/**
 * 의사 프로필 사진 재추출 스크립트
 *
 * 기존 photo_url을 모두 초기화하고, Gemini Vision 검증 기반으로 재추출
 *
 * 실행: npx tsx scripts/reextract-doctor-photos.ts
 * 옵션:
 *   --limit N    : 병원 수 제한
 *   --hospital "이름"  : 특정 병원만
 *   --keep       : 기존 photo_url 유지 (새로 없는 것만 추출)
 *
 * v1.0 - 2026-03-03
 */
import { supabase } from './utils/supabase.js';
import { extractDoctorPhotosFromPage } from './v5/doctor-photo.js';

interface HospitalWithDoctors {
  id: string;
  name: string;
  website: string;
  doctors: Array<{ name: string; photo_url: string | null }>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;
  const hospitalIdx = args.indexOf('--hospital');
  const hospitalFilter = hospitalIdx >= 0 ? args[hospitalIdx + 1] : '';
  const keepExisting = args.includes('--keep');

  console.log('=== 의사 프로필 사진 재추출 (Gemini Vision v3.0) ===');
  if (keepExisting) console.log('  모드: --keep (기존 사진 유지, 빈 것만 추출)');
  else console.log('  모드: 전체 초기화 후 재추출');

  // 1. 의사 데이터가 있는 병원 + 웹사이트 조회
  const { data: doctors, error: docErr } = await supabase
    .from('sales_hospital_doctors')
    .select('hospital_id, name, photo_url');

  if (docErr || !doctors) {
    console.error('의사 조회 실패:', docErr?.message);
    return;
  }

  // 병원별 그룹핑
  const byHospital = new Map<string, Array<{ name: string; photo_url: string | null }>>();
  for (const d of doctors) {
    const arr = byHospital.get(d.hospital_id) || [];
    arr.push({ name: d.name, photo_url: d.photo_url });
    byHospital.set(d.hospital_id, arr);
  }

  // 병원 정보 조회
  const hospitalIds = [...byHospital.keys()];
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .in('id', hospitalIds)
    .not('website', 'is', null)
    .neq('website', '');

  if (!hospitals || hospitals.length === 0) {
    console.log('웹사이트 있는 병원 없음');
    return;
  }

  let targets: HospitalWithDoctors[] = hospitals
    .map((h) => ({
      id: h.id,
      name: h.name,
      website: h.website,
      doctors: byHospital.get(h.id) || [],
    }))
    .filter((h) => h.doctors.length > 0);

  if (hospitalFilter) {
    targets = targets.filter((h) => h.name.includes(hospitalFilter));
    console.log(`  병원 필터: "${hospitalFilter}" → ${targets.length}개`);
  }

  if (limit > 0) targets = targets.slice(0, limit);

  console.log(`  대상: ${targets.length}개 병원, ${targets.reduce((s, h) => s + h.doctors.length, 0)}명 의사\n`);

  // 2. 기존 photo_url 초기화 (--keep 아닌 경우)
  if (!keepExisting) {
    const { error: clearErr } = await supabase
      .from('sales_hospital_doctors')
      .update({ photo_url: null })
      .not('photo_url', 'is', null);

    if (clearErr) console.log(`  ⚠️ photo_url 초기화 실패: ${clearErr.message}`);
    else console.log('  🗑️ 기존 photo_url 전체 초기화 완료\n');
  }

  // 3. 병원별 사진 추출
  let totalFound = 0;
  let totalDoctors = 0;

  for (let i = 0; i < targets.length; i++) {
    const h = targets[i];
    const doctorNames = keepExisting
      ? h.doctors.filter((d) => !d.photo_url).map((d) => d.name)
      : h.doctors.map((d) => d.name);

    if (doctorNames.length === 0) {
      console.log(`[${i + 1}/${targets.length}] ${h.name} — 추출 대상 없음 (전원 사진 있음)`);
      continue;
    }

    totalDoctors += doctorNames.length;
    console.log(`\n[${i + 1}/${targets.length}] ${h.name} (${doctorNames.length}명) — ${h.website}`);

    try {
      const results = await extractDoctorPhotosFromPage(h.website, h.id, doctorNames);

      // DB 업데이트
      for (const r of results) {
        if (!r.photoUrl) continue;
        totalFound++;

        const { error: updateErr } = await supabase
          .from('sales_hospital_doctors')
          .update({ photo_url: r.photoUrl })
          .eq('hospital_id', h.id)
          .eq('name', r.doctorName);

        if (updateErr) {
          console.log(`    ⚠️ DB 업데이트 실패 (${r.doctorName}): ${updateErr.message}`);
        }
      }
    } catch (err) {
      console.log(`  ❌ 실패: ${(err as Error).message}`);
    }

    // rate limit
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\n=== 완료 ===`);
  console.log(`  대상: ${targets.length}개 병원 / ${totalDoctors}명 의사`);
  console.log(`  사진 확보: ${totalFound}명 (${totalDoctors > 0 ? Math.round(totalFound / totalDoctors * 100) : 0}%)`);
}

main().catch(console.error);
