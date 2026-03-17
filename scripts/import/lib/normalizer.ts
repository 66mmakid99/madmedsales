// 기관 유형 suffix만 제거 (전문과명은 유지)
// 긴 것부터 매칭해야 '요양병원' 앞에서 '병원'이 먼저 잘리는 오류 방지
const FACILITY_SUFFIXES = [
  '의료원', '요양병원', '전문병원', '종합병원',
  '병원', '의원', '클리닉', '센터', '한의원',
] as const;

// 지점/지역 suffix 패턴 (공백 포함 — 정규화 전에 처리)
const BRANCH_SUFFIXES = [
  // 체인 지점 패턴 ("건대점", "선릉점", "광교점" 등)
  /\s+[가-힣]+점$/,    // " 건대점", " 목포점"
  /\s+[가-힣]+$/,      // " 선릉", " 광교" (지역명 단독 trailing)
  /\s*\d+호점$/,       // "2호점"
  /\s*지점$/,
  /\s*분원$/,
] as const;

export function normalizeHospitalName(name: string): string {
  if (!name) return '';

  let n = name.trim();

  // 지점/지역 suffix 제거 (공백 포함 패턴 — 공백 제거 전에 처리)
  for (const pattern of BRANCH_SUFFIXES) {
    n = n.replace(pattern, '');
  }

  n = n
    .replace(/\s+/g, '')
    // 괄호와 그 안의 내용 제거 (e.g. "(주)", "（의원）")
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, '')
    .replace(/[·•·]/g, '');

  for (const suffix of FACILITY_SUFFIXES) {
    if (n.endsWith(suffix)) {
      n = n.slice(0, -suffix.length);
      break;
    }
  }

  return n.toLowerCase();
}

export function normalizeDoctorName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/원장$/, '')
    .replace(/의사$/, '')
    .replace(/Dr\.?/i, '')
    .replace(/닥터/, '')
    .toLowerCase();
}

export function extractSido(address: string): string {
  if (!address) return '';
  const match = address.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/);
  return match ? match[1] : '';
}

export function extractSigungu(address: string): string {
  if (!address) return '';
  const match = address.match(/([가-힣]+[시군구])\s/);
  return match ? match[1] : '';
}
