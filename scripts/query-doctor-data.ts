/**
 * 수집된 의사 데이터 현황 조회 → JSON 저장
 * v2.0: 구조화 학술활동(doctor_academic_activities) + 보강 출처 포함
 * 실행: npx tsx scripts/query-doctor-data.ts
 */
import { supabase } from './utils/supabase.js';
import fs from 'fs';

interface DoctorRow {
  hospital_id: string;
  name: string;
  title: string;
  specialty: string | null;
  education: string[] | string | null;
  career: string[] | string | null;
  academic_activity: string | null;
  photo_url?: string | null;
  enrichment_source?: string | null;
  enriched_at?: string | null;
}

interface AcademicRow {
  hospital_id: string;
  doctor_name: string;
  activity_type: string;
  title: string;
  year: string | null;
  source: string;
}

async function main(): Promise<void> {
  // 1. 전체 의사 수
  const { count: totalDoctors } = await supabase
    .from('sales_hospital_doctors')
    .select('*', { count: 'exact', head: true });
  console.log(`=== 전체 의사 수: ${totalDoctors} ===`);

  // 2. photo_url 컬럼 존재 확인 및 조회
  let hasPhotoColumn = false;
  let doctors: DoctorRow[] = [];

  const { data: d1, error: e1 } = await supabase
    .from('sales_hospital_doctors')
    .select('hospital_id, name, title, specialty, education, career, academic_activity, photo_url, enrichment_source, enriched_at')
    .limit(1000);

  if (e1) {
    console.log(`  (일부 컬럼 미존재 — fallback 쿼리)`);
    const { data: d2, error: e2 } = await supabase
      .from('sales_hospital_doctors')
      .select('hospital_id, name, title, specialty, education, career, academic_activity')
      .limit(1000);
    if (e2 || !d2) { console.log(`=== 조회 실패: ${e2?.message} ===`); return; }
    doctors = d2.map(d => ({ ...d, photo_url: null }));
  } else {
    hasPhotoColumn = true;
    doctors = d1 || [];
  }

  // 구조화 학술활동 조회
  let academicRows: AcademicRow[] = [];
  const { data: aaData, error: aaErr } = await supabase
    .from('doctor_academic_activities')
    .select('hospital_id, doctor_name, activity_type, title, year, source');
  if (aaErr) {
    console.log(`  (doctor_academic_activities 테이블 미존재 — 마이그레이션 028 미적용)`);
  } else {
    academicRows = aaData || [];
  }

  // 학술활동 → 의사별 그룹핑
  const academicByDoctor = new Map<string, AcademicRow[]>();
  for (const a of academicRows) {
    const key = `${a.hospital_id}::${a.doctor_name}`;
    const arr = academicByDoctor.get(key) || [];
    arr.push(a);
    academicByDoctor.set(key, arr);
  }

  if (doctors.length === 0) {
    console.log('=== 의사 데이터 없음 ===');
    return;
  }

  // 3. 병원ID별 그룹핑
  const byHospital = new Map<string, DoctorRow[]>();
  for (const d of doctors) {
    const arr = byHospital.get(d.hospital_id) || [];
    arr.push(d);
    byHospital.set(d.hospital_id, arr);
  }

  // 4. 병원 이름 조회
  const hospitalIds = [...byHospital.keys()];
  const { data: hospitals } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu')
    .in('id', hospitalIds);

  const hospMap = new Map<string, { name: string; website: string; sido: string; sigungu: string }>();
  if (hospitals) {
    for (const h of hospitals) {
      hospMap.set(h.id, { name: h.name, website: h.website || '', sido: h.sido || '', sigungu: h.sigungu || '' });
    }
  }

  // 5. 통계
  const eduArr = (d: DoctorRow): boolean => {
    if (!d.education) return false;
    if (Array.isArray(d.education)) return d.education.length > 0;
    return typeof d.education === 'string' && d.education.trim().length > 0;
  };
  const carArr = (d: DoctorRow): boolean => {
    if (!d.career) return false;
    if (Array.isArray(d.career)) return d.career.length > 0;
    return typeof d.career === 'string' && d.career.trim().length > 0;
  };

  const hasEdu = doctors.filter(eduArr).length;
  const hasCareer = doctors.filter(carArr).length;
  const hasAcademic = doctors.filter(d => d.academic_activity).length;
  const hasSpecialty = doctors.filter(d => d.specialty).length;
  const hasPhoto = doctors.filter(d => d.photo_url).length;
  const hasEnriched = doctors.filter(d => d.enrichment_source).length;

  // 학술활동 유형별 통계
  const academicTypeStats: Record<string, number> = {};
  const doctorsWithStructuredAcademic = new Set<string>();
  for (const a of academicRows) {
    academicTypeStats[a.activity_type] = (academicTypeStats[a.activity_type] || 0) + 1;
    doctorsWithStructuredAcademic.add(`${a.hospital_id}::${a.doctor_name}`);
  }

  console.log(`\n=== 데이터 품질 (${doctors.length}명) ===`);
  console.log(`학력 보유: ${hasEdu}명 (${Math.round(hasEdu / doctors.length * 100)}%)`);
  console.log(`경력 보유: ${hasCareer}명 (${Math.round(hasCareer / doctors.length * 100)}%)`);
  console.log(`전문분야: ${hasSpecialty}명 (${Math.round(hasSpecialty / doctors.length * 100)}%)`);
  console.log(`학술활동: ${hasAcademic}명 (${Math.round(hasAcademic / doctors.length * 100)}%)`);
  console.log(`프로필사진: ${hasPhoto}명 (${Math.round(hasPhoto / doctors.length * 100)}%) ${!hasPhotoColumn ? '(컬럼 미적용)' : ''}`);
  if (hasEnriched > 0) console.log(`웹 보강: ${hasEnriched}명`);

  if (Object.keys(academicTypeStats).length > 0) {
    console.log(`\n=== 학술활동 유형별 (${academicRows.length}건, ${doctorsWithStructuredAcademic.size}명) ===`);
    for (const [type, count] of Object.entries(academicTypeStats).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}건`);
    }
  }

  // 6. JSON 저장
  const report = {
    generated_at: new Date().toISOString(),
    photo_column_exists: hasPhotoColumn,
    summary: {
      total_doctors: totalDoctors,
      total_hospitals: byHospital.size,
      enriched_doctors: hasEnriched,
      quality: {
        education: { count: hasEdu, pct: Math.round(hasEdu / doctors.length * 100) },
        career: { count: hasCareer, pct: Math.round(hasCareer / doctors.length * 100) },
        specialty: { count: hasSpecialty, pct: Math.round(hasSpecialty / doctors.length * 100) },
        academic_activity: { count: hasAcademic, pct: Math.round(hasAcademic / doctors.length * 100) },
        photo_url: { count: hasPhoto, pct: Math.round(hasPhoto / doctors.length * 100) },
      },
      academic_type_breakdown: academicTypeStats,
    },
    hospitals: [...byHospital.entries()].map(([hid, docs]) => {
      const h = hospMap.get(hid);
      return {
        hospital_id: hid,
        hospital_name: h?.name || '(이름없음)',
        website: h?.website || '',
        region: [h?.sido, h?.sigungu].filter(Boolean).join(' '),
        doctor_count: docs.length,
        doctors: docs.map(d => {
          const key = `${d.hospital_id}::${d.name}`;
          const structured = academicByDoctor.get(key) || [];
          return {
            name: d.name,
            title: d.title,
            specialty: d.specialty || null,
            education: d.education || [],
            career: d.career || [],
            academic_activity: d.academic_activity || null,
            structured_academic: structured.map(a => ({
              type: a.activity_type,
              title: a.title,
              year: a.year,
              source: a.source,
            })),
            photo_url: d.photo_url || null,
            enrichment_source: d.enrichment_source || null,
          };
        }),
      };
    }),
  };

  const outPath = 'docs/doctor-data-export.json';
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n=== JSON 저장: ${outPath} ===`);

  // 7. 병원별 요약
  console.log(`\n=== 병원별 의사 현황 (${byHospital.size}개 병원) ===`);
  for (const [hid, docs] of byHospital) {
    const h = hospMap.get(hid);
    const ec = docs.filter(eduArr).length;
    const cc = docs.filter(carArr).length;
    console.log(`  ${(h?.name || hid).padEnd(20)} | 의사 ${String(docs.length).padStart(2)}명 | 학력 ${ec} | 경력 ${cc}`);
  }
}

main().catch(console.error);
