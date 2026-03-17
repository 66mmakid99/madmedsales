/**
 * 주소 정규화 모듈
 * Excel 주소 → 핵심 컴포넌트 추출
 */

export interface ParsedAddress {
  sido?: string;      // 서울, 경기, 인천 등 (약칭)
  sigungu?: string;   // 강남구, 수원시 등
  roadName?: string;  // 논현로, 테헤란로 등
  roadNum?: number;   // 836, 4 등 (건물 본번)
  roadNumSub?: number;// 번길 숫자 (ex: 테헤란로4길 → 4)
  jibun?: string;     // 지번 "123-45"
  raw: string;        // 원본
}

const SIDO_NORMALIZE: Record<string, string> = {
  '서울특별시': '서울', '서울시': '서울', '서울': '서울',
  '경기도': '경기', '경기': '경기',
  '인천광역시': '인천', '인천시': '인천', '인천': '인천',
  '부산광역시': '부산', '부산시': '부산', '부산': '부산',
  '대구광역시': '대구', '대구시': '대구', '대구': '대구',
  '광주광역시': '광주', '광주시': '광주', '광주': '광주',
  '대전광역시': '대전', '대전시': '대전', '대전': '대전',
  '울산광역시': '울산', '울산시': '울산', '울산': '울산',
  '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
  '강원도': '강원', '강원특별자치도': '강원',
  '충청북도': '충북', '충북': '충북',
  '충청남도': '충남', '충남': '충남',
  '전라북도': '전북', '전북특별자치도': '전북', '전북': '전북',
  '전라남도': '전남', '전남': '전남',
  '경상북도': '경북', '경북': '경북',
  '경상남도': '경남', '경남': '경남',
  '제주특별자치도': '제주', '제주도': '제주', '제주': '제주',
};

/**
 * 주소 파싱
 * "서울 강남구 논현로 836 5층" → { sido:'서울', sigungu:'강남구', roadName:'논현로', roadNum:836 }
 * "서울 강남구 테헤란로4길5 해암빌딩" → { sido:'서울', sigungu:'강남구', roadName:'테헤란로4길', roadNum:5 }
 */
export function parseAddress(addr: string): ParsedAddress {
  if (!addr) return { raw: addr };
  const cleaned = addr.trim();

  // 시도 추출
  let sido: string | undefined;
  let rest = cleaned;

  for (const [full, norm] of Object.entries(SIDO_NORMALIZE)) {
    if (cleaned.startsWith(full)) {
      sido = norm;
      rest = cleaned.slice(full.length).trim();
      break;
    }
    // 공백 후 시작
    const spaceIdx = cleaned.indexOf(full);
    if (spaceIdx >= 0 && spaceIdx < 5) {
      sido = norm;
      rest = cleaned.slice(spaceIdx + full.length).trim();
      break;
    }
  }

  // 시군구 추출 (첫 번째 [가-힣]+[시군구])
  let sigungu: string | undefined;
  const sigunguMatch = rest.match(/^([가-힣]+(?:시|군|구))\s*/);
  if (sigunguMatch) {
    sigungu = sigunguMatch[1];
    rest = rest.slice(sigunguMatch[0].length).trim();
  }

  // 구 안의 구(ex: 수원시 영통구) 한 번 더 추출
  const subGuMatch = rest.match(/^([가-힣]+구)\s*/);
  if (subGuMatch && !sigungu?.endsWith('구')) {
    if (!sigungu) sigungu = subGuMatch[1];
    rest = rest.slice(subGuMatch[0].length).trim();
  }

  // 동/읍/면/리 건너뛰기 (도로명 앞에 오는 경우: "신당동 동호로", "왜관읍 중앙로")
  const dongMatch = rest.match(/^[가-힣]+(?:동|읍|면|리)\s+/);
  if (dongMatch) {
    rest = rest.slice(dongMatch[0].length).trim();
  }

  // 도로명 주소 추출
  // 패턴: "{도로명}{숫자?}길 {번지}" 또는 "{도로명} {번지}"
  // 예: "테헤란로4길 5", "논현로 836", "도산대로228"
  let roadName: string | undefined;
  let roadNum: number | undefined;
  let roadNumSub: number | undefined;

  // 도로명 패턴: 한글+숫자 조합 허용 (지축1로, 가산디지털1로, 1공단로 등)
  const ROAD_PAT = '[가-힣0-9]+로|[가-힣0-9]+길';

  // 패턴1: {도로명}{숫자}길{번지} — "테헤란로4길5"
  const roadPat1 = rest.match(new RegExp(`^([가-힣0-9]+)(\\d+)길\\s*(\\d+)`));
  if (roadPat1) {
    roadName = `${roadPat1[1]}${roadPat1[2]}길`;
    roadNumSub = parseInt(roadPat1[2]);
    roadNum = parseInt(roadPat1[3]);
  }

  // 패턴2: {도로명} {번지}번길 {번지} — "중앙대로 666번길 50"
  if (!roadName) {
    const roadPat2 = rest.match(new RegExp(`^(${ROAD_PAT})\\s*(\\d+)번?길\\s*(\\d+)`));
    if (roadPat2) {
      roadName = `${roadPat2[1]}${roadPat2[2]}번길`;
      roadNum = parseInt(roadPat2[3]);
    }
  }

  // 패턴3: {도로명}{번지} — "도산대로228" (붙어있음, 번지 뒤에 숫자 아닌 문자)
  if (!roadName) {
    const roadPat3 = rest.match(new RegExp(`^(${ROAD_PAT})(\\d+)(?!번길)`));
    if (roadPat3) {
      roadName = roadPat3[1];
      roadNum = parseInt(roadPat3[2]);
    }
  }

  // 패턴4: {도로명} {번지} — "논현로 836"
  if (!roadName) {
    const roadPat4 = rest.match(new RegExp(`^(${ROAD_PAT})\\s+(\\d+)`));
    if (roadPat4) {
      roadName = roadPat4[1];
      roadNum = parseInt(roadPat4[2]);
    }
  }

  // 지번 주소 추출 (\d+-\d+ 형태)
  let jibun: string | undefined;
  if (!roadName) {
    const jibunMatch = rest.match(/(\d+)-(\d+)/);
    if (jibunMatch) {
      jibun = `${jibunMatch[1]}-${jibunMatch[2]}`;
    } else {
      const jibunMatch2 = rest.match(/\b(\d{2,5})\b/);
      if (jibunMatch2) jibun = jibunMatch2[1];
    }
  }

  return { sido, sigungu, roadName, roadNum, roadNumSub, jibun, raw: cleaned };
}

