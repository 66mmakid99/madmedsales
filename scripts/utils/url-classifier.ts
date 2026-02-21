/**
 * URL classifier for hospital website filtering.
 * Determines if a URL is a hospital-owned website vs blog/SNS/directory.
 */

const BLOG_SNS_PATTERNS = [
  /blog\.naver\.com/i,
  /m\.blog\.naver\.com/i,
  /post\.naver\.com/i,
  /cafe\.naver\.com/i,
  /instagram\.com/i,
  /facebook\.com/i,
  /fb\.com/i,
  /youtube\.com/i,
  /youtu\.be/i,
  /twitter\.com/i,
  /x\.com/i,
  /tiktok\.com/i,
  /band\.us/i,
  /kakao\.com\/ch/i,
  /pf\.kakao\.com/i,
  /open\.kakao\.com/i,
  /brunch\.co\.kr/i,
  /tistory\.com/i,
];

const DIRECTORY_PATTERNS = [
  /modoo\.at/i,
  /goodoc\.co\.kr/i,
  /babibubu\.com/i,
  /gangnamunni\.com/i,
  /yeoshin\.co\.kr/i,
  /hira\.or\.kr/i,
  /nhis\.or\.kr/i,
  /hidoc\.co\.kr/i,
  /doctornow\.co\.kr/i,
  /map\.naver\.com/i,
  /map\.kakao\.com/i,
  /place\.naver\.com/i,
  /place\.map\.kakao\.com/i,
  /google\.com\/maps/i,
  /yellowpages/i,
];

const SITE_BUILDER_PATTERNS = [
  /wixsite\.com/i,
  /wordpress\.com/i,
  /squarespace\.com/i,
  /weebly\.com/i,
];

export function isHospitalOwnedWebsite(url: string | null | undefined): boolean {
  if (!url) return false;

  const lowerUrl = url.toLowerCase();

  // Filter out blogs/SNS
  if (BLOG_SNS_PATTERNS.some((p) => p.test(lowerUrl))) return false;

  // Filter out directory/review sites
  if (DIRECTORY_PATTERNS.some((p) => p.test(lowerUrl))) return false;

  // Site builders are OK (hospitals use them) — don't filter

  // Must have http(s) or be a plain domain
  if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.includes('.')) {
    return false;
  }

  return true;
}

export function classifyUrl(url: string): 'hospital' | 'blog' | 'sns' | 'directory' | 'unknown' {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();

  if (BLOG_SNS_PATTERNS.some((p) => p.test(lower))) {
    if (/instagram|facebook|fb\.com|twitter|x\.com|tiktok|youtube|youtu\.be/i.test(lower)) return 'sns';
    return 'blog';
  }
  if (DIRECTORY_PATTERNS.some((p) => p.test(lower))) return 'directory';
  return 'hospital';
}
