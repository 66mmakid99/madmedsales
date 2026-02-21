/**
 * Hospital filtering utilities.
 * Ported from MADMEDCHECK hospital-collector.js EXCLUDE_KEYWORDS.
 * Filters out non-target hospitals (한의원, non-medical facilities, non-derm specialties).
 */

/** Non-target keywords: hospitals matching any of these are excluded */
export const EXCLUDE_KEYWORDS: readonly string[] = [
  // 한방
  '한의원', '한의학', '한방',
  // 비의료 시설
  '네일', '스킨케어', '에스테틱', '마사지', '스파', '왁싱', '태닝', '헤어', '미용실',
  // 동물 의료
  '동물병원', '수의',
  // 타과 (피부과/성형외과 제외)
  '안과', '이비인후과', '치과', '정형외과', '신경외과', '정신과', '소아과', '산부인과', '비뇨기과',
  '내과', '가정의학과', '재활의학과', '통증의학과', '영상의학과', '진단검사의학과',
] as const;

/** Target departments that qualify for MADMEDSALES */
export const TARGET_DEPARTMENTS: readonly string[] = [
  '피부과', '성형외과',
] as const;

/** Search keywords for finding derm/aesthetic hospitals (from MEDCHECKER) */
export const SEARCH_KEYWORDS: readonly string[] = [
  // 기본
  '피부과', '피부과의원', '피부클리닉', '피부과진료', '보톡스의원', '필러의원',
  '리프팅의원', '레이저피부과', '미용의원',
  // 리프팅/탄력
  '울쎄라', '슈링크', '써마지', '올리지오', '리프팅시술',
  // 스킨부스터/재생
  '리쥬란', '쥬베룩', '볼뉴머', '스킨부스터',
  // 레이저/광치료
  'IPL', '레이저토닝', '피코토닝',
  // 쁘띠시술
  '쁘띠시술', '보톡스', '필러',
] as const;

/** Check if a hospital name contains an exclude keyword */
export function isExcludedHospital(name: string): boolean {
  const lowerName = name.toLowerCase();
  return EXCLUDE_KEYWORDS.some((kw) => lowerName.includes(kw.toLowerCase()));
}

/** Check if a hospital's category/department is a target */
export function isTargetDepartment(department: string | null | undefined, category?: string): boolean {
  if (department && TARGET_DEPARTMENTS.some((d) => department.includes(d))) {
    return true;
  }
  if (category) {
    return TARGET_DEPARTMENTS.some((d) => category.includes(d));
  }
  return false;
}
