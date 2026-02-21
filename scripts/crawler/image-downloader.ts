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

/** Filter image URLs to prioritize content images (prices, menus, equipment) */
export function filterLikelyContentImages(urls: string[]): string[] {
  // Priority keywords — images likely containing useful info
  const priorityPattern = /price|가격|menu|메뉴|시술|장비|equipment|치료|비용|이벤트|event|할인/i;
  // Depriority patterns — likely decorative
  const depriority = /banner|slide|hero|main[-_]?visual|popup|modal|ad[-_]/i;

  const priority: string[] = [];
  const normal: string[] = [];

  for (const url of urls) {
    const filename = url.split('/').pop() ?? '';
    const path = url.toLowerCase();

    if (depriority.test(filename) || depriority.test(path)) continue;

    if (priorityPattern.test(filename) || priorityPattern.test(path)) {
      priority.push(url);
    } else {
      normal.push(url);
    }
  }

  return [...priority, ...normal];
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
