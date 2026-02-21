/**
 * Image downloader module.
 * Downloads images from URLs, converts to base64 for Gemini Vision API.
 */
import axios from 'axios';

export interface DownloadedImage {
  url: string;
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DOWNLOAD_TIMEOUT = 10000;

/** Filter image URLs to prioritize content images (prices, menus, equipment)
 * v2.0 - 2026-02-22: banner/popup을 제거하지 않고 우선순위만 조정.
 * 한국 피부과 사이트에서 banner/popup에 가격표가 포함되는 경우가 많음.
 */
export function filterLikelyContentImages(urls: string[]): string[] {
  // Whitelist — 이 키워드가 포함되면 무조건 최우선 통과
  const whitelistPattern = /price|가격|event|이벤트|banner|popup|팝업|시술|treatment|menu|메뉴|service|진료|equipment|장비/i;
  // Priority keywords — content-related
  const priorityPattern = /치료|비용|할인|promo|schedule|staff|doctor|의료진|before[-_]?after/i;
  // Blacklist — 확실한 비콘텐츠만 제거
  const blacklist = /favicon\.ico|spacer\.|1x1\.|pixel\.|tracking\.|beacon\.|blank\./i;
  // SNS icons (typically tiny)
  const snsIcons = /(?:facebook|instagram|youtube|kakao|naver|twitter|tiktok)[-_.](?:icon|logo|btn|badge)/i;

  const whitelist: string[] = [];
  const priority: string[] = [];
  const normal: string[] = [];

  for (const url of urls) {
    const filename = url.split('/').pop() ?? '';
    const path = url.toLowerCase();

    // Hard blacklist: tracking pixels, spacers
    if (blacklist.test(filename) || blacklist.test(path)) continue;
    // SNS tiny icons
    if (snsIcons.test(filename) || snsIcons.test(path)) continue;

    if (whitelistPattern.test(filename) || whitelistPattern.test(path)) {
      whitelist.push(url);
    } else if (priorityPattern.test(filename) || priorityPattern.test(path)) {
      priority.push(url);
    } else {
      normal.push(url);
    }
  }

  return [...whitelist, ...priority, ...normal];
}

/** Download images and convert to base64 */
export async function downloadImages(
  urls: string[],
  maxCount = 5
): Promise<DownloadedImage[]> {
  const results: DownloadedImage[] = [];
  const candidates = urls.slice(0, maxCount * 2); // Try more in case some fail

  for (const url of candidates) {
    if (results.length >= maxCount) break;

    try {
      // HEAD request to check type and size
      const head = await axios.head(url, { timeout: 5000 });
      const contentType = (head.headers['content-type'] ?? '').split(';')[0].trim();
      const contentLength = parseInt(head.headers['content-length'] ?? '0', 10);

      if (!ALLOWED_TYPES.includes(contentType)) continue;
      if (contentLength > MAX_IMAGE_SIZE) continue;

      // Download the image
      const response = await axios.get<ArrayBuffer>(url, {
        timeout: DOWNLOAD_TIMEOUT,
        responseType: 'arraybuffer',
      });

      const buffer = Buffer.from(response.data);
      if (buffer.length > MAX_IMAGE_SIZE) continue;

      results.push({
        url,
        base64: buffer.toString('base64'),
        mimeType: contentType,
        sizeBytes: buffer.length,
      });
    } catch {
      // Skip failed downloads silently
      continue;
    }
  }

  return results;
}
