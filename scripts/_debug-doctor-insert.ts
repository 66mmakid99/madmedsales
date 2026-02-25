/**
 * Debug script: "malformed array literal" 에러 진단
 * hospital_doctors 테이블에 INSERT 시 발생하는 문제 추적
 *
 * 1) 포에버의원의 hospital_id 확인 (crm_hospitals -> hospitals)
 * 2) hospital_crawl_pages에서 gemini_analyzed=true인 페이지 조회
 * 3) hospital_doctors에서 기존 데이터 조회 (컬럼 타입 확인)
 * 4) 다양한 형태의 career/education 데이터로 INSERT 테스트
 */
import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  console.log('=== hospital_doctors "malformed array literal" 디버그 ===\n');

  // ── 1. 포에버의원 찾기 (crm_hospitals → hospitals) ──
  console.log('--- 1. 포에버의원 hospital_id 조회 ---');

  const { data: crmHospitals, error: crmErr } = await supabase
    .from('crm_hospitals')
    .select('id, name, hospital_ref_id')
    .ilike('name', '%포에버%');

  if (crmErr) {
    console.error('crm_hospitals 조회 에러:', crmErr.message);
  }

  let hospitalId: string | null = null;

  if (crmHospitals && crmHospitals.length > 0) {
    console.log('crm_hospitals 결과:');
    for (const ch of crmHospitals) {
      console.log(`  crm_id=${ch.id}, name=${ch.name}, hospital_ref_id=${ch.hospital_ref_id}`);
      if (ch.hospital_ref_id) {
        hospitalId = ch.hospital_ref_id as string;
      }
    }
  } else {
    console.log('crm_hospitals에서 못 찾음. hospitals 테이블 직접 검색...');
  }

  // hospitals 테이블에서도 직접 검색
  const { data: hospitals, error: hErr } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .ilike('name', '%포에버%');

  if (hErr) {
    console.error('hospitals 조회 에러:', hErr.message);
  }

  if (hospitals && hospitals.length > 0) {
    console.log('hospitals 테이블 결과:');
    for (const h of hospitals) {
      console.log(`  id=${h.id}, name=${h.name}, website=${h.website}`);
      if (!hospitalId) hospitalId = h.id as string;
    }
  }

  if (!hospitalId) {
    console.error('\n포에버의원을 찾을 수 없습니다. 아무 병원이나 사용합니다...');
    const { data: anyH } = await supabase
      .from('hospital_doctors')
      .select('hospital_id')
      .limit(1)
      .single();
    if (anyH) {
      hospitalId = anyH.hospital_id as string;
      console.log(`  대체 hospital_id: ${hospitalId}`);
    } else {
      // 아무 병원이나
      const { data: fallback } = await supabase
        .from('hospitals')
        .select('id')
        .limit(1)
        .single();
      hospitalId = fallback?.id as string;
      console.log(`  대체 hospital_id: ${hospitalId}`);
    }
  }

  console.log(`\n사용할 hospital_id: ${hospitalId}\n`);

  // ── 2. hospital_crawl_pages 조회 ──
  console.log('--- 2. hospital_crawl_pages (gemini_analyzed=true) ---');

  const { data: pages, error: pageErr } = await supabase
    .from('hospital_crawl_pages')
    .select('id, url, page_type, char_count, gemini_analyzed, crawled_at')
    .eq('hospital_id', hospitalId)
    .eq('gemini_analyzed', true);

  if (pageErr) {
    console.error('crawl_pages 조회 에러:', pageErr.message);
  } else if (pages && pages.length > 0) {
    console.log(`분석 완료된 페이지: ${pages.length}개`);
    for (const p of pages) {
      console.log(`  page_type=${p.page_type}, char_count=${p.char_count}, url=${p.url}`);
    }
  } else {
    console.log('분석 완료된 페이지 없음');
    // gemini_analyzed 상관없이 전체 조회
    const { data: allPages } = await supabase
      .from('hospital_crawl_pages')
      .select('id, url, page_type, char_count, gemini_analyzed')
      .eq('hospital_id', hospitalId);
    if (allPages && allPages.length > 0) {
      console.log(`전체 크롤 페이지: ${allPages.length}개`);
      for (const p of allPages) {
        console.log(`  page_type=${p.page_type}, char_count=${p.char_count}, analyzed=${p.gemini_analyzed}`);
      }
    } else {
      console.log('크롤 페이지 자체가 없음');
    }
  }

  // ── 3. hospital_doctors 기존 데이터 조회 ──
  console.log('\n--- 3. hospital_doctors 기존 데이터 ---');

  const { data: doctors, error: drErr } = await supabase
    .from('hospital_doctors')
    .select('*')
    .eq('hospital_id', hospitalId);

  if (drErr) {
    console.error('hospital_doctors 조회 에러:', drErr.message);
  } else if (doctors && doctors.length > 0) {
    console.log(`의사 수: ${doctors.length}`);
    for (const dr of doctors) {
      console.log(`\n  name: ${dr.name}`);
      console.log(`  title: ${dr.title}`);
      console.log(`  specialty: ${dr.specialty}`);
      console.log(`  career type: ${typeof dr.career} | isArray: ${Array.isArray(dr.career)}`);
      console.log(`  career value: ${JSON.stringify(dr.career)}`);
      console.log(`  education type: ${typeof dr.education} | isArray: ${Array.isArray(dr.education)}`);
      console.log(`  education value: ${JSON.stringify(dr.education)}`);
      console.log(`  academic_activity: ${dr.academic_activity}`);
      console.log(`  source: ${dr.source}`);
    }
  } else {
    console.log('기존 의사 데이터 없음');
  }

  // ── 4. INSERT 테스트 ──
  console.log('\n--- 4. INSERT 테스트 ---');

  const testCases = [
    {
      label: 'A) career/education = 빈 배열 (정상)',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_A',
        title: '원장',
        specialty: '피부과전문의',
        career: [],
        education: [],
        source: 'debug_test',
      },
    },
    {
      label: 'B) career = string[] 배열 (정상 기대)',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_B',
        title: '원장',
        specialty: '성형외과전문의',
        career: ['서울대학교 의과대학 졸업', '삼성서울병원 전공의', '대한피부과학회 정회원'],
        education: ['서울대학교 의과대학', '서울대학교 대학원 석사'],
        source: 'debug_test',
      },
    },
    {
      label: 'C) career = 쉼표 포함 plain string (이게 에러 원인?)',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_C',
        title: '원장',
        specialty: null,
        career: '서울대학교 의과대학 졸업, 삼성서울병원 전공의, 대한피부과학회 정회원' as unknown,
        education: '서울대학교 의과대학' as unknown,
        source: 'debug_test',
      },
    },
    {
      label: 'D) career = 중괄호/특수문자 포함 string',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_D',
        title: '원장',
        specialty: null,
        career: '{이것은, 중괄호, 테스트}' as unknown,
        education: null,
        source: 'debug_test',
      },
    },
    {
      label: 'E) career = 줄바꿈→쉼표 변환된 string (recrawl-v3 sanitize 패턴)',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_E',
        title: '원장',
        specialty: null,
        career: '서울대학교 의과대학 졸업, 삼성서울병원 레지던트(피부과), "대한피부과학회" 정회원' as unknown,
        education: '서울대 의대, 서울대 대학원(석사)' as unknown,
        source: 'debug_test',
      },
    },
    {
      label: 'F) career = null (정상)',
      data: {
        hospital_id: hospitalId,
        name: '__DEBUG_TEST_F',
        title: '원장',
        specialty: null,
        career: null,
        education: null,
        source: 'debug_test',
      },
    },
  ];

  const insertedIds: string[] = [];

  for (const tc of testCases) {
    console.log(`\n${tc.label}`);
    console.log(`  전송 데이터: career=${JSON.stringify(tc.data.career)}, education=${JSON.stringify(tc.data.education)}`);

    const { data: inserted, error: insertErr } = await supabase
      .from('hospital_doctors')
      .insert(tc.data)
      .select('id');

    if (insertErr) {
      console.log(`  ❌ 에러: ${insertErr.message}`);
      console.log(`  에러 코드: ${insertErr.code}`);
      console.log(`  에러 상세: ${insertErr.details}`);
      console.log(`  에러 힌트: ${insertErr.hint}`);
    } else {
      const id = inserted?.[0]?.id as string;
      console.log(`  ✅ 성공! id=${id}`);
      if (id) insertedIds.push(id);
    }
  }

  // ── 5. 삽입된 데이터 확인 후 삭제 ──
  console.log('\n--- 5. 테스트 데이터 정리 ---');

  if (insertedIds.length > 0) {
    // 삽입된 데이터 다시 읽어서 DB에 어떻게 저장됐는지 확인
    const { data: verifyData } = await supabase
      .from('hospital_doctors')
      .select('id, name, career, education')
      .in('id', insertedIds);

    if (verifyData) {
      console.log('DB에 저장된 실제 값:');
      for (const v of verifyData) {
        console.log(`  ${v.name}: career=${JSON.stringify(v.career)}, education=${JSON.stringify(v.education)}`);
      }
    }

    // 삭제
    const { error: delErr } = await supabase
      .from('hospital_doctors')
      .delete()
      .like('name', '__DEBUG_TEST_%');

    if (delErr) {
      console.error(`테스트 데이터 삭제 에러: ${delErr.message}`);
    } else {
      console.log(`테스트 데이터 ${insertedIds.length}건 삭제 완료`);
    }
  }

  // ── 6. 결론 ──
  console.log('\n=== 진단 요약 ===');
  console.log('hospital_doctors 스키마:');
  console.log('  career   TEXT[]  (PostgreSQL 배열)');
  console.log('  education TEXT[] (PostgreSQL 배열)');
  console.log('');
  console.log('recrawl-v3.ts sanitize() 함수가 줄바꿈을 쉼표로 치환하여');
  console.log('TEXT[] 컬럼에 plain string을 넣으면 "malformed array literal" 발생.');
  console.log('해결: career/education을 string[]로 넣거나, DB 컬럼을 TEXT로 변경.');
}

main().catch(console.error);
