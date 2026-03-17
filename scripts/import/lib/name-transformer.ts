/**
 * 병원명 변환 파이프라인
 * 수집 시스템 표기 → DB 등록명으로 변환 후보 생성
 */

export type TransformType =
  | 'original'
  | 'underscore_strip'      // 서울더빛의원_부산_부산진 → 서울더빛의원
  | 'branch_suffix_strip'   // 아비쥬의원강남점 → 아비쥬의원
  | 'parenthesis_extract'   // 지메디칼시스템(유니성형외과) → 유니성형외과
  | 'location_trailing'     // 에스마리의원 울산 남구 → 에스마리의원
  | 'comma_split'           // 노원,닥터쁘띠의원 → 닥터쁘띠의원
  | 'combined';             // 복수 변환 조합

export interface NameCandidate {
  name: string;           // 변환된 이름
  transformType: TransformType;
  priority: number;       // 낮을수록 먼저 시도 (1=최우선)
}

// 광역시/도 목록 (trailing 지역명 제거용)
const SIDO = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

// 점(店) 앞에 올 수 있는 지역명 패턴
const LOCATION_BEFORE_JEOM = [
  '강남', '강북', '강동', '강서', '홍대', '신촌', '건대', '혜화',
  '신도림', '여의도', '판교', '광교', '수원', '분당', '동탄', '일산',
  '명동', '신사', '청담', '압구정', '서초', '방배', '잠실', '송파',
  '논현', '역삼', '삼성', '도곡', '선릉', '양재', '개포',
  '노원', '도봉', '중랑', '성북', '은평', '마포', '서대문',
  '부산', '대구', '인천', '광주', '대전', '울산', '제주',
  '천호', '목동', '안양', '부천', '고양', '성남', '용인', '수지',
  '동래', '해운대', '범계', '센텀', '진해', '창원', '양산',
  '천안', '아산', '청주', '전주', '여수', '순천', '포항', '구미',
  '송도', '검단', '산본', '평촌', '중계', '당산', '신논현',
];

/**
 * 의원/병원 관련 키워드 포함 여부 (괄호 내용이 실제 병원명인지 판단)
 */
function looksLikeClinicName(s: string): boolean {
  return /[의원병원과클리닉센터]/.test(s) || s.length >= 4;
}

/**
 * 4단계 변환 파이프라인 — 후보 목록 반환 (priority 오름차순)
 */
export function generateCandidates(rawName: string): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  const seen = new Set<string>();

  const add = (name: string, type: TransformType, priority: number) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push({ name: trimmed, transformType: type, priority });
  };

  // 원본
  add(rawName, 'original', 1);

  // ─── A. `_` 구분자 제거 ──────────────────────────────
  // "서울더빛의원_부산_부산진" → "서울더빛의원"
  if (rawName.includes('_')) {
    const beforeUnderscore = rawName.split('_')[0].trim();
    add(beforeUnderscore, 'underscore_strip', 2);

    // 괄호 안에 _ 있는 경우: "더안헬스케어 (넬의원_부산_부산진)"
    const parenUnderMatch = rawName.match(/[（(]([^)）_]+)_/);
    if (parenUnderMatch) {
      add(parenUnderMatch[1].trim(), 'combined', 3);
    }
  }

  // ─── B. 점(店) suffix 제거 ──────────────────────────
  // "아비쥬의원강남점" → "아비쥬의원"
  // "지미의원 대구점" → "지미의원"
  const jeomPatterns = [
    // {병원명}{지역}점 붙어있는 경우
    new RegExp(`(.*?)(${LOCATION_BEFORE_JEOM.join('|')})점$`),
    // {병원명} {지역}점 띄어쓰기
    new RegExp(`(.*?)\\s+(${LOCATION_BEFORE_JEOM.join('|')})점$`),
    // 그냥 뒤에 점으로 끝나는 경우 (지역명 없이)
    /^(.*?의원|.*?병원|.*?클리닉|.*?센터)[가-힣]+점$/,
  ];

  for (const pattern of jeomPatterns) {
    const m = rawName.match(pattern);
    if (m && m[1]) {
      add(m[1].trim(), 'branch_suffix_strip', 4);
      break;
    }
  }

  // ─── C. 괄호 내 실제 병원명 추출 ────────────────────
  // "지메디칼시스템(유니성형외과)" → "유니성형외과"
  // "타이터스(라피스여성의원)" → "라피스여성의원"
  const parenMatch = rawName.match(/[（(]([^)）]+)[)）]/);
  if (parenMatch) {
    const inner = parenMatch[1].trim();
    if (looksLikeClinicName(inner)) {
      add(inner, 'parenthesis_extract', 5);
      // 괄호 안에도 _ 있으면 _ 앞만
      if (inner.includes('_')) {
        add(inner.split('_')[0].trim(), 'combined', 6);
      }
    }
    // 괄호 앞부분도 후보 (사업자명이 실제 병원명인 경우)
    const outer = rawName.replace(/\s*[（(][^)）]+[)）]\s*/g, '').trim();
    if (outer && looksLikeClinicName(outer)) {
      add(outer, 'combined', 7);
    }
  }

  // ─── E. 쉼표(,) 구분자 처리 ─────────────────────────
  // "노원,닥터쁘띠의원" → "닥터쁘띠의원" (쉼표 뒤가 병원명)
  if (rawName.includes(',')) {
    const parts = rawName.split(',');
    // 쉼표 뒤 부분이 병원명
    const afterComma = parts[parts.length - 1].trim();
    if (afterComma) add(afterComma, 'comma_split', 3);
    // 쉼표 앞 부분이 병원명인 경우도 후보
    const beforeComma = parts[0].trim();
    if (beforeComma && beforeComma !== afterComma) {
      add(beforeComma, 'comma_split', 7);
    }
  }

  // ─── D. 공백+지역명 trailing 제거 ─────────────────
  // "에스마리의원 울산 남구" → "에스마리의원"
  // "더블유의원 경남 양산" → "더블유의원"
  const locationTrailing = new RegExp(
    `^(.+?)\\s+(${SIDO.join('|')})(\\s+[가-힣]+[시군구읍면])?$`
  );
  const ltMatch = rawName.match(locationTrailing);
  if (ltMatch) {
    add(ltMatch[1].trim(), 'location_trailing', 8);
  }

  // 단순 공백+한글 2~4글자 trailing (지역명으로 보이는 경우)
  const simpleTrailing = rawName.match(/^(.+?)\s+([가-힣]{2,4})$/);
  if (simpleTrailing && simpleTrailing[2].length <= 4) {
    add(simpleTrailing[1].trim(), 'location_trailing', 9);
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}

/**
 * 단위 테스트용 헬퍼
 */
export function testTransform(input: string): void {
  const candidates = generateCandidates(input);
  console.log(`\n입력: "${input}"`);
  candidates.forEach(c => {
    console.log(`  [${c.priority}] ${c.transformType.padEnd(22)} → "${c.name}"`);
  });
}
