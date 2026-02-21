/**
 * 마케팅 활성도 점수 산출
 * 네이버 블로그/카페/뉴스 게시물 수 기반 0~100 점수
 * 외부 API 미연결 시 더미 데이터 fallback 포함
 *
 * v1.0 - 2026-02-21
 */
export interface MarketingScoreInput {
  hospitalName: string;
  website: string | null;
  email: string | null;
  dataQualityScore: number;
  naverReviewCount: number;
  naverClientId?: string;
  naverClientSecret?: string;
}

export interface MarketingScoreResult {
  score: number;
  source: 'naver_api' | 'fallback';
  details: {
    blogCount: number;
    cafeCount: number;
    newsCount: number;
    websiteBonus: number;
    emailBonus: number;
  };
}

/**
 * 네이버 검색 API로 블로그/카페/뉴스 게시물 수 조회.
 * 실패 시 null 반환 (fallback으로 전환).
 */
async function fetchNaverCounts(
  hospitalName: string,
  clientId?: string,
  clientSecret?: string
): Promise<{ blog: number; cafe: number; news: number } | null> {
  if (!clientId || !clientSecret) return null;

  try {
    const headers = {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    };
    const query = encodeURIComponent(hospitalName);

    const [blogRes, cafeRes, newsRes] = await Promise.all([
      fetch(`https://openapi.naver.com/v1/search/blog.json?query=${query}&display=1`, { headers }),
      fetch(`https://openapi.naver.com/v1/search/cafearticle.json?query=${query}&display=1`, { headers }),
      fetch(`https://openapi.naver.com/v1/search/news.json?query=${query}&display=1`, { headers }),
    ]);

    if (!blogRes.ok || !cafeRes.ok || !newsRes.ok) return null;

    const blogData = await blogRes.json() as { total: number };
    const cafeData = await cafeRes.json() as { total: number };
    const newsData = await newsRes.json() as { total: number };

    return {
      blog: blogData.total ?? 0,
      cafe: cafeData.total ?? 0,
      news: newsData.total ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * 더미 데이터 fallback: data_quality_score + 리뷰 수 기반 추정
 */
function fallbackEstimate(input: MarketingScoreInput): { blog: number; cafe: number; news: number } {
  const dq = input.dataQualityScore;
  const reviews = input.naverReviewCount;

  // data_quality_score를 기반으로 대략적 게시물 수 추정
  const blogEstimate = Math.round(dq * 0.5 + reviews * 0.3);
  const cafeEstimate = Math.round(dq * 0.3 + reviews * 0.2);
  const newsEstimate = Math.round(dq * 0.1);

  return { blog: blogEstimate, cafe: cafeEstimate, news: newsEstimate };
}

/**
 * 게시물 수를 0~100 점수로 변환
 *
 * 블로그 가중 40%, 카페 30%, 뉴스 30%
 * 각각 구간별 점수 산출 후 합산
 */
function calculateScore(
  blog: number,
  cafe: number,
  news: number,
  input: MarketingScoreInput
): { score: number; websiteBonus: number; emailBonus: number } {
  // 블로그 점수 (0~40)
  let blogScore: number;
  if (blog >= 1000) blogScore = 40;
  else if (blog >= 500) blogScore = 35;
  else if (blog >= 200) blogScore = 28;
  else if (blog >= 100) blogScore = 22;
  else if (blog >= 50) blogScore = 15;
  else if (blog >= 10) blogScore = 8;
  else blogScore = Math.round(blog * 0.5);

  // 카페 점수 (0~30)
  let cafeScore: number;
  if (cafe >= 500) cafeScore = 30;
  else if (cafe >= 200) cafeScore = 25;
  else if (cafe >= 100) cafeScore = 20;
  else if (cafe >= 50) cafeScore = 13;
  else if (cafe >= 10) cafeScore = 7;
  else cafeScore = Math.round(cafe * 0.5);

  // 뉴스 점수 (0~30)
  let newsScore: number;
  if (news >= 100) newsScore = 30;
  else if (news >= 50) newsScore = 25;
  else if (news >= 20) newsScore = 18;
  else if (news >= 5) newsScore = 10;
  else newsScore = Math.round(news * 1.5);

  // 웹사이트/이메일 보너스
  const websiteBonus = input.website ? 5 : 0;
  const emailBonus = input.email ? 3 : 0;

  const rawScore = blogScore + cafeScore + newsScore + websiteBonus + emailBonus;

  return {
    score: Math.max(0, Math.min(100, rawScore)), // 0~100 clamping 필수
    websiteBonus,
    emailBonus,
  };
}

/**
 * 마케팅 활성도 점수 산출.
 * 네이버 API 가용 시 실제 데이터, 불가 시 fallback 추정.
 * 반환 score는 반드시 0~100 범위.
 */
export async function scoreMarketingActivity(
  input: MarketingScoreInput
): Promise<MarketingScoreResult> {
  // 네이버 API 시도 (Workers env에서는 input으로 키 전달)
  const naverCounts = await fetchNaverCounts(
    input.hospitalName, input.naverClientId, input.naverClientSecret
  );

  if (naverCounts) {
    const { score, websiteBonus, emailBonus } = calculateScore(
      naverCounts.blog, naverCounts.cafe, naverCounts.news, input
    );
    return {
      score,
      source: 'naver_api',
      details: {
        blogCount: naverCounts.blog,
        cafeCount: naverCounts.cafe,
        newsCount: naverCounts.news,
        websiteBonus,
        emailBonus,
      },
    };
  }

  // Fallback
  const estimated = fallbackEstimate(input);
  const { score, websiteBonus, emailBonus } = calculateScore(
    estimated.blog, estimated.cafe, estimated.news, input
  );

  return {
    score,
    source: 'fallback',
    details: {
      blogCount: estimated.blog,
      cafeCount: estimated.cafe,
      newsCount: estimated.news,
      websiteBonus,
      emailBonus,
    },
  };
}
