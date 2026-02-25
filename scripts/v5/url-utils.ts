/**
 * v5 URL 수집/필터/분류 유틸
 * 시스템 지침서 섹션 2-1 ~ 2-3 구현
 */

// ============================================================
// 포함/제외 패턴 (시스템 지침서 2-2)
// ============================================================
const INCLUDE_PATTERNS = [
  /시술|프로그램|장비|기기|의료진|원장|대표원장|doctor|staff/i,
  /이벤트|event|할인|가격|price|비용|menu/i,
  /리프팅|피부|레이저|rf|hifu|바디|보톡스|필러/i,
  /주사|부스터|스킨|케어|토닝|제모|탈모/i,
  /info|about|introduce|소개|진료/i,
  /landing|treatment|program|clinic/i,
];

const EXCLUDE_PATTERNS = [
  /blog|후기|리뷰|review|공지|notice|개인정보|privacy/i,
  /채용|recruit|오시는길|map|location|contact/i,
  /\.pdf|\.jpg|\.png|login|admin|board|gallery/i,
  /예약|booking|reservation|sitemap/i,
  /카카오|kakao|naver\.com|instagram|youtube|facebook/i,
];

// ============================================================
// URL 필터링
// ============================================================
export function filterRelevantUrls(urls: string[], mainUrl: string): string[] {
  let mainHostname: string;
  try { mainHostname = new URL(mainUrl).hostname; } catch { return []; }

  return urls.filter(url => {
    try {
      const target = new URL(url);
      // 같은 도메인만
      if (target.hostname !== mainHostname) return false;
      // 제외 패턴
      if (EXCLUDE_PATTERNS.some(p => p.test(url))) return false;
      // 메인 URL
      if (url === mainUrl || url === mainUrl + '/' || url + '/' === mainUrl) return true;
      // 포함 패턴
      if (INCLUDE_PATTERNS.some(p => p.test(url))) return true;
      // ★ 짧은 경로(depth 2 이하)는 통과 (사이트 주요 페이지일 가능성 높음)
      const pathParts = target.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      if (pathParts.length <= 2) return true;
      // ★ .htm/.html/.php/.asp 확장자를 가진 내부 페이지도 통과
      if (/\.(htm|html|php|asp)$/i.test(target.pathname)) return true;
      return false;
    } catch { return false; }
  });
}

// ============================================================
// 페이지 타입 분류
// ============================================================
export function classifyPageType(url: string, baseUrl: string): string {
  if (url === baseUrl || url === baseUrl + '/' || url + '/' === baseUrl) return 'main';
  const u = url.toLowerCase();
  if (/의료진|원장|doctor|staff|대표/.test(u)) return 'doctor';
  if (/장비|기기|equipment|device/.test(u)) return 'equipment';
  if (/시술|프로그램|treatment|menu|진료|landing/.test(u)) return 'treatment';
  if (/이벤트|event|할인|special|가격|price|비용/.test(u)) return 'event';
  return 'other';
}

// ============================================================
// 우선순위 정렬 (50개 초과 시에만)
// ============================================================
const PRIORITY_ORDER: Record<string, number> = {
  main: 0, doctor: 1, treatment: 2, equipment: 3, event: 4, price: 5, other: 6,
};

export function prioritizeUrls(urls: string[], baseUrl: string): string[] {
  return [...urls].sort((a, b) => {
    const pa = PRIORITY_ORDER[classifyPageType(a, baseUrl)] ?? 6;
    const pb = PRIORITY_ORDER[classifyPageType(b, baseUrl)] ?? 6;
    return pa - pb;
  });
}

// ============================================================
// 마크다운에서 내부 링크 추출 (mapUrl 부족 시 fallback)
// ============================================================
export function extractLinksFromMarkdown(markdown: string, mainUrl: string, domain: string): string[] {
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    try {
      const fullUrl = new URL(match[2], mainUrl).href;
      if (new URL(fullUrl).hostname === domain) {
        urls.push(fullUrl);
      }
    } catch { /* 무시 */ }
  }

  return [...new Set(urls)];
}
