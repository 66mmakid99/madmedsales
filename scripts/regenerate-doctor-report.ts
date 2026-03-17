/**
 * 기존 doctor-data-export.json을 정규화 로직으로 재처리 후
 * 새 JSON 저장 + DOCX 보고서 재생성
 *
 * DB 접속 불필요 — 기존 JSON 파일만으로 동작
 *
 * 실행: npx tsx scripts/regenerate-doctor-report.ts
 * v1.0 - 2026-03-02
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeDoctorFields } from './v5/doctor-normalize.js';
import type { StructuredAcademic } from './v5/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, '../docs/doctor-data-export.json');

interface RawDoctor {
  name: string;
  title: string;
  specialty: string | null;
  education: string[] | string | null;
  career: string[] | string | null;
  academic_activity: string | null;
  photo_url: string | null;
}

interface RawHospital {
  hospital_id: string;
  hospital_name: string;
  website: string;
  region: string;
  doctor_count: number;
  doctors: RawDoctor[];
}

interface RawReport {
  generated_at: string;
  photo_column_exists: boolean;
  summary: {
    total_doctors: number;
    total_hospitals: number;
    quality: Record<string, { count: number; pct: number }>;
  };
  hospitals: RawHospital[];
}

async function main(): Promise<void> {
  if (!fs.existsSync(JSON_PATH)) {
    console.error('doctor-data-export.json 없음. 먼저 query-doctor-data.ts를 실행하세요.');
    return;
  }

  console.log('📋 기존 JSON 로드...');
  const raw: RawReport = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));

  let totalDoctors = 0;
  let hasEdu = 0;
  let hasCareer = 0;
  let hasAcademic = 0;
  let hasSpecialty = 0;
  let hasPhoto = 0;
  const academicTypeStats: Record<string, number> = {};
  let totalAcademicItems = 0;

  // 정규화 실행
  console.log('🔄 정규화 적용 중...');
  for (const hosp of raw.hospitals) {
    for (const doc of hosp.doctors) {
      totalDoctors++;

      const result = normalizeDoctorFields({
        education: doc.education,
        career: doc.career,
        academic_activity: doc.academic_activity,
      });

      // 정규화된 값으로 덮어쓰기
      doc.education = result.education;
      doc.career = result.career;

      // structured_academic 추가
      (doc as RawDoctor & { structured_academic: Array<{ type: string; title: string; year: string | null; source: string }> }).structured_academic =
        result.academic_activities.map(a => ({
          type: a.type,
          title: a.title,
          year: a.year,
          source: 'crawl',
        }));

      // academic_activity 텍스트 갱신
      if (result.academic_activities.length > 0) {
        doc.academic_activity = result.academic_activities
          .map(a => `[${a.type}] ${a.title}`)
          .join(', ');
      }

      // 통계 집계
      if (Array.isArray(doc.education) && doc.education.length > 0) hasEdu++;
      if (Array.isArray(doc.career) && doc.career.length > 0) hasCareer++;
      if (doc.academic_activity) hasAcademic++;
      if (doc.specialty) hasSpecialty++;
      if (doc.photo_url) hasPhoto++;

      for (const a of result.academic_activities) {
        academicTypeStats[a.type] = (academicTypeStats[a.type] || 0) + 1;
        totalAcademicItems++;
      }
    }
  }

  // 새 summary
  const pct = (n: number): number => Math.round(n / totalDoctors * 100);
  const newReport = {
    generated_at: new Date().toISOString(),
    photo_column_exists: raw.photo_column_exists,
    normalized: true,
    summary: {
      total_doctors: totalDoctors,
      total_hospitals: raw.hospitals.length,
      enriched_doctors: 0,
      quality: {
        education: { count: hasEdu, pct: pct(hasEdu) },
        career: { count: hasCareer, pct: pct(hasCareer) },
        specialty: { count: hasSpecialty, pct: pct(hasSpecialty) },
        academic_activity: { count: hasAcademic, pct: pct(hasAcademic) },
        photo_url: { count: hasPhoto, pct: pct(hasPhoto) },
      },
      academic_type_breakdown: academicTypeStats,
    },
    hospitals: raw.hospitals,
  };

  // JSON 저장
  const outJson = path.resolve(__dirname, '../docs/doctor-data-export.json');
  fs.writeFileSync(outJson, JSON.stringify(newReport, null, 2), 'utf-8');
  console.log(`✅ JSON 저장: ${outJson}`);

  // 통계 출력
  console.log(`\n=== 정규화 결과 (${totalDoctors}명) ===`);
  console.log(`학력: ${hasEdu}명 (${pct(hasEdu)}%)  ← 이전 ${raw.summary.quality.education.pct}%`);
  console.log(`경력: ${hasCareer}명 (${pct(hasCareer)}%)  ← 이전 ${raw.summary.quality.career.pct}%`);
  console.log(`학술활동: ${hasAcademic}명 (${pct(hasAcademic)}%)  ← 이전 ${raw.summary.quality.academic_activity.pct}%`);

  if (totalAcademicItems > 0) {
    console.log(`\n=== 학술활동 유형별 (${totalAcademicItems}건) ===`);
    for (const [type, count] of Object.entries(academicTypeStats).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}건`);
    }
  }

  console.log('\n📄 보고서 생성 중...');
  console.log('→ npx tsx scripts/generate-doctor-data-report.ts 실행하세요.');
}

main().catch(console.error);
