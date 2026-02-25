/**
 * v5.1 카드+모달 자동 감지 + 순차 클릭
 *
 * 트리거: doctor 페이지에서 의사 N명 추출됐는데 education/career 비율 30% 미만
 * 실행: Puppeteer로 "자세히보기" 버튼 순차 클릭 → 모달 캡처 → Vision 분석
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { supabase } from '../utils/supabase.js';
import type { AnalysisResult } from './types.js';

interface ModalCaptureResult {
  index: number;
  buffer: Buffer;
  doctorName: string;
  publicUrl: string;
}

// ============================================================
// 경력/학력 비율 체크
// ============================================================
export function needsModalCrawl(doctors: AnalysisResult['doctors']): boolean {
  if (doctors.length === 0) return false;
  const withDetail = doctors.filter(d =>
    (d.education && d.education.trim().length > 0) ||
    (d.career && d.career.trim().length > 0)
  ).length;
  const ratio = withDetail / doctors.length;
  return ratio < 0.3;
}

// ============================================================
// 자세히보기 버튼 셀렉터 찾기
// ============================================================
const DETAIL_SELECTORS = [
  'a[class*="detail"]', 'button[class*="detail"]',
  'a[class*="more"]', 'button[class*="more"]',
  '[class*="자세히"]', '[class*="상세"]',
  '[onclick*="detail"]', '[onclick*="pop"]', '[onclick*="modal"]',
  '.btn-view', '.btn-detail', '.view-detail',
  'a[href*="javascript"][class*="btn"]',
];

const CLOSE_SELECTORS = [
  '.modal-close', '[class*="close"]', '.popup-close',
  '.btn-close', 'button.close', '[class*="닫기"]',
  '.fancybox-close', '.featherlight-close',
];

// ============================================================
// 모달 캡처
// ============================================================
export async function crawlDoctorModals(
  doctorPageUrl: string,
  hospitalId: string,
): Promise<{ success: boolean; captures: ModalCaptureResult[]; reason?: string }> {
  console.log('  🔍 카드+모달 패턴 감지 → Puppeteer 자세히보기 순차 클릭');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch (err) {
    console.log(`  ❌ Puppeteer 브라우저 실행 실패: ${err}`);
    return { success: false, captures: [], reason: 'browser_launch_failed' };
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(doctorPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 팝업 닫기 시도
    for (const cs of CLOSE_SELECTORS) {
      try {
        const btn = await page.$(cs);
        if (btn) { await btn.click(); await new Promise(r => setTimeout(r, 500)); }
      } catch { /* 무시 */ }
    }

    // 자세히보기 버튼 찾기
    let buttonSelector = '';
    let buttonCount = 0;
    for (const sel of DETAIL_SELECTORS) {
      try {
        const count = await page.$$eval(sel, els => els.length);
        if (count > 0) {
          buttonSelector = sel;
          buttonCount = count;
          console.log(`  📌 셀렉터 "${sel}" → ${count}개 버튼 발견`);
          break;
        }
      } catch { /* 무시 */ }
    }

    if (!buttonSelector) {
      console.log('  ⚠️ 자세히보기 버튼 셀렉터 못 찾음 → manual_review');
      await browser.close();
      return { success: false, captures: [], reason: 'no_detail_button_found' };
    }

    const captures: ModalCaptureResult[] = [];

    for (let i = 0; i < buttonCount; i++) {
      try {
        // 버튼 다시 조회 (DOM 변경 대응)
        const buttons = await page.$$(buttonSelector);
        if (!buttons[i]) continue;

        // 스크롤 into view + 클릭
        await buttons[i].scrollIntoView();
        await new Promise(r => setTimeout(r, 300));
        await buttons[i].click();
        await new Promise(r => setTimeout(r, 1200)); // 모달 애니메이션 대기

        // 모달 캡처
        const screenshotBuf = await page.screenshot({ type: 'png' });

        // 모달에서 이름 텍스트 추출 시도
        let nameText = `doctor_${i}`;
        for (const nameSel of ['.modal-title', '.popup-title', '.doctor-name', '[class*="name"]', 'h2', 'h3']) {
          try {
            nameText = await page.$eval(nameSel, el => el.textContent?.trim() || '');
            if (nameText && nameText.length > 1 && nameText.length < 20) break;
          } catch { /* 다음 시도 */ }
        }

        // sharp 최적화
        const optimized = await sharp(Buffer.from(screenshotBuf))
          .resize(1280, null, { withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();

        // Supabase Storage 업로드
        const timestamp = Date.now();
        const storagePath = `${hospitalId}/doctor_modal_${i}_${timestamp}.webp`;
        const { error: uploadErr } = await supabase.storage
          .from('hospital-screenshots')
          .upload(storagePath, optimized, { contentType: 'image/webp', upsert: true });

        let publicUrl = '';
        if (!uploadErr) {
          publicUrl = supabase.storage.from('hospital-screenshots').getPublicUrl(storagePath).data.publicUrl;
        }

        captures.push({ index: i, buffer: optimized, doctorName: nameText, publicUrl });
        console.log(`  ✅ ${i + 1}/${buttonCount} ${nameText} 모달 캡처`);

        // 모달 닫기
        let closed = false;
        for (const cs of CLOSE_SELECTORS) {
          try {
            const closeBtn = await page.$(cs);
            if (closeBtn) {
              await closeBtn.click();
              closed = true;
              break;
            }
          } catch { /* 무시 */ }
        }
        if (!closed) {
          try { await page.keyboard.press('Escape'); } catch { /* 무시 */ }
        }
        await new Promise(r => setTimeout(r, 500));

      } catch (err) {
        console.log(`  ⚠️ ${i + 1}/${buttonCount} 모달 캡처 실패: ${(err as Error).message}`);
      }
    }

    await browser.close();
    console.log(`  📸 모달 캡처 완료: ${captures.length}/${buttonCount}장`);
    return { success: captures.length > 0, captures };

  } catch (err) {
    if (browser) await browser.close();
    console.log(`  ❌ 모달 크롤링 실패: ${(err as Error).message}`);
    return { success: false, captures: [], reason: (err as Error).message };
  }
}

