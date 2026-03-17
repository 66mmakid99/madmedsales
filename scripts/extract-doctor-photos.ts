/**
 * extract-doctor-photos.ts
 *
 * 병원 웹사이트에서 의사 인물 영역 스크린샷 캡처 → 최적화 → Storage 업로드 → DB 저장
 *
 * 기존 img 태그 다운로드 방식 대신 element screenshot 방식 사용:
 * - lazy-load, CSS background-image, SPA 렌더링 모두 처리 가능
 * - 인물 사진 영역을 정확하게 캡처
 *
 * 실행: npx tsx scripts/extract-doctor-photos.ts
 * 옵션: --limit N    (처리 병원 수 제한)
 *       --dry-run    (DB 변경 없이 미리보기)
 *       --force      (이미 사진 있는 의사도 재캡처)
 *
 * v2.0 - 2026-03-02
 */

import { supabase } from './utils/supabase.js';
import puppeteer, { type Page, type ElementHandle, type Browser } from 'puppeteer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

// ============================================================
// Puppeteer 설정 — HTTP 사이트 접근 가능하도록 보안 완화
// ============================================================
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--ignore-certificate-errors',
  '--allow-running-insecure-content',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 의료진 페이지 탐색 패턴
const DOCTOR_LINK_PATTERNS = [
  /의료진/i, /전문의/i, /원장.*소개/i, /의사.*소개/i,
  /진료진/i, /staff/i, /doctor/i, /team/i,
];

const DOCTOR_PATH_SUFFIXES = [
  '/의료진', '/doctors', '/staff', '/team',
  '/about', '/introduction', '/intro',
];

// 의사 카드/프로필 영역 셀렉터 (넓게)
const CARD_SELECTORS = [
  '.doctor-card', '.doctor-item', '.doctor-wrap',
  '.staff-card', '.staff-item', '.team-card', '.team-member',
  '[class*="doctor"] [class*="card"]', '[class*="doctor"] [class*="item"]',
  '[class*="doctor"] [class*="wrap"]', '[class*="doctor"] [class*="box"]',
  '[class*="staff"] [class*="card"]', '[class*="team"] [class*="card"]',
  '[class*="professor"]', '[class*="원장"]',
  '.doctor-list > li', '.doctor-list > div',
  '.staff-list > li', '.staff-list > div',
  '.team-list > li', '.team-list > div',
  'ul[class*="doctor"] > li', 'div[class*="doctor"] > div',
];

// 이미지 제외 패턴
const EXCLUDE_IMG = /logo|icon|btn|arrow|bg[-_]|banner|sprite|favicon|badge|sns|kakao|naver|instagram|facebook|youtube|payment|footer|header|nav/i;

