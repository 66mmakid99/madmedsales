/**
 * 병원명 원본에서 지역 hint 추출
 * 모호 케이스 지역 tiebreak 용도
 */

const SIDO_MAP: Record<string, string[]> = {
  '서울': ['서울특별시', '서울'],
  '부산': ['부산광역시', '부산'],
  '대구': ['대구광역시', '대구'],
  '인천': ['인천광역시', '인천'],
  '광주': ['광주광역시', '광주'],
  '대전': ['대전광역시', '대전'],
  '울산': ['울산광역시', '울산'],
  '세종': ['세종특별자치시', '세종'],
  '경기': ['경기도', '경기'],
  '강원': ['강원도', '강원'],
  '충북': ['충청북도', '충북'],
  '충남': ['충청남도', '충남'],
  '전북': ['전라북도', '전북', '전북특별자치도'],
  '전남': ['전라남도', '전남'],
  '경북': ['경상북도', '경북'],
  '경남': ['경상남도', '경남'],
  '제주': ['제주특별자치도', '제주'],
};

// 시군구/지역명 → DB sigungu 부분 매칭용
// DB sigungu 예: "강남구", "수원시 권선구", "성남시 분당구" 등
const SIGUNGU_ALIASES: Record<string, string> = {
  // 서울 구
  '강남': '강남구',
  '강북': '강북구',
  '강동': '강동구',
  '강서': '강서구',
  '서초': '서초구',
  '송파': '송파구',
  '마포': '마포구',
  '은평': '은평구',
  '노원': '노원구',
  '도봉': '도봉구',
  '중랑': '중랑구',
  '성북': '성북구',
  '동대문': '동대문구',
  '중구': '중구',
  '종로': '종로구',
  '용산': '용산구',
  '성동': '성동구',
  '광진': '광진구',
  '동작': '동작구',
  '관악': '관악구',
  '서대문': '서대문구',
  '양천': '양천구',
  '구로': '구로구',
  '금천': '금천구',
  '영등포': '영등포구',
  '동작': '동작구',
  // 서울 지역별칭
  '홍대': '마포구',
  '신촌': '서대문구',
  '건대': '광진구',
  '혜화': '종로구',
  '신도림': '구로구',
  '여의도': '영등포구',
  '청담': '강남구',
  '압구정': '강남구',
  '논현': '강남구',
  '역삼': '강남구',
  '삼성': '강남구',
  '도곡': '강남구',
  '선릉': '강남구',
  '양재': '서초구',
  '개포': '강남구',
  '방배': '서초구',
  '잠실': '송파구',
  '천호': '강동구',
  '목동': '양천구',
  '당산': '영등포구',
  '신논현': '강남구',
  // 서울 기타
  '명동': '중구',
  '신사': '강남구',
  // 경기 주요 도시
  '수원': '수원시',
  '성남': '성남시',
  '분당': '성남시 분당구',
  '판교': '성남시 분당구',
  '용인': '용인시',
  '수지': '용인시 수지구',
  '부천': '부천시',
  '안양': '안양시',
  '안산': '안산시',
  '고양': '고양시',
  '일산': '고양시 일산',
  '광교': '수원시 영통구',
  '동탄': '화성시',
  '평촌': '안양시 동안구',
  '범계': '안양시 동안구',
  '산본': '군포시',
  '중계': '노원구',
  // 인천 (인천 소속임을 명확히)
  '송도': '송도(연수구)',
  '검단': '검단(서구)',
  // 경남
  '창원': '창원시',
  '진해': '창원시 진해구',
  '양산': '양산시',
  // 경북
  '포항': '포항시',
  '구미': '구미시',
  // 기타 도시
  '천안': '천안시',
  '아산': '아산시',
  '청주': '청주시',
  '전주': '전주시',
  '여수': '여수시',
  '순천': '순천시',
};

// 지점명에서 지역 추출용 패턴 (붙어있는 경우 포함)
// "닥터쁘띠의원강남점" → "강남" 추출
const JEOM_LOCATIONS = [
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
  '종로', '용산', '서초',
];

export interface LocationHint {
  sido?: string;
  sigungu?: string;
  raw?: string;
}

/**
 * 원본 병원명에서 지역 hint 추출
 *
 * 지원 패턴:
 *   "_부산_부산진"              → { sido: '부산', sigungu: '부산진' }
 *   " 울산 남구"               → { sido: '울산', sigungu: '남구' }
 *   "아비쥬의원강남점"          → { sigungu: '강남구' }  ← 체인 지점명
 *   "닥터쁘띠의원 대전점"       → { sido: '대전' }
 *   "샤인빔의원송도점"          → { sigungu: '연수구' }  ← 송도=인천 연수구
 *   "노원,닥터쁘띠의원"         → { sigungu: '노원구' }
 */
