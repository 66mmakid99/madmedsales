/**
 * v5.6 테스트: 바노바기피부과 — 비급여표 전처리 + 가격 스키마 v2 + 사전 v1.1
 * v5.5 대비 비교표 출력
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildClassifyPrompt } from './v5/prompts.js';
import { getEquipmentNormalizationMap, getEquipmentCategoryMap } from './crawler/dictionary-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

// SA JWT 인증
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

// 비급여표 전처리 함수 (recrawl-v5.ts와 동일 로직)
function extractNongeubyeoSection(allText: string): { mainText: string; nongeubyeoSection: string | null } {
  const NONGEUBYEO_KEYWORDS = ['비급여항목안내', '비급여항목', '비급여안내', '비급여 진료비', '비급여진료비'];
  const lines = allText.split('\n');
  const tableBlocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasNongeubyeoKeyword = NONGEUBYEO_KEYWORDS.some(kw => line.includes(kw));

    if (hasNongeubyeoKeyword) {
      // 비급여 키워드 발견 → 이후 테이블 행 수집 (최대 500줄 탐색)
      const block: string[] = [line];
      let tableStarted = false;
      let emptyLineCount = 0;

      for (let j = i + 1; j < Math.min(i + 500, lines.length); j++) {
        const nextLine = lines[j];
        const isTableRow = nextLine.trim().startsWith('|') && nextLine.includes('|');
        const isSeparator = /^\|[\s\-|]+\|$/.test(nextLine.trim());

        if (isTableRow || isSeparator) {
          block.push(nextLine);
          tableStarted = true;
          emptyLineCount = 0;
        } else if (nextLine.trim() === '') {
          emptyLineCount++;
          if (tableStarted && emptyLineCount > 2) break; // 테이블 끝
          block.push(nextLine);
        } else if (!tableStarted) {
          block.push(nextLine); // 테이블 시작 전 맥락
        } else {
          // 테이블 중간에 비테이블 행 → 종료
          break;
        }
      }

      // 테이블 행이 3줄 이상이면 유효
      const tableRows = block.filter(l => l.trim().startsWith('|') && l.includes('|'));
      if (tableRows.length >= 3) {
        tableBlocks.push(block.join('\n'));
      }
    }
  }

  if (tableBlocks.length === 0) {
    return { mainText: allText, nongeubyeoSection: null };
  }

  // 중복 제거: 첫 5줄이 동일하면 중복
  const uniqueBlocks: string[] = [];
  for (const block of tableBlocks) {
    const blockLines = block.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|');
    const isDuplicate = uniqueBlocks.some(existing => {
      const existingLines = existing.split('\n').filter(l => l.trim().startsWith('|')).slice(0, 5).join('|');
      return blockLines === existingLines;
    });
    if (!isDuplicate) uniqueBlocks.push(block);
  }

  const nongeubyeoText = uniqueBlocks.join('\n\n');
  console.log(`  비급여표 감지: ${uniqueBlocks.length}개 블록, ${nongeubyeoText.split('\n').filter(l => l.trim().startsWith('|')).length}행`);

  const nongeubyeoSection = `
========================================
★★★ 아래는 비급여항목 가격표입니다. 모든 행을 추출하세요. ★★★
========================================
${nongeubyeoText}`;

  return { mainText: allText, nongeubyeoSection };
}

const HOSPITAL_NAME = '바노바기피부과';
const SNAPSHOT_DIR = path.resolve(__dirname, '..', 'snapshots', '2026-02-22-v4', HOSPITAL_NAME);

async function main(): Promise<void> {
  console.log(`=== v5.6 테스트: ${HOSPITAL_NAME} ===\n`);

  // 1. 스냅샷 마크다운 읽기
  const entries = fs.readdirSync(SNAPSHOT_DIR).filter(e => e.startsWith('page-')).sort();
  const markdowns: string[] = [];

  for (const pd of entries) {
    const mdPath = path.join(SNAPSHOT_DIR, pd, 'content.md');
    if (fs.existsSync(mdPath)) {
      const md = fs.readFileSync(mdPath, 'utf-8');
      if (md.trim().length > 50) {
        let url = '';
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, pd, 'metadata.json'), 'utf-8'));
          url = meta.sourceURL || meta.url || '';
        } catch { /* ignore */ }
        markdowns.push(`\n=== PAGE: ${url || pd} ===\n${md}`);
      }
    }
  }

  const rawCombinedFull = markdowns.join('\n\n'); // 전체 텍스트 (제한 없음)
  console.log(`마크다운: ${markdowns.length}페이지, ${rawCombinedFull.length.toLocaleString()}자\n`);

  // 2. [v5.6] 비급여표 전처리 — 전체 텍스트에서 비급여표 추출
  const { mainText, nongeubyeoSection } = extractNongeubyeoSection(rawCombinedFull);
  if (nongeubyeoSection) {
    console.log(`비급여표 전처리: 감지됨 (${nongeubyeoSection.length.toLocaleString()}자 별도 섹션)`);
  } else {
    console.log('비급여표 전처리: 비급여 테이블 미감지');
  }

  // 텍스트 조립: 메인 텍스트 + 비급여표 별도 섹션
  const combined = nongeubyeoSection ? mainText + '\n\n' + nongeubyeoSection : mainText;
  console.log(`최종 텍스트: ${combined.length.toLocaleString()}자\n`);

  // 3. v5.6 프롬프트 생성
  const prompt = buildClassifyPrompt(HOSPITAL_NAME);
  console.log(`프롬프트 길이: ${prompt.length.toLocaleString()}자 (~${Math.round(prompt.length / 3.5)} tokens)`);
  console.log(`v5.6 확인: 비급여=${prompt.includes('비급여항목표 추출')}, 이벤트가격=${prompt.includes('이벤트 가격 추출 규칙')}, 미등록강화=${prompt.includes('미등록 장비/시술 처리')}, SNS=${prompt.includes('SNS 채널 추출')}`);
  console.log(`가격스키마v2: regular_price=${prompt.includes('regular_price')}, source=${prompt.includes('nongeubyeo')}, quantity=${prompt.includes('quantity')}`);
  console.log(`subcategory: 카테고리별목록=${prompt.includes('카테고리별 장비 목록')}\n`);

  // 4. Gemini 호출
  console.log('Gemini 호출 중...');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const token = await getSaToken();

  const fullPrompt = prompt + '\n\n## 웹사이트 텍스트\n' + combined;

  const body = {
    contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json',
    },
  };

  const start = Date.now();
  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini API error ${response.status}: ${errText.slice(0, 500)}`);
    return;
  }

  const json = await response.json() as Record<string, unknown>;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const meta = json.usageMetadata as Record<string, number> | undefined;
  const tokensIn = meta?.promptTokenCount ?? 0;
  const tokensOut = meta?.candidatesTokenCount ?? 0;
  const candidates = json.candidates as Array<Record<string, unknown>> | undefined;
  const finishReason = candidates?.[0]?.finishReason ?? 'unknown';

  console.log(`완료! ${elapsed}초, tokens: in=${tokensIn}, out=${tokensOut}, finish=${finishReason}\n`);

  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  const text = parts?.[0]?.text as string | undefined;
  if (!text) {
    console.error('Gemini 응답 없음');
    return;
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(text);
  } catch (e1) {
    // JSON 이스케이프 오류 수정 시도
    try {
      const cleaned = text
        .replace(/[\x00-\x1f]/g, ' ') // 제어 문자 제거
        .replace(/\\(?!["\\/bfnrtu])/g, '\\\\'); // 잘못된 이스케이프 수정
      result = JSON.parse(cleaned);
      console.log('JSON 이스케이프 수정 후 파싱 성공');
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const cleaned2 = jsonMatch[0]
            .replace(/[\x00-\x1f]/g, ' ')
            .replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
          result = JSON.parse(cleaned2);
          console.log('JSON 추출+수정 후 파싱 성공');
        } catch (e3) {
          console.error(`JSON 파싱 실패: ${(e1 as Error).message}`);
          // 원문 저장하여 디버깅
          const debugPath = path.resolve(__dirname, '..', 'output', 'v56-test-raw-response.txt');
          fs.writeFileSync(debugPath, text, 'utf-8');
          console.error(`원문 저장: ${debugPath}`);
          return;
        }
      } else {
        console.error('JSON 파싱 실패: JSON 객체 미발견');
        return;
      }
    }
  }

  // 5. 결과 분석
  console.log('━'.repeat(60));
  console.log('              v5.6 분석 결과');
  console.log('━'.repeat(60));

  // 장비
  const devices = (result.medical_devices || result.equipments || []) as Array<Record<string, unknown>>;
  const normMap = getEquipmentNormalizationMap();
  const catMap = getEquipmentCategoryMap();
  let matchedCount = 0;
  let unmatchedCount = 0;

  console.log(`\n장비/의료기기: ${devices.length}개`);
  for (const d of devices) {
    const name = (d.name || d.equipment_name || '') as string;
    const normalized = normMap.get(name.toLowerCase());
    const catInfo = normalized ? catMap.get(normalized.toLowerCase()) : undefined;
    if (normalized) matchedCount++;
    else unmatchedCount++;
    const type = (d.device_type || '') as string;
    const sub = (d.subcategory || '') as string;
    const dictCat = catInfo ? catInfo.category : '';
    console.log(`  - ${name} → ${normalized || '(미등록)'} [${type}/${sub}] dict:${dictCat}`);
  }
  console.log(`  사전매칭: ${matchedCount}개, 미등록: ${unmatchedCount}개`);

  // 시술 + 가격 상세
  const treatments = (result.treatments || []) as Array<Record<string, unknown>>;
  console.log(`\n시술: ${treatments.length}개`);

  // 가격 분석
  const pricedAll = treatments.filter((t) =>
    (t.regular_price && (t.regular_price as number) > 0) ||
    (t.event_price && (t.event_price as number) > 0) ||
    (t.price && (t.price as number) > 0) ||
    (t.min_price && (t.min_price as number) > 0)
  );

  const nongeubyeoItems = treatments.filter(t => t.source === 'nongeubyeo');
  const eventItems = treatments.filter(t => t.price_type === 'event' || (t.event_price && (t.event_price as number) > 0));
  const withQuantity = treatments.filter(t => t.quantity && (t.quantity as number) > 0);
  const withRegularAndEvent = treatments.filter(t =>
    (t.regular_price && (t.regular_price as number) > 0) && (t.event_price && (t.event_price as number) > 0)
  );

  console.log(`\n가격 분석:`);
  console.log(`  총 가격 있는 시술: ${pricedAll.length}개`);
  console.log(`  source=nongeubyeo: ${nongeubyeoItems.length}개`);
  console.log(`  이벤트가 포함: ${eventItems.length}개`);
  console.log(`  정가+이벤트가 쌍: ${withRegularAndEvent.length}개`);
  console.log(`  수량+단위 파싱: ${withQuantity.length}개`);

  // 가격 상세 출력 (상위 30개)
  console.log(`\n가격 상세 (상위 30개):`);
  for (const t of pricedAll.slice(0, 30)) {
    const name = (t.name || t.treatment_name || '') as string;
    const rp = t.regular_price as number | null;
    const ep = t.event_price as number | null;
    const mn = t.min_price as number | null;
    const mx = t.max_price as number | null;
    const qty = t.quantity as number | null;
    const unit = t.unit as string | null;
    const src = t.source as string | null;
    const pt = t.price_type as string | null;

    let priceStr = '';
    if (rp) priceStr += `정가:${rp.toLocaleString()}`;
    if (ep) priceStr += `${priceStr ? ' → ' : ''}이벤트:${ep.toLocaleString()}`;
    if (mn && mx) priceStr += `${priceStr ? ' ' : ''}범위:${mn.toLocaleString()}~${mx.toLocaleString()}`;
    if (!priceStr && t.price) priceStr = `${(t.price as number).toLocaleString()}`;
    if (qty && unit) priceStr += ` (${qty}${unit})`;

    console.log(`  - ${name}: ${priceStr} [${pt || '-'}/${src || '-'}]`);
  }
  if (pricedAll.length > 30) console.log(`  ... +${pricedAll.length - 30}개`);

  // 의사
  const doctors = (result.doctors || []) as Array<Record<string, unknown>>;
  console.log(`\n의사: ${doctors.length}명`);
  for (const d of doctors) console.log(`  - ${d.name} ${d.title || ''}`);

  // 미등록 장비
  const unregEq = (result.unregistered_equipment || []) as Array<Record<string, unknown>>;
  console.log(`\nunregistered_equipment: ${unregEq.length}개`);
  for (const u of unregEq) {
    const name = typeof u === 'string' ? u : (u.name || JSON.stringify(u));
    const src = typeof u === 'object' ? u.source : '';
    console.log(`  - ${name} [source: ${src || '-'}]`);
  }

  // 미등록 시술
  const unregTr = (result.unregistered_treatments || []) as Array<Record<string, unknown>>;
  console.log(`\nunregistered_treatments: ${unregTr.length}개`);
  for (const u of unregTr.slice(0, 15)) {
    const name = typeof u === 'string' ? u : (u.name || JSON.stringify(u));
    console.log(`  - ${name}`);
  }

  // SNS
  const contact = (result.contact_info || {}) as Record<string, unknown>;
  console.log(`\nSNS 채널:`);
  console.log(`  instagram: ${contact.instagram || '(없음)'}`);
  console.log(`  youtube: ${contact.youtube || '(없음)'}`);
  console.log(`  blog: ${contact.blog || '(없음)'}`);
  console.log(`  kakao: ${contact.kakao_channel || '(없음)'}`);

  // FairTitanium subcategory 확인
  const fairTi = devices.find(d => ((d.name || '') as string).includes('FairTitanium') || ((d.name || '') as string).includes('페어티타늄'));
  if (fairTi) {
    console.log(`\nFairTitanium subcategory: ${fairTi.subcategory} (expected: RF)`);
  }

  // 6. v5.5 대비 비교표
  console.log('\n' + '═'.repeat(60));
  console.log('              v5.5 vs v5.6 비교');
  console.log('═'.repeat(60));

  const academicUnreg = unregEq.filter(u => typeof u === 'object' && u.source === 'academic_paper');

  console.log(`
