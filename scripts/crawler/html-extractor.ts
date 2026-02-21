/**
 * HTML content extraction utilities.
 * Extracts text, emails, phones, and image URLs from HTML.
 */
import * as cheerio from 'cheerio';

const MAX_TEXT_LENGTH_DEFAULT = 50000;

export function extractTextFromHtml(html: string, maxLength = MAX_TEXT_LENGTH_DEFAULT): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, nav, footer, header').remove();

  const text = $('body').text();
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

export function extractEmailsFromHtml(html: string): string[] {
  const emails: string[] = [];

  // 1. mailto: links (highest priority)
  const mailtoRegex = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  let mailtoMatch: RegExpExecArray | null;
  while ((mailtoMatch = mailtoRegex.exec(html)) !== null) {
    emails.push(mailtoMatch[1]);
  }

  // 2. General email regex
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailRegex);
  if (matches) emails.push(...matches);

  if (emails.length === 0) return [];

  const filtered = [...new Set(emails)].filter(
    (email) =>
      !email.includes('example.com') &&
      !email.includes('sentry.io') &&
      !email.includes('googletagmanager') &&
      !email.includes('wixpress') &&
      !email.includes('w3.org') &&
      !email.includes('jsdelivr') &&
      !email.includes('cloudflare') &&
      !email.endsWith('.png') &&
      !email.endsWith('.jpg') &&
      !email.endsWith('.svg') &&
      !email.endsWith('.gif') &&
      !email.endsWith('.css') &&
      !email.endsWith('.js')
  );

  return [...new Set(filtered)];
}

export function pickBestEmail(emails: string[]): string | null {
  if (emails.length === 0) return null;
  const priority = emails.find(
    (e) => /^(info|contact|admin|help|cs|counsel|consulting|consult)@/i.test(e)
  );
  if (priority) return priority;
  const nonGeneric = emails.filter(
    (e) => !/@(gmail|naver|daum|hanmail|kakao|yahoo|hotmail|outlook)\./i.test(e)
  );
  return nonGeneric[0] ?? emails[0];
}

export function extractPhonesFromHtml(html: string): string[] {
  const phoneRegex = /(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|1(?:5|6|8)\d{2}[-.\s]?\d{4})/g;
  const matches = html.match(phoneRegex);
  if (!matches) return [];
  return [...new Set(matches.map((p) => p.replace(/[.\s]/g, '')))];
}

/** Extract image URLs from HTML, resolving relative paths */
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls: string[] = [];
  const seen = new Set<string>();

  // Skip patterns for icons, logos, tracking pixels, etc.
  const skipPatterns = /logo|icon|favicon|sprite|pixel|tracking|badge|btn|button|arrow|bg[-_]|background|thumb[-_]?(nail)?[-_]?s?\.|1x1|spacer/i;
  // Prefer patterns for content images (prices, menus, equipment)
  const MIN_LIKELY_SIZE = 20; // skip tiny image filenames like "1.png"

  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) return;

    try {
      const fullUrl = new URL(src, baseUrl).toString();
      if (seen.has(fullUrl) || !fullUrl.startsWith('http')) return;
      seen.add(fullUrl);

      // Filter out icons/logos/tiny images
      const filename = fullUrl.split('/').pop() ?? '';
      if (skipPatterns.test(filename)) return;
      if (filename.length < MIN_LIKELY_SIZE && /^\d+\.(png|gif|jpg)$/i.test(filename)) return;

      urls.push(fullUrl);
    } catch {
      // skip invalid URLs
    }
  });

  return urls;
}
