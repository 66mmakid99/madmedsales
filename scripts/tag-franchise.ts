/**
 * tag-franchise.ts
 *
 * hospitals.name에서 프랜차이즈 브랜드를 감지하여 franchise_brand 컬럼에 태깅.
 * 같은 브랜드명이 3개 이상 + 2개 이상 시군구에 분포된 경우 프랜차이즈로 판정.
 *
 * Usage: npx tsx scripts/tag-franchise.ts
 */

import { supabase } from './utils/supabase.js';

// 지점명으로 자주 사용되는 지역명 패턴
const BRANCH_SUFFIXES = [
  '강남', '신사', '압구정', '청담', '명동', '홍대', '잠실', '분당', '판교',
  '수원', '부산', '대구', '인천', '광주', '대전', '울산', '제주', '일산',
  '동탄', '평촌', '산본', '천안', '전주', '창원', '김해', '해운대', '서면',
  '센텀', '동래', '강서', '마포', '송파', '영등포', '서초', '강동', '노원',
  '관악', '구로', '종로', '신촌', '역삼', '논현', '선릉', '삼성', '교대',
  '방배', '사당', '이태원', '한남', '합정', '연남', '상수', '성수', '건대',
  '왕십리', '목동', '미아', '수유', '도봉', '창동', '상봉', '망우', '구리',
  '하남', '위례', '광교', '동백', '죽전', '정자', '미금', '야탑', '서현',
  '수내', '모란', '복정', '안산', '안양', '부천', '시흥', '광명', '김포',
  '고양', '의정부', '남양주', '파주', '양주', '포천', '평택', '오산', '화성',
  '용인', '이천', '여주', '양평', '가평', '연천', '동두천', '과천', '군포',
  '의왕', '성남', '하남시', '구리시',
];

const BRANCH_PATTERN = new RegExp(
  `\\s*(${BRANCH_SUFFIXES.join('|')})점?$`
);

function extractBrand(name: string): string {
  // 1) 괄호 제거: "벨버티의원(광주)" → "벨버티의원"
  let brand = name.replace(/\s*[\(（].*[\)）]/g, '');
  // 2) 지점 접미사 제거: "톡스앤필 강서" → "톡스앤필"
  brand = brand.replace(BRANCH_PATTERN, '');
  return brand.trim();
}

interface BrandInfo {
  brand: string;
  hospitalIds: string[];
  locations: Set<string>;
}

async function main(): Promise<void> {
  console.log('프랜차이즈 브랜드 태깅 시작\n');

  // 1) 전체 hospitals 로드
  console.log('[1] hospitals 전체 조회...');
  const PAGE = 1000;
  let offset = 0;
  const brandMap = new Map<string, BrandInfo>();

  while (true) {
    const { data: hospitals, error } = await supabase
      .from('hospitals')
      .select('id, name, sigungu')
      .eq('status', 'active')
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`Query error: ${error.message}`);
    if (!hospitals || hospitals.length === 0) break;

    for (const h of hospitals) {
      const brand = extractBrand(h.name);
      if (brand.length < 2) continue;

      const info = brandMap.get(brand) ?? { brand, hospitalIds: [], locations: new Set<string>() };
      info.hospitalIds.push(h.id);
      if (h.sigungu) info.locations.add(h.sigungu);
      brandMap.set(brand, info);
    }

    offset += PAGE;
    if (hospitals.length < PAGE) break;
  }

  // 2) 프랜차이즈 판정: 3개 이상 병원 + 2개 이상 지역
  const franchises = [...brandMap.values()]
    .filter(b => b.hospitalIds.length >= 3 && b.locations.size >= 2)
    .sort((a, b) => b.hospitalIds.length - a.hospitalIds.length);

  console.log(`  -> 총 ${brandMap.size}개 브랜드 중 ${franchises.length}개 프랜차이즈 감지\n`);

  // 3) franchise_brand 초기화 (이전 태깅 제거)
  console.log('[2] 기존 franchise_brand 초기화...');
  const { error: resetErr } = await supabase
    .from('hospitals')
    .update({ franchise_brand: null })
    .not('franchise_brand', 'is', null);
  if (resetErr) console.error('  초기화 실패:', resetErr.message);

  // 4) 배치 업데이트
  console.log('[3] 프랜차이즈 태깅...');
  let totalTagged = 0;

  for (const f of franchises) {
    const CHUNK = 200;
    for (let i = 0; i < f.hospitalIds.length; i += CHUNK) {
      const chunk = f.hospitalIds.slice(i, i + CHUNK);
      const { error: upErr } = await supabase
        .from('hospitals')
        .update({ franchise_brand: f.brand })
        .in('id', chunk);

      if (upErr) {
        console.error(`  태깅 실패 [${f.brand}]: ${upErr.message}`);
      } else {
        totalTagged += chunk.length;
      }
    }
  }

  // 5) 결과 리포트
  console.log('\n========================================');
  console.log('  프랜차이즈 태깅 결과');
  console.log('========================================');
  console.log(`  프랜차이즈 브랜드: ${franchises.length}개`);
  console.log(`  태깅된 병원:      ${totalTagged}개`);
  console.log('========================================\n');

  console.log(`${'브랜드'.padEnd(30)}${'병원수'.padStart(6)}${'지역수'.padStart(6)}  지역 샘플`);
  console.log('-'.repeat(100));

  for (const f of franchises) {
    const name = f.brand.substring(0, 28).padEnd(30);
    const cnt = String(f.hospitalIds.length).padStart(6);
    const locs = String(f.locations.size).padStart(6);
    const sample = [...f.locations].slice(0, 5).join(', ');
    console.log(`${name}${cnt}${locs}  ${sample}`);
  }

  console.log('\n완료!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