// ============================================================
// 탭/아코디언 클릭 대응
// ============================================================
const TAB_SELECTORS = [
  '[role="tab"]', '.tab-item', '.tab-link', '.nav-link',
  '[class*="tab"]', 'li[class*="menu"]',
  '.category-tab', '.sub-tab',
];

export async function crawlTabContents(
  pageUrl: string,
  hospitalId: string,
  pageType: string,
): Promise<{ success: boolean; captures: Array<{ buffer: Buffer; tabName: string; publicUrl: string }> }> {
  console.log('  🔍 탭/아코디언 패턴 감지 → Puppeteer 탭 순차 클릭');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  } catch {
    return { success: false, captures: [] };
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // 탭 버튼 찾기
    let tabSelector = '';
    let tabCount = 0;
    for (const sel of TAB_SELECTORS) {
      try {
        const count = await page.$$eval(sel, els => els.length);
        if (count >= 2) {
          tabSelector = sel;
          tabCount = count;
          console.log(`  📌 탭 셀렉터 "${sel}" → ${count}개 탭`);
          break;
        }
      } catch { /* 무시 */ }
    }

    if (!tabSelector) {
      await browser.close();
      return { success: false, captures: [] };
    }

    const captures: Array<{ buffer: Buffer; tabName: string; publicUrl: string }> = [];

    for (let i = 0; i < tabCount; i++) {
      try {
        const tabs = await page.$$(tabSelector);
        if (!tabs[i]) continue;

        const tabName = await tabs[i].evaluate(el => el.textContent?.trim() || `tab_${i}`);
        await tabs[i].click();
        await new Promise(r => setTimeout(r, 1000));

        const screenshotBuf = await page.screenshot({ type: 'png', fullPage: false });
        const optimized = await sharp(Buffer.from(screenshotBuf))
          .resize(1280, null, { withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();

        const timestamp = Date.now();
        const storagePath = `${hospitalId}/${pageType}_tab_${i}_${timestamp}.webp`;
        await supabase.storage.from('hospital-screenshots')
          .upload(storagePath, optimized, { contentType: 'image/webp', upsert: true });

        const publicUrl = supabase.storage.from('hospital-screenshots').getPublicUrl(storagePath).data.publicUrl;
        captures.push({ buffer: optimized, tabName, publicUrl });
        console.log(`  ✅ 탭 ${i + 1}/${tabCount} "${tabName}" 캡처`);

      } catch (err) {
        console.log(`  ⚠️ 탭 ${i + 1} 캡처 실패: ${(err as Error).message}`);
      }
    }

    await browser.close();
    return { success: captures.length > 0, captures };

  } catch (err) {
    if (browser) await browser.close();
    return { success: false, captures: [] };
  }
}