export function extractLocation(rawName: string): LocationHint {
  // 패턴 1: "_시도_구군" (underscore 구분)
  const m1 = rawName.match(/_([가-힣]{2,4})_([가-힣]{2,6})(?:_|$)/);
  if (m1) {
    const sido = normalizeSido(m1[1]);
    return { sido: sido ?? m1[1], sigungu: m1[2], raw: `${m1[1]}_${m1[2]}` };
  }

  // 패턴 2: "_시도구군" (붙어있는 형태, ex: "_경기광주", "_서울강남")
  const m2 = rawName.match(/_([가-힣]{2,4})([가-힣]{2,4})(?:_|$)/);
  if (m2) {
    const sido = normalizeSido(m2[1]);
    if (sido) {
      return { sido, sigungu: m2[2], raw: `${m2[1]}${m2[2]}` };
    }
  }

  // 패턴 3: "_시도" 또는 "_시군구명" (underscore + 시도 or 지역)
  const m3 = rawName.match(/_([가-힣]{2,4})(?:_|$)/);
  if (m3) {
    const sido = normalizeSido(m3[1]);
    if (sido) return { sido, raw: m3[1] };
    // sido 아닌 경우 sigungu alias 시도
    const hint3 = extractFromLocation(m3[1]);
    if (hint3.sido || hint3.sigungu) return { ...hint3, raw: m3[1] };
  }

  // 패턴 4: " 시도 구군" (공백 구분 trailing)
  const m4 = rawName.match(/\s+([가-힣]{2,4})\s+([가-힣]{2,6}[시군구읍면]?)$/);
  if (m4) {
    const sido = normalizeSido(m4[1]);
    if (sido) return { sido, sigungu: m4[2], raw: `${m4[1]} ${m4[2]}` };
  }

  // 패턴 5: " 시도" trailing (공백 + 시도만)
  const m5 = rawName.match(/\s+([가-힣]{2,3})$/);
  if (m5) {
    const sido = normalizeSido(m5[1]);
    if (sido) return { sido, raw: m5[1] };
  }

  // 패턴 6: 체인 지점명 "{지역}점" — 공백 있는 경우
  // "닥터쁘띠의원 대전점", "샤인빔의원 강남점"
  const m6 = rawName.match(/\s+([가-힣]{2,4})점$/);
  if (m6) {
    return extractFromLocation(m6[1]);
  }

  // 패턴 7: 체인 지점명 "{지역}점" — 붙어있는 경우
  // "아비쥬의원강남점", "닥터쁘띠의원강남점"
  for (const loc of JEOM_LOCATIONS) {
    if (rawName.endsWith(loc + '점')) {
      return extractFromLocation(loc);
    }
  }

  // 패턴 8: "노원,병원명" 또는 "강남,병원명" (쉼표 앞 지역)
  if (rawName.includes(',')) {
    const beforeComma = rawName.split(',')[0].trim();
    const sido = normalizeSido(beforeComma);
    if (sido) return { sido, raw: beforeComma };
    const hint = extractFromLocation(beforeComma);
    if (hint.sido || hint.sigungu) return hint;
  }

  return {};
}

function extractFromLocation(loc: string): LocationHint {
  // sido인지 먼저 체크
  const sido = normalizeSido(loc);
  if (sido) return { sido, raw: loc };
  // sigungu 별칭 매핑
  const sigungu = SIGUNGU_ALIASES[loc];
  if (sigungu) {
    // 해당 sigungu가 어느 sido인지 추론
    const inferredSido = inferSidoFromSigungu(sigungu);
    return { sido: inferredSido, sigungu, raw: loc };
  }
  return {};
}

// sigungu → sido 추론 (DB가 서울/경기/인천만 있으므로)
function inferSidoFromSigungu(sigungu: string): string | undefined {
  // 인천 (경기보다 먼저 체크)
  if (sigungu.includes('송도') || sigungu.includes('연수')) return '인천';
  if (sigungu.includes('검단')) return '인천';

  // 서울 구
  const seoulGu = ['강남구', '강북구', '강동구', '강서구', '서초구', '송파구',
    '마포구', '은평구', '노원구', '도봉구', '중랑구', '성북구', '동대문구',
    '중구', '종로구', '용산구', '성동구', '광진구', '동작구', '관악구',
    '서대문구', '양천구', '구로구', '금천구', '영등포구'];
  if (seoulGu.some(g => sigungu.startsWith(g) || sigungu === g || sigungu.includes(g.replace(/구$/, '')))) return '서울';

  // 경기
  const gyeonggi = ['수원', '성남', '용인', '부천', '안양', '안산',
    '고양', '화성', '군포', '동안', '분당', '판교', '광교', '동탄', '일산'];
  if (gyeonggi.some(g => sigungu.includes(g))) return '경기';

  return undefined;
}

/** DB의 sido 값(전체명)과 hint의 sido(약칭) 비교 */
export function sidoMatches(dbSido: string | null, hintSido: string): boolean {
  if (!dbSido) return false;
  const aliases = SIDO_MAP[hintSido] ?? [hintSido];
  return aliases.some(a => dbSido.startsWith(a) || dbSido === a);
}

/** DB의 sigungu 값과 hint sigungu 비교 (부분 매칭) */
export function sigunguMatches(dbSigungu: string | null, hintSigungu: string): boolean {
  if (!dbSigungu) return false;
  // "송도(연수구)" 형태의 hint는 괄호 안 실제 구명으로 비교
  const parenMatch = hintSigungu.match(/\(([^)]+)\)/);
  const canonical = parenMatch ? parenMatch[1] : hintSigungu;
  const norm = canonical.replace(/[시군구읍면]$/, '');
  return dbSigungu.includes(norm) || dbSigungu.startsWith(norm);
}

function normalizeSido(input: string): string | undefined {
  for (const [key, aliases] of Object.entries(SIDO_MAP)) {
    if (aliases.includes(input) || key === input) return key;
  }
  return undefined;
}
