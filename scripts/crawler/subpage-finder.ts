/**
 * Subpage URL discovery module.
 * Finds doctor, treatment, equipment, and contact subpages
 * from a hospital's main page HTML.
 *
 * v2 — procedure-heavy sites (e.g. Next.js SPAs) often place
 * equipment info inside individual procedure pages.  We now:
 *  1. Match URL paths (e.g. /procedures/) in addition to link text
 *  2. Raise limits for treatment pages (up to 15 per type, 25 total)
 */
import * as cheerio from 'cheerio';

export type SubpageType = 'doctor' | 'treatment' | 'equipment' | 'contact';

export interface SubpageUrl {
  url: string;
  type: SubpageType;
  label: string;
}

// Text / title patterns (Korean + English)
const TEXT_PATTERNS: Record<SubpageType, RegExp> = {
  doctor: /의료진|원장|doctor|about.*소개|인사말|대표.*소개|의사/i,
  treatment:
    /시술|treatment|program|menu|진료|서비스|클리닉|프로그램|피부|리프팅|레이저|탄력|주름|볼륨|체형|모공|여드름|제모|두피|윤곽|보톡스|필러|procedure/i,
  equipment: /장비|equipment|시설|보유.*장비|첨단|기기/i,
  contact: /contact|문의|오시는.*길|찾아오|상담|예약|위치|map|location|consult/i,
};

// URL path patterns — catches English-slug SPA routes
const URL_PATH_PATTERNS: Record<SubpageType, RegExp> = {
  doctor: /\/(doctor|about|staff|team|인사말|의료진)(\/|$)/i,
  treatment:
    /\/(procedure|treatment|program|clinic|시술|진료|skin|lifting|laser|filler|botox|contour|wrinkle|acne|pore|scar|hair|body|scalp|fat|volume|hydration|pigment|tone|sagging|neck|face|eye|nose|forehead|cheek|temple|cellulite|leg|weight|hyperhidrosis|tattoo|removal|redness|vessels|sensitive|stem.?cell|double.?chin)(s?)(\/|$)/i,
  equipment: /\/(equipment|device|장비|시설|기기)(\/|$)/i,
  contact: /\/(contact|consult|map|location|예약|문의|상담)(\/|$)/i,
};

const MAX_PER_TYPE: Record<SubpageType, number> = {
  doctor: 3,
  treatment: 15,
  equipment: 5,
  contact: 2,
};
const MAX_TOTAL = 25;

export function findSubpageUrls(html: string, baseUrl: string): SubpageUrl[] {
  const $ = cheerio.load(html);
  const results: SubpageUrl[] = [];
  const seenUrls = new Set<string>();
  const countByType: Record<SubpageType, number> = {
    doctor: 0,
    treatment: 0,
    equipment: 0,
    contact: 0,
  };

  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`).origin;
  } catch {
    return [];
  }

  $('a').each((_, el) => {
    if (results.length >= MAX_TOTAL) return;

    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    const title = $(el).attr('title') || '';

    // Skip non-navigable links
    if (
      !href ||
      href === '#' ||
      href.startsWith('javascript:') ||
      href.startsWith('tel:') ||
      href.startsWith('mailto:')
    ) {
      return;
    }

    let fullUrl: string;
    try {
      fullUrl = new URL(href, baseOrigin).toString();
    } catch {
      return;
    }

    // Same-origin filter
    try {
      if (new URL(fullUrl).origin !== baseOrigin) return;
    } catch {
      return;
    }

    if (seenUrls.has(fullUrl)) return;

    const combinedText = `${text} ${title}`;
    const urlPath = new URL(fullUrl).pathname;

    // Match against patterns — check both text and URL path
    for (const type of ['doctor', 'equipment', 'treatment', 'contact'] as SubpageType[]) {
      if (countByType[type] >= MAX_PER_TYPE[type]) continue;

      const textMatch = TEXT_PATTERNS[type].test(combinedText);
      const urlMatch = URL_PATH_PATTERNS[type].test(urlPath);

      if (textMatch || urlMatch) {
        seenUrls.add(fullUrl);
        countByType[type]++;
        results.push({
          url: fullUrl,
          type,
          label: text.slice(0, 50) || href.slice(0, 50),
        });
        break; // One type per link
      }
    }
  });

  return results;
}
