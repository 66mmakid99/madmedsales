/**
 * 의사 프로필 사진 추출 모듈 v3.0
 *
 * 핵심 전략:
 *  1) 페이지/모달에서 사람 후보 이미지를 최대한 수집
 *  2) Gemini Vision으로 "사람 프로필 사진인지" + "이름이 보이는지" 검증
 *  3) 검증 통과한 사진만 최적화 → Storage 업로드
 *
 * v3.0 - 2026-03-03: Gemini Vision 검증 추가, 이름 매칭 강화
 */
import type { Page, ElementHandle } from 'puppeteer';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { supabase } from '../utils/supabase.js';
import { getAccessToken, isApiKeyMode } from '../analysis/gemini-auth.js';
import { getGeminiEndpoint } from '../utils/gemini-model.js';

// ============================================================
// 상수
// ============================================================
const EXCLUDE_SRC = /logo|icon|btn|arrow|bg[-_]|banner|sprite|favicon|badge|sns|kakao|naver|instagram|facebook|youtube|twitter|blog|map|loading|placeholder|empty|default|noimg/i;
const EXCLUDE_ALT = /로고|아이콘|배너|지도|map|logo|icon|banner/i;
/** Gemini Vision 연속 호출 간격 (ms) — 레이트 리밋 방지 */
const GEMINI_VISION_DELAY_MS = 500;

/** 프로필 사진 후보 최소/최대 크기 */
const MIN_SIZE = 60;
const MAX_SIZE = 1200;
/** 프로필 사진 비율 범위 (세로형 ~ 약간 가로형) */
const MIN_RATIO = 0.4;
const MAX_RATIO = 1.6;

interface PhotoCandidate {
  src: string;
  width: number;
  height: number;
  alt: string;
  base64?: string;
  mimeType?: string;
  elementHandle?: ElementHandle;
}

interface VerifiedPhoto {
  isPerson: boolean;
  isProfile: boolean;
  nameFound: string | null;
  confidence: number;
}

interface DoctorPhotoResult {
  doctorName: string;
  photoUrl: string | null;
}

// ============================================================
// Gemini Vision: 사람 프로필 사진 검증
// ============================================================
const VERIFY_PROMPT = `이 이미지를 보고 한 줄로만 답하세요.

규칙:
- 사람 얼굴이 선명히 보이는 프로필/증명사진이면 → "PROFILE 이름" (이름이 이미지에 적혀있으면 기재, 없으면 "PROFILE")
- 사람이 보이지만 프로필이 아니면 (단체사진, 원거리, 전신, 흐릿) → "PERSON"
- 사람이 아닌 사진 (장비, 건물, 시술, 로고, 일러스트, 풍경 등) → "NO"

예시 답변:
PROFILE 김철수
PROFILE
PERSON
NO

답변:`;

async function verifyWithGemini(
  imageBase64: string,
  mimeType: string,
): Promise<VerifiedPhoto> {
  const fallback: VerifiedPhoto = { isPerson: false, isProfile: false, nameFound: null, confidence: 0 };

  try {
    const token = await getAccessToken();
    const endpoint = getGeminiEndpoint();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isApiKeyMode()) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: VERIFY_PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      // Gemini API 오류
      return fallback;
    }

    const data = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return fallback;
    }

    // 파싱: "PROFILE 홍길동" / "PROFILE" / "PERSON" / "NO"
    const upper = text.toUpperCase();
    if (upper.startsWith('PROFILE')) {
      const nameStr = text.substring(7).trim();
      return {
        isPerson: true,
        isProfile: true,
        nameFound: nameStr.length >= 2 ? nameStr : null,
        confidence: 90,
      };
    }
    if (upper.startsWith('PERSON')) {
      return { isPerson: true, isProfile: false, nameFound: null, confidence: 70 };
    }
    // NO 또는 기타
    return fallback;
  } catch (err) {
    // Gemini 오류 — skip
    return fallback;
  }
}

// ============================================================
// 이미지 다운로드 → base64
// ============================================================
async function downloadImageAsBase64(
  page: Page,
  src: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const result = await page.evaluate(async (url: string) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const ct = r.headers.get('content-type') || 'image/jpeg';
        const blob = await r.blob();
        const reader = new FileReader();
        return new Promise<{ dataUrl: string; mimeType: string } | null>((resolve) => {
          reader.onload = () => resolve({ dataUrl: reader.result as string, mimeType: ct });
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }, src);

    if (!result) return null;
    const base64 = result.dataUrl.split(',')[1];
    if (!base64 || base64.length < 500) return null;
    const mime = result.mimeType.split(';')[0].trim();
    return { base64, mimeType: mime };
  } catch {
    return null;
  }
}

