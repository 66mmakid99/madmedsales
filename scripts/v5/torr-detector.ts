/**
 * v5.5 TORR RF 전용 감지 모듈
 * Gemini 분류와 독립으로, 크롤링 전체 텍스트에서 TORR RF 키워드를 직접 검색
 */

export interface TorrEvidence {
  keyword: string;
  source: 'navigation_menu' | 'page_text' | 'ocr_text' | 'url_path';
  url?: string | null;
  context?: string | null;
}

export interface TorrDetectionResult {
  detected: boolean;
  evidence: TorrEvidence[];
  products_found: string[];
  confidence: 'high' | 'medium' | 'low';
}

// TORR RF 키워드 (대소문자 무관 매칭)
const TORR_KEYWORDS: Array<{ pattern: RegExp; product: string }> = [
  { pattern: /토르\s*RF/gi, product: 'TORR RF' },
  { pattern: /TORR\s*RF/gi, product: 'TORR RF' },
  { pattern: /토르\s*리프팅/gi, product: 'TORR RF' },
  { pattern: /토르\s*엔드/gi, product: 'TORR END' },
  { pattern: /토르엔드/gi, product: 'TORR END' },
  { pattern: /토르쎄라/gi, product: 'TORR RF' },
  { pattern: /TORR\s*Comfort/gi, product: 'TORR Comfort Dual' },
  { pattern: /토르\s*컴포트/gi, product: 'TORR Comfort Dual' },
  { pattern: /컴포트\s*듀얼/gi, product: 'TORR Comfort Dual' },
  { pattern: /MPR\s*리프팅/gi, product: 'TORR RF' },
  { pattern: /토로이달/gi, product: 'TORR RF' },
  { pattern: /Toroidal/gi, product: 'TORR RF' },
];

// 오탐 제외
const TORR_EXCLUDE: RegExp[] = [
  /토르말린/gi,
  /torr\s*(?:pressure|vacuum|mmhg)/gi,  // 압력 단위
];

/** 마크다운에서 [text](url) 링크를 추출 */
function extractMarkdownLinks(text: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    links.push({ text: m[1], url: m[2] });
  }
  return links;
}

/**
 * 전체 텍스트 + 페이지 데이터에서 TORR RF 보유 여부 감지
 */
export function detectTorrRf(
  allText: string,
  pages: Array<{ url: string; markdown: string; pageType: string }>,
): TorrDetectionResult {
  const evidence: TorrEvidence[] = [];
  const productsSet = new Set<string>();

  // 오탐 체크: 전체 텍스트에서 제외 키워드만 있는지
  const cleanText = allText;

  // 1. 전체 텍스트에서 키워드 스캔
  for (const kw of TORR_KEYWORDS) {
    const matches = cleanText.match(kw.pattern);
    if (matches) {
      // 오탐 제외 체크
      for (const match of matches) {
        const isExcluded = TORR_EXCLUDE.some(ex => ex.test(match));
        if (!isExcluded) {
          // 컨텍스트 추출 (매치 주변 50자)
          const idx = cleanText.indexOf(match);
          const start = Math.max(0, idx - 30);
          const end = Math.min(cleanText.length, idx + match.length + 30);
          const ctx = cleanText.substring(start, end).replace(/\n/g, ' ').trim();

          evidence.push({
            keyword: match.trim(),
            source: 'page_text',
            context: ctx,
          });
          productsSet.add(kw.product);
        }
      }
    }
  }

  // 2. 네비게이션 링크에서 TORR 키워드 스캔
  for (const page of pages) {
    const links = extractMarkdownLinks(page.markdown);
    for (const link of links) {
      for (const kw of TORR_KEYWORDS) {
        if (kw.pattern.test(link.text)) {
          // 리셋 regex lastIndex
          kw.pattern.lastIndex = 0;
          const isExcluded = TORR_EXCLUDE.some(ex => {
            ex.lastIndex = 0;
            return ex.test(link.text);
          });
          if (!isExcluded) {
            // 중복 방지
            const dup = evidence.some(e =>
              e.source === 'navigation_menu' && e.keyword === link.text.trim() && e.url === link.url,
            );
            if (!dup) {
              evidence.push({
                keyword: link.text.trim(),
                source: 'navigation_menu',
                url: link.url,
              });
              productsSet.add(kw.product);
            }
          }
        }
        kw.pattern.lastIndex = 0;
      }
    }
  }

  // 3. URL 경로에서 TORR 키워드 스캔
  for (const page of pages) {
    const urlLower = page.url.toLowerCase();
    if (urlLower.includes('torr') || urlLower.includes('%ED%86%A0%EB%A5%B4')) {
      const dup = evidence.some(e => e.source === 'url_path' && e.url === page.url);
      if (!dup) {
        evidence.push({
          keyword: 'URL에 TORR 포함',
          source: 'url_path',
          url: page.url,
        });
        productsSet.add('TORR RF');
      }
    }
  }

  // 중복 제거 (같은 키워드+소스 조합)
  const deduped: TorrEvidence[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    const key = `${e.source}:${e.keyword}:${e.url || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(e);
    }
  }

  const products = Array.from(productsSet);
  const detected = deduped.length > 0;
  const confidence: TorrDetectionResult['confidence'] =
    deduped.length >= 3 ? 'high' : deduped.length >= 1 ? 'medium' : 'low';

  return { detected, evidence: deduped, products_found: products, confidence };
}