| 항목 | v5.5 | v5.6 | 목표 | 달성 |
|------|------|------|------|------|
| priced_treatments | 7 | ${pricedAll.length} | 80+ | ${pricedAll.length >= 80 ? 'O' : 'X'} |
| source=nongeubyeo | 0 | ${nongeubyeoItems.length} | 1+ | ${nongeubyeoItems.length > 0 ? 'O' : 'X'} |
| min/max_price 파싱 | 0 | ${treatments.filter(t => t.min_price || t.max_price).length} | 1+ | ${treatments.some(t => t.min_price || t.max_price) ? 'O' : 'X'} |
| regular+event 쌍 | 0 | ${withRegularAndEvent.length} | 1+ | ${withRegularAndEvent.length > 0 ? 'O' : 'X'} |
| quantity/unit 파싱 | 0 | ${withQuantity.length} | 1+ | ${withQuantity.length > 0 ? 'O' : 'X'} |
| matched_devices | 11 | ${matchedCount} | 18+ | ${matchedCount >= 18 ? 'O' : 'X'} |
| unregistered_equipment | 0 | ${unregEq.length} | 5+ | ${unregEq.length >= 5 ? 'O' : 'X'} |
| unreg source=academic_paper | 0 | ${academicUnreg.length} | 1+ | ${academicUnreg.length > 0 ? 'O' : 'X'} |
| instagram | (없음) | ${contact.instagram || '(없음)'} | 있음 | ${contact.instagram ? 'O' : 'X'} |
| youtube | (없음) | ${contact.youtube || '(없음)'} | 있음 | ${contact.youtube ? 'O' : 'X'} |
| FairTitanium=RF | laser | ${fairTi?.subcategory || '?'} | RF | ${String(fairTi?.subcategory || '').includes('RF') ? 'O' : 'X'} |
`);

  // 7. 결과 저장
  const outDir = path.resolve(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.resolve(outDir, 'v56-test-banobagi.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`결과 저장: ${outPath}`);

  // v5.6 RAW DATA 저장
  const rawDataPath = path.resolve(outDir, `${HOSPITAL_NAME}_v5.6_RAW_DATA_${new Date().toISOString().slice(0, 10)}.json`);
  const rawData = {
    _meta: {
      hospital: HOSPITAL_NAME,
      version: 'v5.6',
      generated: new Date().toISOString(),
      source_pages: markdowns.length,
      source_chars: combined.length,
      nongeubyeo_chars: nongeubyeoSection?.length ?? 0,
      gemini_model: model,
      gemini_tokens_in: tokensIn,
      gemini_tokens_out: tokensOut,
      elapsed_sec: parseFloat(elapsed),
    },
    statistics: {
      total_devices: devices.length,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      total_treatments: treatments.length,
      priced_treatments: pricedAll.length,
      nongeubyeo_items: nongeubyeoItems.length,
      event_items: eventItems.length,
      regular_event_pairs: withRegularAndEvent.length,
      with_quantity: withQuantity.length,
      total_doctors: doctors.length,
      unregistered_equipment: unregEq.length,
      unregistered_treatments: unregTr.length,
    },
    matched_devices: devices.filter(() => true).map(d => {
      const name = (d.name || '') as string;
      const normalized = normMap.get(name.toLowerCase());
      return { name, normalized: normalized || null, matched: !!normalized };
    }),
    gemini_raw: result,
  };
  fs.writeFileSync(rawDataPath, JSON.stringify(rawData, null, 2), 'utf-8');
  console.log(`RAW DATA: ${rawDataPath}`);
}

main().catch(console.error);
