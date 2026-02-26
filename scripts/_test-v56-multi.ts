/**
 * v5.6 다병원 교차 검증: 사전 v1.2 + 비급여표 전처리 + OCR
 * 사용: npx tsx scripts/_test-v56-multi.ts --name "병원명" [--ocr]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildClassifyPrompt } from './v5/prompts.js';
import { getEquipmentNormalizationMap, getEquipmentCategoryMap } from './crawler/dictionary-loader.js';
import { captureScreenshots, closeBrowser, type ScreenshotResult } from './v5/screenshot-capture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function getSaToken(): Promise<string> {
  const saKeyPath = path.resolve(__dirname, process.env.GOOGLE_SA_KEY_PATH || './google-sa-key.json');
  const sa = JSON.parse(fs.readFileSync(saKeyPath, 'utf-8'));
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/generative-language',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), sa.private_key).toString('base64url');
  const resp = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${sig}`,
  });
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

function getPagePriority(url: string, text: string): number {
  const lowered = (url + ' ' + text.slice(0, 500)).toLowerCase();
  const HIGH = ['시술', '치료', '장비', '의료진', '의사', '가격', '비용', '비급여', '이벤트', '프로모션', '진료', 'device', 'staff', 'doctor', 'procedure', 'treatment', 'price'];
  const LOW = ['블로그', '후기', '리뷰', '공지', '뉴스', '오시는길', '오시는 길', '개인정보', '이용약관', '사이트맵', 'sitemap', 'privacy', 'terms', 'notice', 'blog', 'review'];
  if (LOW.some(k => lowered.includes(k))) return 1;
  if (HIGH.some(k => lowered.includes(k))) return 3;
  return 2;
}

function extractNongeubyeoSection(allText: string): { mainText: string; nongeubyeoSection: string | null } {
  const KEYWORDS = ['비급여항목안내', '비급여항목', '비급여안내', '비급여 진료비', '비급여진료비'];
  const lines = allText.split('\n');
  const tableBlocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!KEYWORDS.some(kw => line.includes(kw))) continue;

    const block: string[] = [line];
    let tableStarted = false;
    let emptyCount = 0;
    let nonTableLines = 0;

    for (let j = i + 1; j < Math.min(i + 500, lines.length); j++) {
      const nl = lines[j];
      const isTable = nl.trim().startsWith('|') && nl.includes('|');
      const isSep = /^\|[\s\-|]+\|$/.test(nl.trim());

      if (isTable || isSep) { block.push(nl); tableStarted = true; emptyCount = 0; nonTableLines = 0; }
      else if (nl.trim() === '') { emptyCount++; if (tableStarted && emptyCount > 2) break; block.push(nl); }
      else if (!tableStarted) { nonTableLines++; if (nonTableLines > 50) break; block.push(nl); }
      else { break; }
    }

    const rows = block.filter(l => l.trim().startsWith('|') && l.includes('|'));
    if (rows.length >= 3) tableBlocks.push(block.join('\n'));
  }

  if (tableBlocks.length === 0) return { mainText: allText, nongeubyeoSection: null };

  const unique: string[] = [];
  for (const b of tableBlocks) {
    const key = b.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|');
    if (!unique.some(u => u.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|') === key))
      unique.push(b);
  }

  const txt = unique.join('\n\n');
  const rows = txt.split('\n').filter(l => l.trim().startsWith('|')).length;
  console.log(`  비급여표: ${unique.length}블록, ${rows}행`);

  return {
    mainText: allText,
    nongeubyeoSection: `\n========================================\n★★★ 아래는 비급여항목 가격표입니다. 모든 행을 추출하세요. ★★★\n========================================\n${txt}`,
  };
}

interface TestResult {
  hospital: string;
  pages: number;
  chars: number;
  nongeubyeoChars: number;
  tokensIn: number;
  tokensOut: number;
  elapsed: number;
  devices: number;
  matched: number;
  unmatched: number;
  treatments: number;
  priced: number;
  nongeubyeo: number;
  eventPairs: number;
  withQuantity: number;
  doctors: number;
  unregEquip: number;
  unregTreat: number;
  phone: string;
  kakao: string;
  instagram: string;
  youtube: string;
  blog: string;
  notes: string[];
}

async function testHospital(hospitalName: string, useOcr: boolean): Promise<TestResult> {
  const SNAPSHOT_DIR = path.resolve(__dirname, '..', 'snapshots', '2026-02-22-v4', hospitalName);
  if (!fs.existsSync(SNAPSHOT_DIR)) throw new Error(`스냅샷 없음: ${SNAPSHOT_DIR}`);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${hospitalName} — v5.6 테스트${useOcr ? ' + OCR' : ''}`);
  console.log('═'.repeat(60));

  // 마크다운 읽기 + 우선순위 정렬
  const entries = fs.readdirSync(SNAPSHOT_DIR).filter(e => e.startsWith('page-')).sort();
  interface PageData { dir: string; url: string; md: string; priority: number }
  const pages: PageData[] = [];
  for (const pd of entries) {
    const mdPath = path.join(SNAPSHOT_DIR, pd, 'content.md');
    if (!fs.existsSync(mdPath)) continue;
    const md = fs.readFileSync(mdPath, 'utf-8');
    if (md.trim().length <= 50) continue;
    let url = '';
    try { const m = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, pd, 'metadata.json'), 'utf-8')); url = m.sourceURL || m.url || ''; } catch {}
    const priority = getPagePriority(url, md);
    pages.push({ dir: pd, url, md, priority });
  }
  // 높은 우선순위가 앞으로
  pages.sort((a, b) => b.priority - a.priority);
  const markdowns = pages.map(p => `\n=== PAGE: ${p.url || p.dir} ===\n${p.md}`);

  const rawFull = markdowns.join('\n\n');
  console.log(`  마크다운: ${markdowns.length}페이지, ${rawFull.length.toLocaleString()}자 (정렬: high ${pages.filter(p=>p.priority>=3).length} / mid ${pages.filter(p=>p.priority===2).length} / low ${pages.filter(p=>p.priority<=1).length})`);

  // 비급여표 전처리 (전체 텍스트에서 추출, truncation 없음)
  const { mainText, nongeubyeoSection } = extractNongeubyeoSection(rawFull);
  const combined = nongeubyeoSection ? mainText + '\n\n' + nongeubyeoSection : mainText;

  // OCR: Playwright 스크린샷 수집
  const screenshotParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  if (useOcr) {
    // 스냅샷 metadata에서 고유 URL 추출
    const urls = new Set<string>();
    for (const pd of entries) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, pd, 'metadata.json'), 'utf-8'));
        const url = m.sourceURL || m.url || '';
        if (url && url.startsWith('http')) urls.add(url);
      } catch { /* skip */ }
    }
    const uniqueUrls = [...urls];
    // 주요 페이지만 선별 (최대 10개 URL, 각 최대 5장)
    const maxUrls = Math.min(uniqueUrls.length, 10);
    console.log(`  OCR: ${uniqueUrls.length}개 URL 중 ${maxUrls}개 스크린샷 촬영`);

    for (let ui = 0; ui < maxUrls; ui++) {
      const url = uniqueUrls[ui];
      try {
        const sr = await captureScreenshots(url, {
          viewportWidth: 1280,
          viewportHeight: 800,
          maxScreenshots: 5,
          timeout: 15000,
          waitAfterScroll: 400,
        });
        for (const buf of sr.screenshots) {
          screenshotParts.push({
            inlineData: { mimeType: 'image/png', data: buf.toString('base64') },
          });
        }
        console.log(`    [${ui + 1}/${maxUrls}] ${new URL(url).pathname.slice(0, 40)} → ${sr.screenshots.length}장`);
      } catch (err) {
        console.log(`    [${ui + 1}/${maxUrls}] 실패: ${(err as Error).message.slice(0, 60)}`);
      }
    }
    console.log(`  OCR 총: ${screenshotParts.length}장 (≈${Math.round(screenshotParts.length * 1290 / 1000)}K 토큰)`);
  }

  // Gemini 호출
  const prompt = buildClassifyPrompt(hospitalName);
  let fullPrompt = prompt + '\n\n## 웹사이트 텍스트\n' + combined;
  if (useOcr && screenshotParts.length > 0) {
    fullPrompt += '\n\n## 추가 지시: 스크린샷 이미지 분석\n'
      + '- 첨부된 스크린샷 이미지에 보이는 시술명, 가격, 의사 정보, 장비 사진도 분석하세요.\n'
      + '- 텍스트에서 추출한 정보와 이미지에서 추출한 정보를 합쳐서 최종 결과를 만드세요.\n'
      + '- 이미지에서만 확인 가능한 정보는 source: "screenshot"으로 표기하세요.\n'
      + '- 이미지 안의 한국어 텍스트를 정확히 읽어주세요.\n';
  }
  console.log(`  프롬프트+텍스트: ${fullPrompt.length.toLocaleString()}자${screenshotParts.length > 0 ? ` + 이미지 ${screenshotParts.length}장` : ''}`);

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const token = await getSaToken();

  // parts 구성: 텍스트 + 이미지
  const parts: Array<Record<string, unknown>> = [{ text: fullPrompt }];
  for (const sp of screenshotParts) { parts.push(sp); }

  console.log('  Gemini 호출 중...');
  const start = Date.now();
  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536, responseMimeType: 'application/json' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`  Gemini API error ${response.status}: ${errText.slice(0, 300)}`);
    return { hospital: hospitalName, pages: markdowns.length, chars: rawFull.length, nongeubyeoChars: nongeubyeoSection?.length ?? 0, tokensIn: 0, tokensOut: 0, elapsed: (Date.now()-start)/1000, devices: 0, matched: 0, unmatched: 0, treatments: 0, priced: 0, nongeubyeo: 0, eventPairs: 0, withQuantity: 0, doctors: 0, unregEquip: 0, unregTreat: 0, phone: '', kakao: '', instagram: '', youtube: '', blog: '', notes: [`API error ${response.status}`] };
  }

  const json = await response.json() as Record<string, unknown>;
  const elapsed = (Date.now() - start) / 1000;
  const meta = json.usageMetadata as Record<string, number> | undefined;
  const tokensIn = meta?.promptTokenCount ?? 0;
  const tokensOut = meta?.candidatesTokenCount ?? 0;
  const candidates = json.candidates as Array<Record<string, unknown>> | undefined;
  const text = ((candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>>)?.[0]?.text as string | undefined;
  console.log(`  완료: ${elapsed.toFixed(1)}초, in=${tokensIn}, out=${tokensOut}`);

  if (!text) return { hospital: hospitalName, pages: markdowns.length, chars: rawFull.length, nongeubyeoChars: 0, tokensIn, tokensOut, elapsed, devices: 0, matched: 0, unmatched: 0, treatments: 0, priced: 0, nongeubyeo: 0, eventPairs: 0, withQuantity: 0, doctors: 0, unregEquip: 0, unregTreat: 0, phone: '', kakao: '', instagram: '', youtube: '', blog: '', notes: ['응답 없음'] };

  let result: Record<string, unknown>;
  const cleanJson = (s: string): string => s.replace(/[\x00-\x1f]/g, ' ').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  const repairTruncatedJson = (s: string): string => {
    // 잘린 JSON 복구: 열린 bracket/brace를 닫아줌
    let repaired = s.replace(/,\s*$/, ''); // trailing comma 제거
    const opens: string[] = [];
    let inString = false;
    let escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{' || ch === '[') opens.push(ch);
      else if (ch === '}' || ch === ']') opens.pop();
    }
    if (inString) repaired += '"'; // 열린 문자열 닫기
    while (opens.length > 0) {
      const open = opens.pop();
      repaired += open === '{' ? '}' : ']';
    }
    return repaired;
  };

  try {
    result = JSON.parse(text);
  } catch (e1) {
    console.log(`  JSON 파싱 오류: ${(e1 as Error).message.slice(0, 80)}`);
    try {
      result = JSON.parse(cleanJson(text));
      console.log('  → 이스케이프 수정 후 성공');
    } catch {
      // 잘린 JSON 복구 시도
      try {
        result = JSON.parse(repairTruncatedJson(cleanJson(text)));
        console.log('  → 잘린 JSON 복구 성공');
      } catch {
        // ```json ... ``` 블록 추출 시도
        const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const rawJson = codeBlock ? codeBlock[1] : text;
        const jsonMatch = rawJson.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            result = JSON.parse(repairTruncatedJson(cleanJson(jsonMatch[0])));
            console.log('  → JSON 추출+복구 후 성공');
          } catch (e4) {
            console.error(`  ❌ JSON 최종 파싱 실패: ${(e4 as Error).message.slice(0, 80)}`);
            const debugPath = path.resolve(__dirname, '..', 'output', `v56-debug-${hospitalName}.txt`);
            fs.writeFileSync(debugPath, text, 'utf-8');
            console.log(`  원문 저장: ${debugPath} (${text.length}자)`);
            result = {};
          }
        } else {
          console.error('  ❌ JSON 객체 미발견');
          result = {};
        }
      }
    }
  }

  // 장비 후처리: injectable 분리 + 중복 제거
  const rawDevices = (result.medical_devices || result.equipments || []) as Array<Record<string, unknown>>;
  if (rawDevices.length > 0) {
    const INJECTABLE_SUBS = new Set(['booster', 'collagen_stimulator', 'filler', 'botox', 'lipolytic', 'thread']);
    const actualDevices: Array<Record<string, unknown>> = [];
    const injectables: Array<Record<string, unknown>> = [];
    for (const d of rawDevices) {
      const sub = (d.subcategory || d.device_type || '') as string;
      if (INJECTABLE_SUBS.has(sub)) { injectables.push(d); } else { actualDevices.push(d); }
    }
    if (injectables.length > 0) {
      console.log(`  주사제/약제 분리: ${injectables.length}건 → treatments로 이동`);
    }
    // 중복 제거
    const seen = new Set<string>();
    const deduped = actualDevices.filter(d => {
      const name = ((d.name || d.equipment_name || '') as string).toLowerCase().replace(/[\s\-_.]/g, '');
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
    if (deduped.length < actualDevices.length) {
      console.log(`  장비 중복 제거: ${actualDevices.length} → ${deduped.length}`);
    }
    result.medical_devices = deduped;
  }

  // 결과 저장
  const outPath = path.resolve(__dirname, '..', 'output', `v56-test-${hospitalName}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  // 분석
  const normMap = getEquipmentNormalizationMap();
  const devices = (result.medical_devices || result.equipments || []) as Array<Record<string, unknown>>;
  let matched = 0, unmatched = 0;
  for (const d of devices) {
    const name = (d.name || d.equipment_name || '') as string;
    if (normMap.has(name.toLowerCase())) matched++; else unmatched++;
  }

  const treatments = (result.treatments || []) as Array<Record<string, unknown>>;
  const priced = treatments.filter(t => (t.regular_price && (t.regular_price as number) > 0) || (t.event_price && (t.event_price as number) > 0) || (t.price && (t.price as number) > 0) || (t.min_price && (t.min_price as number) > 0));
  const ngItems = treatments.filter(t => t.source === 'nongeubyeo');
  const eventPairs = treatments.filter(t => (t.regular_price && (t.regular_price as number) > 0) && (t.event_price && (t.event_price as number) > 0));
  const withQty = treatments.filter(t => t.quantity && (t.quantity as number) > 0);
  const doctors = (result.doctors || []) as Array<Record<string, unknown>>;
  const unregEq = (result.unregistered_equipment || []) as Array<Record<string, unknown>>;
  const unregTr = (result.unregistered_treatments || []) as Array<Record<string, unknown>>;
  const contact = (result.contact_info || {}) as Record<string, unknown>;

  const notes: string[] = [];
  if (nongeubyeoSection) notes.push(`비급여표 ${nongeubyeoSection.length.toLocaleString()}자`);
  else notes.push('비급여표 없음');
  if (devices.length === 0) notes.push('장비 0개');
  if (doctors.length === 0) notes.push('의사 0명');

  console.log(`  장비: ${devices.length} (매칭${matched}/미등록${unmatched})`);
  console.log(`  시술: ${treatments.length}, 가격: ${priced.length} (비급여${ngItems.length})`);
  console.log(`  의사: ${doctors.length}`);

  const phoneArr = (contact.phone || []) as Array<Record<string, unknown>>;
  const phoneStr = phoneArr.map(p => (p.number || p) as string).join(', ') || '(없음)';

  return {
    hospital: hospitalName,
    pages: markdowns.length,
    chars: rawFull.length,
    nongeubyeoChars: nongeubyeoSection?.length ?? 0,
    tokensIn, tokensOut, elapsed,
    devices: devices.length,
    matched, unmatched,
    treatments: treatments.length,
    priced: priced.length,
    nongeubyeo: ngItems.length,
    eventPairs: eventPairs.length,
    withQuantity: withQty.length,
    doctors: doctors.length,
    unregEquip: unregEq.length,
    unregTreat: unregTr.length,
    phone: phoneStr,
    kakao: (contact.kakao_channel || '(없음)') as string,
    instagram: (contact.instagram || '(없음)') as string,
    youtube: (contact.youtube || '(없음)') as string,
    blog: (contact.blog || '(없음)') as string,
    notes,
  };
}

async function main(): Promise<void> {
  const nameIdx = process.argv.indexOf('--name');
  const targetName = nameIdx >= 0 ? process.argv[nameIdx + 1] : null;
  const useOcr = process.argv.includes('--ocr');

  if (useOcr) console.log('OCR 모드 활성화: Playwright 스크린샷 + Gemini 멀티모달');

  const hospitals = targetName ? [targetName] : ['닥터스피부과신사', '고운세상피부과명동', '톡스앤필강서'];
  const results: TestResult[] = [];

  for (let i = 0; i < hospitals.length; i++) {
    if (i > 0) {
      console.log('\n  ⏳ 10초 대기 (Gemini rate limit)...');
      await new Promise(r => setTimeout(r, 10000));
    }
    try {
      const r = await testHospital(hospitals[i], useOcr);
      results.push(r);
    } catch (err) {
      console.error(`  ❌ ${hospitals[i]} 실패: ${(err as Error).message}`);
    }
  }

  // OCR 모드 시 브라우저 종료
  if (useOcr) await closeBrowser();

  if (results.length === 0) return;

  // 종합 비교표
  console.log('\n\n' + '═'.repeat(70));
  console.log('              v5.6 다병원 교차 검증 결과');
  console.log('═'.repeat(70));

  const header = ['항목', ...results.map(r => r.hospital)];
  const rows = [
    ['크롤 페이지', ...results.map(r => String(r.pages))],
    ['텍스트(K)', ...results.map(r => Math.round(r.chars/1000) + 'K')],
    ['비급여표', ...results.map(r => r.nongeubyeoChars > 0 ? '있음' : '없음')],
    ['장비 총', ...results.map(r => String(r.devices))],
    ['장비 매칭', ...results.map(r => String(r.matched))],
    ['미등록장비', ...results.map(r => String(r.unregEquip))],
    ['시술 총', ...results.map(r => String(r.treatments))],
    ['가격 수', ...results.map(r => String(r.priced))],
    ['비급여가격', ...results.map(r => String(r.nongeubyeo))],
    ['정가+이벤트', ...results.map(r => String(r.eventPairs))],
    ['수량+단위', ...results.map(r => String(r.withQuantity))],
    ['의사 수', ...results.map(r => String(r.doctors))],
    ['전화', ...results.map(r => r.phone.slice(0, 20))],
    ['카카오', ...results.map(r => r.kakao === '(없음)' ? '-' : 'O')],
    ['인스타', ...results.map(r => r.instagram === '(없음)' ? '-' : 'O')],
    ['유튜브', ...results.map(r => r.youtube === '(없음)' ? '-' : 'O')],
    ['블로그', ...results.map(r => r.blog === '(없음)' ? '-' : 'O')],
    ['토큰(in/out)', ...results.map(r => `${Math.round(r.tokensIn/1000)}K/${Math.round(r.tokensOut/1000)}K`)],
    ['소요시간', ...results.map(r => r.elapsed.toFixed(0) + '초')],
    ['특이사항', ...results.map(r => r.notes.join(', '))],
  ];

  // 컬럼 너비 계산
  const colWidths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] || '').length)));
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));

  console.log('| ' + header.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |');
  console.log('|' + header.map((_, i) => '-'.repeat(colWidths[i] + 2)).join('|') + '|');
  for (const row of rows) {
    console.log('| ' + row.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |');
  }

  // 결과 저장
  const summaryPath = path.resolve(__dirname, '..', 'output', 'v56-multi-test-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n결과 저장: ${summaryPath}`);
}

main().catch(console.error);