// ============================================================
// 인물 영역 스크린샷 캡처 + 최적화 + 업로드
// ============================================================
async function captureAndUpload(
  el: ElementHandle,
  hospitalId: string,
  index: number,
): Promise<string | null> {
  try {
    const screenshotBuf = await el.screenshot({ type: 'png' });
    if (!screenshotBuf || screenshotBuf.length < 500) return null;

    // sharp로 최적화: 400px 리사이즈 + WebP 변환
    const optimized = await sharp(Buffer.from(screenshotBuf))
      .resize(400, null, { withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();

    if (optimized.length < 500) return null;

    const ts = Date.now();
    const storagePath = `${hospitalId}/doctor_photo_${index}_${ts}.webp`;
    const { error } = await supabase.storage
      .from('hospital-screenshots')
      .upload(storagePath, optimized, { contentType: 'image/webp', upsert: true });

    if (error) {
      console.log(`    ⚠️ 업로드 실패: ${error.message}`);
      return null;
    }

    return supabase.storage
      .from('hospital-screenshots')
      .getPublicUrl(storagePath).data.publicUrl;
  } catch (err) {
    console.log(`    ⚠️ 캡처 실패: ${(err as Error).message}`);
    return null;
  }
}

// ============================================================
// 페이지에서 인물 사진 요소 찾기 (스크린샷용)
// ============================================================
async function findPhotoElement(
  cardOrPage: ElementHandle | Page,
): Promise<ElementHandle | null> {
  // 1) img 태그 중 프로필 사진으로 보이는 것
  const imgSelectors = [
    'img[class*="photo"]', 'img[class*="profile"]', 'img[class*="doctor"]',
    'img[class*="thumb"]', 'img[class*="pic"]', 'img[class*="portrait"]',
    'img[alt*="원장"]', 'img[alt*="의사"]', 'img[alt*="doctor"]',
    'img[alt*="프로필"]', 'img[alt*="사진"]',
    'img',  // fallback: 아무 img
  ];

  for (const sel of imgSelectors) {
    try {
      const imgs = await cardOrPage.$$(sel);
      for (const img of imgs) {
        const info = await img.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const src = (el as HTMLImageElement).src || '';
          const alt = (el as HTMLImageElement).alt || '';
          const cls = el.className || '';
          return {
            w: rect.width, h: rect.height,
            src, alt, cls,
            visible: rect.width > 0 && rect.height > 0,
          };
        });

        // 필터: 크기, 제외 패턴
        if (!info.visible) continue;
        if (info.w < 60 || info.h < 60) continue;
        if (info.w > 800 || info.h > 800) continue;
        if (EXCLUDE_IMG.test(info.src) || EXCLUDE_IMG.test(info.cls)) continue;

        // 비율 체크 (세로형~가로형 프로필)
        const ratio = info.w / info.h;
        if (ratio < 0.3 || ratio > 2.5) continue;

        return img;
      }
    } catch { /* 셀렉터 없음 */ }
  }

  // 2) background-image가 있는 div (프로필 사진 흔한 패턴)
  try {
    const bgEls = await cardOrPage.$$('[class*="photo"], [class*="profile"], [class*="thumb"], [class*="pic"], [class*="img"]');
    for (const bgEl of bgEls) {
      const info = await bgEl.evaluate((el) => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        const rect = el.getBoundingClientRect();
        return {
          hasBg: bg && bg !== 'none',
          w: rect.width, h: rect.height,
          visible: rect.width > 50 && rect.height > 50,
        };
      });
      if (info.hasBg && info.visible && info.w >= 60 && info.h >= 60) {
        return bgEl;
      }
    }
  } catch { /* 무시 */ }

  return null;
}

// ============================================================
// 단일 병원 사진 추출
// ============================================================
interface DoctorInfo {
  id: string;
  name: string;
  photo_url: string | null;
}

interface PhotoResult {
  doctorName: string;
  photoUrl: string | null;
}