/** element screenshot → base64 */
async function screenshotAsBase64(
  el: ElementHandle,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const buf = await el.screenshot({ type: 'png' });
    if (!buf || buf.length < 500) return null;
    return { base64: Buffer.from(buf).toString('base64'), mimeType: 'image/png' };
  } catch {
    return null;
  }
}

// ============================================================
// Storage 업로드
// ============================================================
async function uploadPhoto(
  base64: string,
  mimeType: string,
  hospitalId: string,
  index: number,
): Promise<string | null> {
  try {
    const buf = Buffer.from(base64, 'base64');
    const optimized = await sharp(buf)
      .resize(400, null, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    const timestamp = Date.now();
    const storagePath = `${hospitalId}/doctor_photo_${index}_${timestamp}.webp`;
    const { error } = await supabase.storage
      .from('hospital-screenshots')
      .upload(storagePath, optimized, { contentType: 'image/webp', upsert: true });

    if (error) {
      console.log(`      ⚠️ 사진 업로드 실패: ${error.message}`);
      return null;
    }

    return supabase.storage
      .from('hospital-screenshots')
      .getPublicUrl(storagePath).data.publicUrl;
  } catch (err) {
    console.log(`      ⚠️ 사진 처리 실패: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================
// 사이즈 기본 필터 (Gemini 호출 전 걸러내기)
// ============================================================
function passesSizeFilter(c: PhotoCandidate): boolean {
  if (EXCLUDE_SRC.test(c.src)) return false;
  if (EXCLUDE_ALT.test(c.alt)) return false;
  if (c.width < MIN_SIZE || c.height < MIN_SIZE) return false;
  if (c.width > MAX_SIZE || c.height > MAX_SIZE) return false;
  const ratio = c.width / c.height;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return false;
  return true;
}

// ============================================================
// 페이지에서 이미지 후보 수집
// ============================================================
const IMG_SELECTORS = [
  // 의사/프로필 관련 셀렉터 (우선)
  'img[class*="doctor"]', 'img[class*="profile"]', 'img[class*="photo"]',
  'img[class*="thumb"]', 'img[class*="staff"]', 'img[class*="team"]',
  'img[class*="member"]', 'img[class*="director"]',
  'img[alt*="원장"]', 'img[alt*="의사"]', 'img[alt*="doctor"]',
  'img[alt*="프로필"]', 'img[alt*="대표"]', 'img[alt*="원장님"]',
  // 카드 내부 이미지
  '.doctor-card img', '.doctor-info img', '.doctor-profile img',
  '.staff-card img', '.team-card img', '.member-card img',
  '[class*="doctor"] img', '[class*="staff"] img',
  '[class*="profile"] img', '[class*="team"] img',
];

/** 일반 img 태그 전체 (폴백용) */
const FALLBACK_SELECTOR = 'img';

async function collectCandidates(page: Page, useAllImages: boolean): Promise<PhotoCandidate[]> {
  const candidates: PhotoCandidate[] = [];
  const seenSrc = new Set<string>();

  const addFromSelector = async (selector: string): Promise<void> => {
    try {
      const found = await page.$$eval(selector, (imgs) =>
        imgs.map((img) => {
          const el = img as HTMLImageElement;
          const rect = el.getBoundingClientRect();
          return {
            src: el.currentSrc || el.src || el.dataset.src || el.dataset.lazySrc || '',
            width: rect.width || el.naturalWidth,
            height: rect.height || el.naturalHeight,
            alt: el.alt || '',
          };
        }),
      );
      for (const f of found) {
        if (!f.src || seenSrc.has(f.src)) continue;
        seenSrc.add(f.src);
        if (passesSizeFilter(f as PhotoCandidate)) {
          candidates.push({ ...f, fromBgImage: false } as unknown as PhotoCandidate);
        }
      }
    } catch { /* 무시 */ }
  };

  // 우선 셀렉터
  for (const sel of IMG_SELECTORS) {
    await addFromSelector(sel);
  }

  // 폴백: 전체 img 태그 (의사 관련 셀렉터로 못찾을 때)
  if (useAllImages || candidates.length === 0) {
    await addFromSelector(FALLBACK_SELECTOR);
  }

  // CSS background-image도 수집
  try {
    const bgCandidates = await page.$$eval(
      '[class*="doctor"], [class*="profile"], [class*="photo"], [class*="staff"], [class*="team"], [class*="member"]',
      (els) =>
        els
          .map((el) => {
            const style = window.getComputedStyle(el);
            const bg = style.backgroundImage;
            if (!bg || bg === 'none') return null;
            const match = bg.match(/url\(["']?(.*?)["']?\)/);
            if (!match) return null;
            const rect = el.getBoundingClientRect();
            return {
              src: match[1],
              width: rect.width,
              height: rect.height,
              alt: '',
            };
          })
          .filter(Boolean) as Array<{ src: string; width: number; height: number; alt: string }>,
    );
    for (const bg of bgCandidates) {
      if (!bg.src || seenSrc.has(bg.src)) continue;
      seenSrc.add(bg.src);
      if (passesSizeFilter(bg as PhotoCandidate)) {
        candidates.push(bg as unknown as PhotoCandidate);
      }
    }
  } catch { /* 무시 */ }

  return candidates;
}

// ============================================================
// 이름 매칭 유틸
// ============================================================
function normalizeName(name: string): string {
  return name.replace(/\s+/g, '').replace(/[의사원장님선생Dr.dr.]/g, '').trim();
}

function matchDoctorName(
  foundName: string | null,
  doctorNames: string[],
): number {
  if (!foundName) return -1;
  const norm = normalizeName(foundName);
  if (norm.length < 2) return -1;

  for (let i = 0; i < doctorNames.length; i++) {
    const dn = normalizeName(doctorNames[i]);
    if (dn.length < 2) continue;
    // 정확 일치 또는 포함
    if (norm === dn || norm.includes(dn) || dn.includes(norm)) return i;
  }
  return -1;
}

// ============================================================
// 의사 소개 페이지 자동 탐색
// ============================================================
const DOCTOR_PAGE_KEYWORDS = [
  '의료진', '의료진소개', '의료진 소개', '의사소개', '원장소개', '원장님소개',
  '전문의', '전문의소개', 'doctor', 'doctors', 'staff', 'team',
  '대표원장', '원장단', '진료의', '진료진', '진료팀',
];

const DOCTOR_URL_PATTERNS = [
  /doctor/i, /staff/i, /team/i, /member/i, /intro.*doctor/i,
  /about.*doctor/i, /professor/i, /medical.*team/i,
  /의료진/i, /원장/i, /전문의/i, /소개/i,
];

async function findDoctorPage(page: Page, baseUrl: string): Promise<string | null> {
  try {
    const links = await page.$$eval('a[href]', (anchors) =>
      anchors.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a as HTMLAnchorElement).textContent?.trim() || '',
      })),
    );

    // 1차: 링크 텍스트로 매칭
    for (const kw of DOCTOR_PAGE_KEYWORDS) {
      const match = links.find((l) =>
        l.text.includes(kw) && l.href && !l.href.includes('#') && l.href.startsWith('http'),
      );
      if (match) return match.href;
    }

    // 2차: URL 패턴으로 매칭
    for (const pattern of DOCTOR_URL_PATTERNS) {
      const match = links.find((l) =>
        pattern.test(l.href) && l.href && !l.href.includes('#') && l.href.startsWith('http'),
      );
      if (match) return match.href;
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 핵심: 후보 → Gemini 검증 → 매칭 → 업로드
// ============================================================
async function verifyAndMatchPhotos(
  page: Page,
  candidates: PhotoCandidate[],
  doctorNames: string[],
  hospitalId: string,
): Promise<DoctorPhotoResult[]> {
  const results: DoctorPhotoResult[] = doctorNames.map((n) => ({ doctorName: n, photoUrl: null }));
  // 의사 수 + 5 (여유분)까지 검증. 최대 50장
  const maxCandidates = Math.min(candidates.length, Math.max(doctorNames.length + 5, 20), 50);
  let verifiedCount = 0;
  let matchedCount = 0;

  for (let ci = 0; ci < maxCandidates; ci++) {
    const c = candidates[ci];

    // 이미 전원 매칭 완료면 중단
    if (results.every((r) => r.photoUrl)) break;

    // 1) 이미지 다운로드
    const imgData = await downloadImageAsBase64(page, c.src);
    if (!imgData) continue;

    // 2) Gemini Vision 검증 (레이트 리밋 방지)
    await new Promise(resolve => setTimeout(resolve, GEMINI_VISION_DELAY_MS));
    const verified = await verifyWithGemini(imgData.base64, imgData.mimeType);

    if (!verified.isPerson || !verified.isProfile) continue;
    if (verified.confidence < 50) continue;
    verifiedCount++;

    // 3) 이름 매칭
    let targetIdx = matchDoctorName(verified.nameFound, doctorNames);

    // 이름 매칭 실패 시 → 이미지 근처 텍스트에서 이름 찾기 (카드 기반)
    if (targetIdx === -1) {
      // 아직 사진 없는 의사 중 순서대로 배정
      targetIdx = results.findIndex((r) => !r.photoUrl);
    }

    if (targetIdx === -1) continue;
    if (results[targetIdx].photoUrl) {
      // 이미 배정된 의사 → 다음 빈 슬롯
      targetIdx = results.findIndex((r) => !r.photoUrl);
      if (targetIdx === -1) continue;
    }

    // 4) 업로드
    const url = await uploadPhoto(imgData.base64, imgData.mimeType, hospitalId, targetIdx);
    if (url) {
      results[targetIdx].photoUrl = url;
      matchedCount++;
      const nameInfo = verified.nameFound ? ` (이름: ${verified.nameFound})` : '';
      console.log(`      ✅ ${results[targetIdx].doctorName} 사진 확인${nameInfo} [${verified.confidence}%]`);
    }
  }

  console.log(`    📸 Gemini 검증: ${verifiedCount}장 사람 프로필 / 후보 ${maxCandidates}장 → ${matchedCount}명 매칭`);
  return results;
}

// ============================================================
// [공개 API] 모달에서 의사 프로필 사진 추출
// ============================================================
export async function extractModalDoctorPhoto(
  page: Page,
  hospitalId: string,
  doctorName: string,
  index: number,
): Promise<string | null> {
  try {
    // 모달 내 이미지 수집
    const candidates = await collectCandidates(page, true);
    if (candidates.length === 0) return null;

    // 후보를 최대 5개만 검증
    const maxCheck = Math.min(candidates.length, 5);

    for (let i = 0; i < maxCheck; i++) {
      const c = candidates[i];
      const imgData = await downloadImageAsBase64(page, c.src);
      if (!imgData) continue;

      const verified = await verifyWithGemini(imgData.base64, imgData.mimeType);
      if (!verified.isPerson || !verified.isProfile || verified.confidence < 50) continue;

      const url = await uploadPhoto(imgData.base64, imgData.mimeType, hospitalId, index);
      if (url) {
        const nameInfo = verified.nameFound ? ` (이름: ${verified.nameFound})` : '';
        console.log(`      ✅ ${doctorName} 모달 사진 확인${nameInfo} [${verified.confidence}%]`);
        return url;
      }
    }

    return null;
  } catch (err) {
    console.log(`      ⚠️ 모달 사진 추출 실패: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================
// [공개 API] 의사 목록 페이지에서 사진 추출
// ============================================================
export async function extractDoctorPhotosFromPage(
  pageUrl: string,
  hospitalId: string,
  doctorNames: string[],
): Promise<DoctorPhotoResult[]> {
  if (doctorNames.length === 0) return [];
  console.log(`  📸 의사 프로필 사진 추출 (${doctorNames.length}명) — Gemini 검증`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log(`    ⚠️ 브라우저 실행 실패: ${(err as Error).message}`);
    return doctorNames.map((n) => ({ doctorName: n, photoUrl: null }));
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2000));

    // 의사 소개 페이지로 자동 이동
    const doctorPageUrl = await findDoctorPage(page, pageUrl);
    if (doctorPageUrl && doctorPageUrl !== pageUrl) {
      console.log(`    → 의사 소개 페이지 발견: ${doctorPageUrl}`);
      await page.goto(doctorPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 스크롤 다운으로 레이지 이미지 로드
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, 500);
        await new Promise((r) => setTimeout(r, 300));
      }
      window.scrollTo(0, 0);
    });

    const candidates = await collectCandidates(page, true);
    if (candidates.length === 0) {
      console.log(`    📸 이미지 후보 없음`);
      await browser.close();
      return doctorNames.map((n) => ({ doctorName: n, photoUrl: null }));
    }

    console.log(`    📸 이미지 후보: ${candidates.length}장 → Gemini 검증 중...`);
    const results = await verifyAndMatchPhotos(page, candidates, doctorNames, hospitalId);

    await browser.close();
    const found = results.filter((r) => r.photoUrl).length;
    console.log(`  📸 최종 결과: ${found}/${doctorNames.length}명 프로필 사진 확보`);
    return results;
  } catch (err) {
    if (browser) await browser.close();
    console.log(`    ⚠️ 사진 추출 실패: ${(err as Error).message}`);
    return doctorNames.map((n) => ({ doctorName: n, photoUrl: null }));
  }
}
