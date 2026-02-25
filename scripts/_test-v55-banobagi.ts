/**
 * v5.5 사전 주입 테스트: 바노바기피부과 기존 스냅샷으로 Gemini 분석
 * 기존 스냅샷의 마크다운을 읽어서 buildClassifyPrompt()로 분류
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { buildClassifyPrompt } from './v5/prompts.js';
import { getEquipmentNormalizationMap } from './crawler/dictionary-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

// SA JWT 인증 직접 구현 (API Key 유출 신고로 사용 불가)
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

const HOSPITAL_NAME = '바노바기피부과';
const SNAPSHOT_DIR = path.resolve(__dirname, '..', 'snapshots', '2026-02-22-v4', HOSPITAL_NAME);

async function main(): Promise<void> {
  console.log(`=== v5.5 사전 주입 테스트: ${HOSPITAL_NAME} ===\n`);

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

  const combined = markdowns.join('\n\n').slice(0, 150000); // 150K자 제한
  console.log(`마크다운: ${markdowns.length}페이지, ${combined.length.toLocaleString()}자\n`);

  // 2. v5.5 프롬프트 생성
  const prompt = buildClassifyPrompt(HOSPITAL_NAME);
  console.log(`프롬프트 길이: ${prompt.length.toLocaleString()}자 (~${Math.round(prompt.length / 3.5)} tokens)`);
  console.log(`사전 주입 확인: R1=${prompt.includes('R1-1')}, R2=${prompt.includes('R2-1')}, R3=${prompt.includes('R3-2')}, R6=${prompt.includes('R6-1')}`);
  console.log(`unregistered 필드: ${prompt.includes('unregistered_equipment')}\n`);

  // 3. Gemini 호출
  console.log('Gemini 호출 중...');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const token = await getSaToken();

  const fullPrompt = prompt + '\n\n## 웹사이트 텍스트\n' + combined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

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
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Gemini API error ${response.status}: ${errText.slice(0, 300)}`);
    return;
  }

  const json = await response.json() as any;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const tokensIn = json.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = json.usageMetadata?.candidatesTokenCount ?? 0;
  const finishReason = json.candidates?.[0]?.finishReason ?? 'unknown';

  console.log(`완료! ${elapsed}초, tokens: in=${tokensIn}, out=${tokensOut}, finish=${finishReason}\n`);

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error('Gemini 응답 없음');
    return;
  }

  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) result = JSON.parse(jsonMatch[0]);
    else { console.error('JSON 파싱 실패'); return; }
  }

  // 4. 결과 분석
  console.log('━'.repeat(60));
  console.log('              v5.5 분석 결과');
  console.log('━'.repeat(60));

  // 장비
  const devices = result.medical_devices || result.equipments || [];
  console.log(`\n장비/의료기기: ${devices.length}개`);
  const normMap = getEquipmentNormalizationMap();
  for (const d of devices) {
    const name = d.name || d.equipment_name || '';
    const normalized = normMap.get(name.toLowerCase()) || '(미등록)';
    const type = d.device_type || d.equipment_category || '';
    const sub = d.subcategory || '';
    console.log(`  - ${name} → ${normalized} [${type}${sub ? '/' + sub : ''}]`);
  }

  // 시술
  const treatments = result.treatments || [];
  console.log(`\n시술: ${treatments.length}개`);
  for (const t of treatments.slice(0, 20)) {
    const name = t.name || t.treatment_name || '';
    const price = t.price || t.price_display || '';
    console.log(`  - ${name}${price ? ' (' + price + ')' : ''}`);
  }
  if (treatments.length > 20) console.log(`  ... +${treatments.length - 20}개`);

  // 가격 (priceType 포함)
  const priced = treatments.filter((t: any) => t.price && t.price > 0);
  console.log(`\n가격 있는 시술: ${priced.length}개`);
  for (const t of priced.slice(0, 10)) {
    const name = t.name || t.treatment_name || '';
    console.log(`  - ${name}: ${t.price?.toLocaleString()}원${t.price_display ? ' (' + t.price_display + ')' : ''}`);
  }

  // 의사
  const doctors = result.doctors || [];
  console.log(`\n의사: ${doctors.length}명`);
  for (const d of doctors) {
    console.log(`  - ${d.name} ${d.title || ''} ${d.specialty || ''}`);
  }

  // 미등록 장비
  const unreg_eq = result.unregistered_equipment || [];
  console.log(`\nunregistered_equipment: ${unreg_eq.length}개`);
  for (const u of unreg_eq) {
    const name = typeof u === 'string' ? u : (u.name || JSON.stringify(u));
    console.log(`  - ${name}`);
  }

  // 미등록 시술
  const unreg_tr = result.unregistered_treatments || [];
  console.log(`\nunregistered_treatments: ${unreg_tr.length}개`);
  for (const u of unreg_tr.slice(0, 15)) {
    const name = typeof u === 'string' ? u : (u.name || JSON.stringify(u));
    console.log(`  - ${name}`);
  }
  if (unreg_tr.length > 15) console.log(`  ... +${unreg_tr.length - 15}개`);

  // raw_price_texts
  const rawPrices = result.raw_price_texts || [];
  console.log(`\nraw_price_texts: ${rawPrices.length}개`);
  for (const p of rawPrices.slice(0, 5)) {
    console.log(`  - ${typeof p === 'string' ? p : JSON.stringify(p)}`);
  }

  // 연락처
  const contact = result.contact_info || {};
  console.log(`\n연락처:`);
  if (contact.phone?.length) console.log(`  전화: ${contact.phone.map((p: any) => p.number || p).join(', ')}`);
  if (contact.email?.length) console.log(`  이메일: ${contact.email.map((e: any) => e.address || e).join(', ')}`);
  if (contact.kakao_channel) console.log(`  카카오: ${contact.kakao_channel}`);
  if (contact.instagram) console.log(`  인스타: ${contact.instagram}`);
  if (contact.youtube) console.log(`  유튜브: ${contact.youtube}`);
  if (contact.blog) console.log(`  블로그: ${contact.blog}`);

  // extraction_summary
  const summary = result.extraction_summary || {};
  console.log(`\nextraction_summary:`);
  console.log(JSON.stringify(summary, null, 2));

  // 결과 저장
  const outPath = path.resolve(__dirname, '..', 'output', 'v55-test-banobagi.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n결과 저장: ${outPath}`);
}

main().catch(console.error);
