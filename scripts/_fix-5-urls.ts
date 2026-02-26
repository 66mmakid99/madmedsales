/**
 * 5개 CRM 병원 URL 수정 스크립트
 * verify-urls 전수 점검 결과 확인된 잘못된 URL 수정
 */
import { supabase } from './utils/supabase.js';

interface UrlFix {
  id: string;
  name: string;
  oldUrl: string;
  newUrl: string;
  note: string;
}

const fixes: UrlFix[] = [
  {
    id: 'a5aa6565-7936-4999-9d9e-7391728af7bd',
    name: '크리미의원(유성)',
    oldUrl: 'cafe.naver.com/apinkatudia',
    newUrl: 'http://creamy-yuseong.com/',
    note: '네이버카페 → 공식 홈페이지',
  },
  {
    id: '6fc26583-1d25-4fd5-925e-dce9d4dfa9ea',
    name: '셀린피부과의원',
    oldUrl: 'blog.naver.com/cellinskin',
    newUrl: 'https://cellin.kr/',
    note: '네이버블로그 → 공식 홈페이지',
  },
  {
    id: 'ce534403-4b17-43c4-becc-51cb2115e795',
    name: '휴먼피부과(평택)',
    oldUrl: 'pastelskin.com/',
    newUrl: 'http://humanpt.co.kr/main/',
    note: '다른 병원 URL → 정확한 휴먼피부과 URL',
  },
  {
    id: '28acea9c-e943-4590-b198-c9b8e22a38a6',
    name: '에어리어88성형외과',
    oldUrl: 'area88ps.com/ko/',
    newUrl: 'https://area88ps.com/',
    note: '/ko/ 접미사 제거 (크롤링 호환성)',
  },
  {
    id: '240a2525-eb68-4d07-90a5-32e277ec3edf',
    name: '포에버의원(신사)',
    oldUrl: 'as.4-ever.co.kr',
    newUrl: 'https://gn.4-ever.co.kr',
    note: 'as(안산) → gn(강남/신사) 지점',
  },
];

async function main(): Promise<void> {
  console.log('=== CRM 병원 URL 5건 수정 ===\n');

  let success = 0;
  let failed = 0;

  for (const fix of fixes) {
    // 현재 값 확인
    const { data: current, error: readErr } = await supabase
      .from('crm_hospitals')
      .select('id, name, website')
      .eq('id', fix.id)
      .single();

    if (readErr || !current) {
      console.error(`❌ ${fix.name}: 조회 실패 — ${readErr?.message}`);
      failed++;
      continue;
    }

    console.log(`📋 ${fix.name}`);
    console.log(`   현재: ${current.website}`);
    console.log(`   변경: ${fix.newUrl}`);
    console.log(`   사유: ${fix.note}`);

    // 업데이트
    const { error: updateErr } = await supabase
      .from('crm_hospitals')
      .update({ website: fix.newUrl })
      .eq('id', fix.id);

    if (updateErr) {
      console.error(`   ❌ 업데이트 실패: ${updateErr.message}`);
      failed++;
    } else {
      console.log(`   ✅ 완료`);
      success++;
    }
    console.log('');
  }

  console.log(`=== 결과: ${success}건 성공, ${failed}건 실패 ===`);
}

main().catch(console.error);
