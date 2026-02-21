/**
 * 이미지 최적화 모듈
 * - 스크린샷 다운샘플링: 최대 1280px 너비
 * - 세로 2000px 초과 시 텍스트 밀집 구역 크롭 (상/중/하 3분할)
 * - 1MB 초과 시 JPEG 압축 (quality 70%)
 * - 빈 이미지(배경만) 사전 필터링
 * - 처리 후 원본 이미지 즉시 삭제 (이미지 휘발 정책)
 *
 * v1.0 - 2026-02-21
 */
import sharp from 'sharp';
import fs from 'fs/promises';

export interface OptimizedImage {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  wasCropped: boolean;
  cropRegion: string | null; // 'top' | 'middle' | 'bottom' | null
}

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 2000;
const MAX_BYTES = 1 * 1024 * 1024; // 1MB
const JPEG_QUALITY = 70;
const CROP_HEIGHT = 2000; // 크롭 시 각 영역 높이

/**
 * 빈 이미지(단색 배경) 감지.
 * 이미지 엔트로피가 매우 낮으면 빈 이미지로 판단.
 */
async function isBlankImage(buffer: Buffer): Promise<boolean> {
  try {
    const { channels, width, height } = await sharp(buffer).stats().then((stats) => ({
      channels: stats.channels,
      width: 0,
      height: 0,
      ...stats,
    }));

    // 모든 채널의 표준편차가 5 미만이면 단색 배경
    const allLowVariance = channels.every((ch) => ch.stdev < 5);
    return allLowVariance;
  } catch {
    return false;
  }
}

/**
 * 단일 이미지 버퍼를 최적화.
 * 반환값이 null이면 빈 이미지로 필터링됨.
 */
export async function optimizeImage(
  inputBuffer: Buffer,
  options: { deletePath?: string } = {}
): Promise<OptimizedImage[] | null> {
  const originalSize = inputBuffer.length;

  // 빈 이미지 필터링
  if (await isBlankImage(inputBuffer)) {
    if (options.deletePath) await safeDelete(options.deletePath);
    return null;
  }

  const metadata = await sharp(inputBuffer).metadata();
  const origWidth = metadata.width ?? 0;
  const origHeight = metadata.height ?? 0;

  if (origWidth === 0 || origHeight === 0) {
    if (options.deletePath) await safeDelete(options.deletePath);
    return null;
  }

  const results: OptimizedImage[] = [];

  // 세로 2000px 초과 → 3분할 크롭
  if (origHeight > MAX_HEIGHT) {
    const regions: { top: number; label: string }[] = [
      { top: 0, label: 'top' },
      { top: Math.floor((origHeight - CROP_HEIGHT) / 2), label: 'middle' },
      { top: Math.max(0, origHeight - CROP_HEIGHT), label: 'bottom' },
    ];

    for (const region of regions) {
      const height = Math.min(CROP_HEIGHT, origHeight - region.top);
      const cropped = await sharp(inputBuffer)
        .extract({ left: 0, top: region.top, width: origWidth, height })
        .resize({ width: Math.min(origWidth, MAX_WIDTH), withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      results.push({
        base64: cropped.toString('base64'),
        mimeType: 'image/jpeg',
        width: Math.min(origWidth, MAX_WIDTH),
        height: Math.round(height * (Math.min(origWidth, MAX_WIDTH) / origWidth)),
        originalSizeBytes: originalSize,
        optimizedSizeBytes: cropped.length,
        wasCropped: true,
        cropRegion: region.label,
      });
    }
  } else {
    // 단일 이미지 최적화
    let pipeline = sharp(inputBuffer)
      .resize({ width: Math.min(origWidth, MAX_WIDTH), withoutEnlargement: true });

    // 1MB 초과 또는 리사이즈 필요 시 JPEG 압축
    if (originalSize > MAX_BYTES || origWidth > MAX_WIDTH) {
      pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
    }

    const optimized = await pipeline.toBuffer();
    const newMeta = await sharp(optimized).metadata();

    results.push({
      base64: optimized.toString('base64'),
      mimeType: originalSize > MAX_BYTES || origWidth > MAX_WIDTH ? 'image/jpeg' : (metadata.format === 'png' ? 'image/png' : 'image/jpeg'),
      width: newMeta.width ?? origWidth,
      height: newMeta.height ?? origHeight,
      originalSizeBytes: originalSize,
      optimizedSizeBytes: optimized.length,
      wasCropped: false,
      cropRegion: null,
    });
  }

  // 이미지 휘발 정책: 원본 삭제
  if (options.deletePath) await safeDelete(options.deletePath);

  return results;
}

/**
 * Base64 인코딩된 이미지를 최적화
 */
export async function optimizeBase64Image(
  base64: string,
  mimeType: string
): Promise<OptimizedImage[] | null> {
  const buffer = Buffer.from(base64, 'base64');
  return optimizeImage(buffer);
}

async function safeDelete(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // 삭제 실패 무시
  }
}