async function extractPhotosFromPage(
  page: Page,
  hospitalId: string,
  doctorNames: string[],
): Promise<PhotoResult[]> {
  const results: PhotoResult[] = doctorNames.map(n => ({ doctorName: n, photoUrl: null }));

  // 스크롤로 lazy-load 트리거
  await autoScroll(page);

  // 카드 기반 탐색
  let cardSelector = '';
  let cards: ElementHandle[] = [];

  for (const sel of CARD_SELECTORS) {
    try {
      const found = await page.$$(sel);
      if (found.length >= 1 && found.length <= 50) {
        // 카드에 텍스트가 있는지 확인 (빈 div 제외)
        const hasText = await found[0].evaluate(el => (el.textContent || '').trim().length > 5);
        if (hasText) {
          cards = found;
          cardSelector = sel;
          break;
        }
      }
    } catch { /* 무시 */ }
  }

  if (cards.length > 0) {
    console.log(`    카드 감지: ${cardSelector} (${cards.length}개)`);

    for (let i = 0; i < cards.length; i++) {
      try {
        const cardText = await cards[i].evaluate(el => el.textContent || '');

        // 의사 이름 매칭
        const matchIdx = doctorNames.findIndex(
          name => name && cardText.includes(name),
        );
        if (matchIdx === -1) continue;
        if (results[matchIdx].photoUrl) continue;

        // 카드 내 인물 사진 요소 찾기 → 스크린샷
        const photoEl = await findPhotoElement(cards[i]);
        if (photoEl) {
          const url = await captureAndUpload(photoEl, hospitalId, matchIdx);
          if (url) {
            results[matchIdx].photoUrl = url;
            console.log(`    📸 ${doctorNames[matchIdx]} — 카드 내 인물 캡처`);
            continue;
          }
        }

        // fallback: 카드 자체 img element screenshot
        const anyImg = await cards[i].$('img');
        if (anyImg) {
          const url = await captureAndUpload(anyImg, hospitalId, matchIdx);
          if (url) {
            results[matchIdx].photoUrl = url;
            console.log(`    📸 ${doctorNames[matchIdx]} — 카드 img 캡처`);
          }
        }
      } catch { /* 카드 처리 실패 */ }
    }
  } else {
    // 카드 없음: 페이지에서 프로필 이미지 직접 탐색
    console.log('    카드 미감지 → 페이지 전체에서 인물 이미지 탐색');

    const allImgs = await page.$$('img');
    const profileImgs: ElementHandle[] = [];

    for (const img of allImgs) {
      try {
        const info = await img.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const imgEl = el as HTMLImageElement;
          return {
            w: rect.width, h: rect.height,
            src: imgEl.src || '', alt: imgEl.alt || '',
            cls: el.className || '',
            visible: rect.width > 0 && rect.height > 0,
          };
        });

        if (!info.visible || info.w < 80 || info.h < 80) continue;
        if (info.w > 600 || info.h > 600) continue;
        if (EXCLUDE_IMG.test(info.src) || EXCLUDE_IMG.test(info.cls) || EXCLUDE_IMG.test(info.alt)) continue;
        const ratio = info.w / info.h;
        if (ratio < 0.4 || ratio > 1.8) continue;

        profileImgs.push(img);
      } catch { /* 무시 */ }
    }

    // 순서대로 의사에 매칭
    for (let i = 0; i < Math.min(profileImgs.length, doctorNames.length); i++) {
      const url = await captureAndUpload(profileImgs[i], hospitalId, i);
      if (url) {
        results[i].photoUrl = url;
        console.log(`    📸 ${doctorNames[i]} — 페이지 이미지 캡처`);
      }
    }
  }

  return results;
}

// ============================================================
// 자동 스크롤 (lazy-load 트리거)
// ============================================================
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight > 5000) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
  // 렌더링 대기
  await new Promise(r => setTimeout(r, 1000));
}