/**
 * 두 주소의 유사도 점수 계산 (0~1)
 * 핵심: 도로명+번지 일치 여부
 */
export function addressMatchScore(a: ParsedAddress, b: ParsedAddress): number {
  // 시도가 다르면 즉시 0
  if (a.sido && b.sido && a.sido !== b.sido) return 0;

  let score = 0;

  // 도로명 일치 (0.4점)
  if (a.roadName && b.roadName) {
    if (a.roadName === b.roadName) {
      score += 0.4;
    } else if (
      a.roadName.includes(b.roadName) ||
      b.roadName.includes(a.roadName)
    ) {
      score += 0.2;
    } else {
      return 0; // 도로명이 다르면 매칭 불가
    }
  }

  // 번지 일치 (0.4점)
  if (a.roadNum && b.roadNum) {
    if (a.roadNum === b.roadNum) {
      score += 0.4;
    } else if (Math.abs(a.roadNum - b.roadNum) <= 2) {
      score += 0.2; // 번지 ±2 허용 (같은 건물 다른 출입구 등)
    }
  }

  // 시군구 일치 (0.2점)
  if (a.sigungu && b.sigungu) {
    if (a.sigungu === b.sigungu) score += 0.2;
    else if (a.sigungu.includes(b.sigungu) || b.sigungu.includes(a.sigungu)) score += 0.1;
  }

  return Math.min(score, 1.0);
}

/**
 * 주소에서 동/읍/면 추출
 * "서울 강남구 신사동 가로수길 35" → "신사동"
 */
export function extractDong(addr: string): string | null {
  if (!addr) return null;
  // [가-힣]{1,6}동|읍|면|리 패턴, 단 구/군/시 등이 아닌 것
  const m = addr.match(/([가-힣]{1,6}(?:동|읍|면|리))(?:\s|,|\d|$)/);
  return m ? m[1] : null;
}

/**
 * 주소 문자열 정규화 (전체 유사도 비교용)
 * - 특수문자, 공백 제거
 * - 시도 약칭 정규화 (서울특별시 → 서울)
 * - 층/호/번지 이후 제거하지 않음 (유사도 비교이므로)
 */
export function normalizeAddressStr(addr: string): string {
  if (!addr) return '';
  let s = addr;
  // 시도 약칭 정규화
  s = s.replace(/서울특별시|서울시/g, '서울')
       .replace(/경기도/g, '경기')
       .replace(/인천광역시|인천시/g, '인천')
       .replace(/부산광역시|부산시/g, '부산')
       .replace(/대구광역시|대구시/g, '대구')
       .replace(/광주광역시|광주시/g, '광주')
       .replace(/대전광역시|대전시/g, '대전')
       .replace(/울산광역시|울산시/g, '울산');
  // 괄호 내용 제거 (건물명, 동 등)
  s = s.replace(/\([^)]*\)/g, '');
  // 공백, 쉼표, 특수문자 제거
  s = s.replace(/[\s,。·\-\/]/g, '');
  return s.toLowerCase();
}

/**
 * 주소로 DB 병원 검색을 위한 인덱스 키 생성
 * 도로명+번지 조합
 */
export function addressIndexKey(parsed: ParsedAddress): string | null {
  if (parsed.roadName && parsed.roadNum) {
    return `${parsed.roadName}:${parsed.roadNum}`;
  }
  return null;
}

/**
 * 인덱스 키에서 허용 범위 키 생성 (번지 ±2)
 */
export function addressIndexKeysNearby(parsed: ParsedAddress): string[] {
  if (!parsed.roadName || !parsed.roadNum) return [];
  const keys: string[] = [];
  for (let d = -2; d <= 2; d++) {
    const num = parsed.roadNum + d;
    if (num > 0) keys.push(`${parsed.roadName}:${num}`);
  }
  return keys;
}
