/**
 * 사이트 유형 핑거프린팅 모듈
 * v5.4 작업 3: 크롤링 단계에서 사이트 유형 자동 감지
 *
 * 감지 유형: wordpress | cafe24 | gnuboard | sixshop | custom_spa | custom_ssr | naver_only | unknown
 */

export interface SiteFingerprint {
  siteType: string;
  confidence: number;    // 0~1
  signals: string[];
  traits: string[];      // image_heavy, price_in_image, multi_page, single_page
}

export type CrawlFailReason =
  | 'domain_expired'
  | 'bot_blocked'
  | 'invalid_url'
  | 'timeout'
  | 'spa_render_fail'
  | 'redirect_loop'
  | 'ssl_error'
  | null;

/**
 * HTML + URL 기반 사이트 유형 감지
 * try-catch 내부 처리 — 실패해도 크롤링 중단 없음
 */
export function detectSiteType(html: string, url: string): SiteFingerprint {
  try {
    return _detect(html, url);
  } catch {
    return { siteType: 'unknown', confidence: 0, signals: ['detection_error'], traits: [] };
  }
}

function _detect(html: string, url: string): SiteFingerprint {
  const lower = html.toLowerCase();
  const signals: string[] = [];
  const traits: string[] = [];
  const scores: Record<string, number> = {};

  // ── WordPress 감지 ──
  let wpScore = 0;
  if (lower.includes('wp-content')) { wpScore += 3; signals.push('wp-content'); }
  if (lower.includes('wp-includes')) { wpScore += 3; signals.push('wp-includes'); }
  if (lower.includes('wp-json')) { wpScore += 2; signals.push('wp-json'); }
  if (/meta.*generator.*wordpress/i.test(html)) { wpScore += 3; signals.push('meta-generator-wordpress'); }
  if (lower.includes('wordpress')) { wpScore += 1; signals.push('wordpress-mention'); }
  scores['wordpress'] = wpScore;

  // ── Cafe24 감지 ──
  let cafe24Score = 0;
  if (/cafe24/i.test(html)) { cafe24Score += 3; signals.push('cafe24-mention'); }
  if (/\.cafe24\.com/i.test(html)) { cafe24Score += 3; signals.push('cafe24-domain'); }
  if (/cafe24\.com\/js/i.test(html)) { cafe24Score += 2; signals.push('cafe24-js'); }
  if (url.includes('cafe24.com')) { cafe24Score += 3; signals.push('cafe24-url'); }
  scores['cafe24'] = cafe24Score;

  // ── Gnuboard 감지 ──
  let gnuScore = 0;
  if (lower.includes('gnuboard')) { gnuScore += 3; signals.push('gnuboard-mention'); }
  if (lower.includes('g5_')) { gnuScore += 2; signals.push('g5_prefix'); }
  if (/\/bbs\//i.test(html)) { gnuScore += 1; signals.push('bbs-path'); }
  if (/\/adm\//i.test(html) && lower.includes('g5_')) { gnuScore += 1; signals.push('gnuboard-admin'); }
  scores['gnuboard'] = gnuScore;

  // ── Sixshop 감지 ──
  let sixScore = 0;
  if (/sixshop/i.test(html)) { sixScore += 3; signals.push('sixshop-mention'); }
  if (/sixshop\.co\.kr/i.test(html)) { sixScore += 3; signals.push('sixshop-domain'); }
  scores['sixshop'] = sixScore;

  // ── SPA 감지 ──
  let spaScore = 0;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  const hasRootDiv = /id=["'](root|app|__next|__nuxt)["']/i.test(html);
  if (hasRootDiv && bodyText.length < 500) { spaScore += 4; signals.push('spa-root-div-empty-body'); }
  else if (hasRootDiv) { spaScore += 1; signals.push('spa-root-div'); }
  if (/\/_next\//i.test(html)) { spaScore += 2; signals.push('nextjs-pattern'); }
  if (/\/__nuxt/i.test(html)) { spaScore += 2; signals.push('nuxt-pattern'); }
  if (/chunk\.\w+\.js/i.test(html)) { spaScore += 1; signals.push('chunk-js'); }
  scores['custom_spa'] = spaScore;

  // ── 최고 점수 유형 결정 ──
  let bestType = 'unknown';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; bestType = type; }
  }

  // 최소 기준 미달 시 SSR 또는 unknown
  if (bestScore < 2) {
    if (bodyText.length > 500) {
      bestType = 'custom_ssr';
      signals.push('sufficient-text-content');
    } else {
      bestType = 'unknown';
    }
  }

  // ── 신뢰도 계산 ──
  const confidence = Math.min(1, bestScore / 6);

  // ── 보조 특성 감지 ──
  const imgCount = (html.match(/<img\s/gi) || []).length;
  const textLen = bodyText.length;
  if (textLen < 1000 && imgCount >= 10) traits.push('image_heavy');
  if (textLen < 1000 && imgCount >= 10 && !/(가격|원|₩|만원|천원)/i.test(bodyText)) {
    traits.push('price_in_image');
  }

  const linkCount = (html.match(/<a\s[^>]*href/gi) || []).length;
  if (linkCount >= 10) traits.push('multi_page');
  else if (linkCount < 3) traits.push('single_page');

  return { siteType: bestType, confidence, signals, traits };
}

/**
 * 크롤링 에러에서 실패 원인 분류
 */
export function classifyCrawlError(error: string | Error): CrawlFailReason {
  const msg = typeof error === 'string' ? error : error.message;
  const lower = msg.toLowerCase();

  if (lower.includes('err_name_not_resolved') || lower.includes('dns')) return 'domain_expired';
  if (lower.includes('err_blocked_by_client') || lower.includes('403') || lower.includes('forbidden')) return 'bot_blocked';
  if (lower.includes('invalid url') || lower.includes('invalid_url')) return 'invalid_url';
  if (lower.includes('timeout') || lower.includes('timedout') || lower.includes('timed out')) return 'timeout';
  if (lower.includes('redirect') && (lower.includes('loop') || lower.includes('too many'))) return 'redirect_loop';
  if (lower.includes('ssl') || lower.includes('cert') || lower.includes('tls')) return 'ssl_error';
  if (lower.includes('spa') || lower.includes('render')) return 'spa_render_fail';

  return null;
}