// ============================================================
// 의료진 페이지 URL 탐색 (브라우저 재사용)
// ============================================================
async function findDoctorPageUrl(
  page: Page,
  website: string,
): Promise<string | null> {
  try {
    await page.goto(website, { waitUntil: 'networkidle2', timeout: 20000 });
  } catch {
    // domcontentloaded로 재시도
    try {
      await page.goto(website, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      return null;
    }
  }

  // 1) 링크 텍스트에서 의료진 관련 찾기
  try {
    const links = await page.$$eval('a[href]', anchors =>
      anchors.map(a => ({
        href: (a as HTMLAnchorElement).href,
        text: a.textContent?.trim() || '',
      })).filter(l => l.href && !l.href.startsWith('javascript')),
    );

    for (const link of links) {
      for (const pattern of DOCTOR_LINK_PATTERNS) {
        if (pattern.test(link.text)) {
          try {
            return new URL(link.href, website).href;
          } catch { return link.href; }
        }
      }
    }

    // href 경로에서 탐색
    for (const link of links) {
      if (/doctor|staff|team|의료진|전문의/.test(link.href)) {
        try {
          return new URL(link.href, website).href;
        } catch { return link.href; }
      }
    }
  } catch { /* 링크 추출 실패 */ }

  // 2) 직접 경로 시도
  const base = website.replace(/\/$/, '');
  for (const suffix of DOCTOR_PATH_SUFFIXES) {
    try {
      const testUrl = `${base}${suffix}`;
      const resp = await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
      if (resp && resp.status() === 200) {
        const bodyText = await page.evaluate(() => document.body?.textContent || '');
        if (/원장|전문의|doctor|M\.D\./i.test(bodyText)) {
          return testUrl;
        }
      }
    } catch { /* timeout 무시 */ }
  }

  return null;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('📸 의사 인물 사진 캡처 시작 (v2.0 — element screenshot)...');
  if (dryRun) console.log('  (dry-run 모드)');
  if (force) console.log('  (force 모드 — 기존 사진 재캡처)');

  // 병원 + 의사 조회
  const { data: hospitals, error: hospErr } = await supabase
    .from('hospitals')
    .select('id, name, website')
    .not('website', 'is', null)
    .neq('website', '');

  if (hospErr || !hospitals) {
    console.error(`❌ 병원 조회 실패: ${hospErr?.message}`);
    return;
  }

  const { data: allDoctors } = await supabase
    .from('sales_hospital_doctors')
    .select('id, hospital_id, name, photo_url');

  if (!allDoctors) {
    console.error('❌ 의사 조회 실패');
    return;
  }

  // 병원별 의사 그룹핑
  const doctorsByHospital = new Map<string, DoctorInfo[]>();
  for (const d of allDoctors) {
    const list = doctorsByHospital.get(d.hospital_id) || [];
    list.push(d);
    doctorsByHospital.set(d.hospital_id, list);
  }

  let targetHospitals = hospitals
    .filter(h => doctorsByHospital.has(h.id) && h.website)
    .map(h => ({ id: h.id, name: h.name, website: h.website }));

  if (limit > 0) targetHospitals = targetHospitals.slice(0, limit);

  console.log(`  대상 병원: ${targetHospitals.length}개\n`);

  let totalDoctors = 0;
  let photosExtracted = 0;
  let hospitalsProcessed = 0;

  // 단일 브라우저 인스턴스 재사용
  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_ARGS,
  });

  try {
    for (const hospital of targetHospitals) {
      hospitalsProcessed++;
      console.log(`\n[${hospitalsProcessed}/${targetHospitals.length}] ${hospital.name}`);

      const doctors = doctorsByHospital.get(hospital.id) || [];
      const targets = force
        ? doctors
        : doctors.filter(d => !d.photo_url);

      if (targets.length === 0) {
        console.log('  → 모든 의사 사진 보유, skip');
        continue;
      }

      totalDoctors += targets.length;
      const doctorNames = targets.map(d => d.name);

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.setUserAgent(UA);

      try {
        // 의료진 페이지 탐색
        const doctorPageUrl = await findDoctorPageUrl(page, hospital.website);
        const targetUrl = doctorPageUrl || hospital.website;
        console.log(`  → ${doctorPageUrl ? '의료진 페이지' : '메인 페이지'}: ${targetUrl}`);

        // 의료진 페이지로 이동 (이미 이동한 경우 skip)
        const currentUrl = page.url();
        if (currentUrl !== targetUrl) {
          try {
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 20000 });
          } catch {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        if (dryRun) {
          console.log(`  → [dry-run] ${targets.length}명 사진 캡처 예정`);
        } else {
          // 인물 사진 캡처
          const results = await extractPhotosFromPage(page, hospital.id, doctorNames);

          for (const r of results) {
            if (!r.photoUrl) continue;
            const doc = targets.find(d => d.name === r.doctorName);
            if (!doc) continue;

            await supabase
              .from('sales_hospital_doctors')
              .update({ photo_url: r.photoUrl })
              .eq('id', doc.id);

            photosExtracted++;
          }

          const found = results.filter(r => r.photoUrl).length;
          console.log(`  → 캡처 결과: ${found}/${targets.length}명`);
        }
      } catch (err) {
        console.log(`  ⚠️ ${hospital.name} 실패: ${(err as Error).message}`);
      } finally {
        await page.close();
      }

      // rate limit
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    await browser.close();
  }

  console.log(`\n✅ 인물 사진 캡처 완료`);
  console.log(`  처리 병원: ${hospitalsProcessed}개`);
  console.log(`  대상 의사: ${totalDoctors}명`);
  console.log(`  캡처 성공: ${photosExtracted}명`);
  console.log(`  성공률: ${totalDoctors > 0 ? Math.round(photosExtracted / totalDoctors * 100) : 0}%`);
}

main().catch(err => {
  console.error('❌ 실행 실패:', err);
  process.exit(1);
});
