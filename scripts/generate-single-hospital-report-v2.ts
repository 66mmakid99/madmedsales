/**
 * 단일 병원 의사 보고서 v2 — 세일즈 관점 통합 보고서
 *
 * v1→v2 개선:
 * 1. 연도 중복 버그 수정
 * 2. 지점간 의사 중복 제거 (이름 기준 병합)
 * 3. 세일즈용 학술활동 재분류 (KOL/미디어/업적/저술/학회)
 * 4. Executive Summary + 접근 전략 + 보유장비 분석
 * 5. 의사결정자/실사용자 구분
 * 6. 보강상태 명시 (보강시도/정보부족 vs 미보강)
 * 7. compact 레이아웃 (정보 적은 의사)
 *
 * 실행: npx tsx scripts/generate-single-hospital-report-v2.ts --hospital "닥터스피부과"
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ImageRun, VerticalAlign,
} from 'docx';
import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== Types =====
interface MergedDoctor {
  name: string; title: string; specialty: string | null;
  education: string[]; career: string[];
  photo_url: string | null; enrichment_source: string | null;
  branches: string[]; academics: SalesAcademic[];
  role: 'decision_maker' | 'director' | 'specialist';
}
interface SalesAcademic {
  salesCategory: string; originalType: string;
  title: string; year: string | null; source: string;
}
interface DeviceInfo { name: string; device_type: string; subcategory: string | null; }

// ===== Constants =====
const FONT = '맑은 고딕';
const C_PRI = '1B3A5C'; const C_ACC = '2E75B6'; const C_GRY = '666666';
const C_LT = 'F2F6FA'; const C_WH = 'FFFFFF';
const C_RED = 'E74C3C'; const C_GRN = '27AE60'; const C_ORG = 'E67E22';
const BD = { style: BorderStyle.SINGLE, size: 1, color: 'D0D5DD' };
const BDS = { top: BD, bottom: BD, left: BD, right: BD };
const SALES_CAT: Record<string, string> = {
  '강연': 'KOL활동', '학회임원': '학회활동', '학회정회원': '학회활동',
  '편집위원': '학회활동', '교과서집필': '저술', '논문': '저술',
  '임상연구': '저술', '수상': '업적',
};
const CAT_ORDER = ['KOL활동', '저술', '업적', '미디어', '학회활동', '기타'];

// ===== Helpers =====
const photoCache = new Map<string, Buffer>();

async function dlPhoto(url: string): Promise<Buffer | null> {
  if (photoCache.has(url)) return photoCache.get(url)!;
  try {
    const r = await fetch(url); if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length < 500) return null;
    photoCache.set(url, b); return b;
  } catch { return null; }
}
function toArr(v: string | string[] | null): string[] {
  if (!v) return []; if (Array.isArray(v)) return v.filter(Boolean);
  return v.split('\n').map(s => s.trim()).filter(Boolean);
}
function norm(s: string): string { return s.replace(/[\s()（）[\]【】·•‧,，.。_\-]/g, '').toLowerCase(); }
function pct(a: number, b: number): string { return b > 0 ? `${Math.round(a / b * 100)}%` : '0%'; }
function fmtAcad(title: string, year: string | null): string {
  if (!year) return title;
  if (title.includes(`(${year})`)) return title;
  return `${title} (${year})`;
}
function salesCat(type: string, title: string): string {
  if (SALES_CAT[type]) return SALES_CAT[type];
  if (/인터뷰|미디어|잡지|방송|유튜브|youtube|TV/i.test(title)) return '미디어';
  if (/실적|마스터|인증|건수|시술량/i.test(title)) return '업적';
  if (/강연|세미나|심포지엄|컨퍼런스|summit|congress|workshop|apac|open\s*doctors/i.test(title)) return 'KOL활동';
  return '기타';
}
function classRole(t: string): MergedDoctor['role'] {
  if (/대표원장|대표이사|병원장/.test(t)) return 'decision_maker';
  if (/원장|부원장|과장/.test(t)) return 'director';
  return 'specialist';
}
function enrichStat(d: MergedDoctor): string {
  const has = d.education.length > 0 || d.career.length > 0 || d.academics.length > 0;
  if (has) return '';
  return d.enrichment_source ? '보강시도/정보부족' : '미보강';
}
function gap(n = 80): Paragraph { return new Paragraph({ spacing: { after: n }, children: [] }); }
function t(text: string, o: { s?: number; b?: boolean; c?: string; i?: boolean } = {}): TextRun {
  return new TextRun({ text, font: FONT, size: o.s || 18, bold: o.b, color: o.c, italics: o.i });
}
function p(ch: TextRun[], o: { a?: typeof AlignmentType.CENTER; sp?: { before?: number; after?: number }; ind?: number } = {}): Paragraph {
  return new Paragraph({ alignment: o.a, spacing: o.sp || { before: 0, after: 40 }, indent: o.ind ? { left: o.ind } : undefined, children: ch });
}
function hCell(text: string, w?: number): TableCell {
  return new TableCell({
    width: w ? { size: w, type: WidthType.DXA } : undefined,
    shading: { fill: C_PRI }, borders: BDS,
    children: [p([t(text, { s: 16, b: true, c: C_WH })], { a: AlignmentType.CENTER, sp: { before: 50, after: 50 } })],
  });
}
function kvRow(k: string, v: string): TableRow {
  return new TableRow({ children: [
    new TableCell({ width: { size: 2400, type: WidthType.DXA }, shading: { fill: C_LT }, borders: BDS,
      children: [p([t(k, { s: 18, b: true, c: C_PRI })], { ind: 100, sp: { before: 50, after: 50 } })] }),
    new TableCell({ borders: BDS,
      children: [p([t(v, { s: 18 })], { ind: 100, sp: { before: 50, after: 50 } })] }),
  ]});
}
function fieldRow(label: string, items: string[]): TableRow {
  return new TableRow({ children: [
    new TableCell({ width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LT }, borders: BDS,
      children: [p([t(label, { s: 18, b: true, c: C_PRI })], { ind: 100, sp: { before: 50, after: 50 } })] }),
    new TableCell({ borders: BDS,
      children: items.map(e => p([t(`• ${e}`, { s: 16 })], { ind: 100, sp: { before: 20, after: 20 } })) }),
  ]});
}

// ===== Data Loading =====
async function loadData(filter: string): Promise<{
  hospitals: Map<string, { id: string; name: string; website: string; sido: string; sigungu: string }>;
  doctors: Map<string, any[]>; academics: Map<string, any[]>; devices: DeviceInfo[];
} | null> {
  const { data: hosps } = await supabase.from('hospitals')
    .select('id, name, website, sido, sigungu').ilike('name', `%${filter}%`);
  if (!hosps?.length) return null;

  const hMap = new Map<string, typeof hosps[0]>();
  const dMap = new Map<string, any[]>();
  const aMap = new Map<string, any[]>();
  const devs: DeviceInfo[] = [];

  for (const h of hosps) {
    const { data: docs } = await supabase.from('sales_hospital_doctors')
      .select('name, title, specialty, education, career, academic_activity, photo_url, enrichment_source')
      .eq('hospital_id', h.id);
    if (!docs?.length) continue;
    hMap.set(h.id, h); dMap.set(h.id, docs);

    const { data: ac } = await supabase.from('doctor_academic_activities')
      .select('doctor_name, activity_type, title, year, source').eq('hospital_id', h.id);
    aMap.set(h.id, ac || []);

    const { data: dv } = await supabase.from('sales_medical_devices')
      .select('name, device_type, subcategory').eq('hospital_id', h.id);
    if (dv) devs.push(...dv);
  }
  return { hospitals: hMap, doctors: dMap, academics: aMap, devices: devs };
}

// ===== Merge & Analyze =====
function mergeDoctors(hMap: Map<string, any>, dMap: Map<string, any[]>, aMap: Map<string, any[]>): MergedDoctor[] {
  const byName = new Map<string, MergedDoctor>();
  const seenAcad = new Map<string, Set<string>>();

  for (const [hid, docs] of dMap) {
    const hName = hMap.get(hid)?.name || hid;
    const acads = aMap.get(hid) || [];
    const acadByDoc = new Map<string, any[]>();
    for (const a of acads) { const arr = acadByDoc.get(a.doctor_name) || []; arr.push(a); acadByDoc.set(a.doctor_name, arr); }

    for (const d of docs) {
      const docAcads = (acadByDoc.get(d.name) || []).map((a: any): SalesAcademic => ({
        salesCategory: salesCat(a.activity_type, a.title),
        originalType: a.activity_type, title: a.title, year: a.year, source: a.source,
      }));

      const ex = byName.get(d.name);
      if (ex) {
        if (!ex.photo_url && d.photo_url) ex.photo_url = d.photo_url;
        if (!ex.specialty && d.specialty) ex.specialty = d.specialty;
        if (toArr(d.education).length > ex.education.length) ex.education = toArr(d.education);
        if (toArr(d.career).length > ex.career.length) ex.career = toArr(d.career);
        if (!ex.enrichment_source && d.enrichment_source) ex.enrichment_source = d.enrichment_source;
        if (!ex.branches.includes(hName)) ex.branches.push(hName);
        const keys = seenAcad.get(d.name)!;
        for (const a of docAcads) { const k = norm(a.title); if (!keys.has(k)) { keys.add(k); ex.academics.push(a); } }
      } else {
        const keys = new Set(docAcads.map(a => norm(a.title)));
        seenAcad.set(d.name, keys);
        byName.set(d.name, {
          name: d.name, title: d.title, specialty: d.specialty,
          education: toArr(d.education), career: toArr(d.career),
          photo_url: d.photo_url, enrichment_source: d.enrichment_source,
          branches: [hName], academics: docAcads, role: classRole(d.title),
        });
      }
    }
  }
  const order = { decision_maker: 0, director: 1, specialist: 2 };
  return [...byName.values()].sort((a, b) => order[a.role] - order[b.role] || b.academics.length - a.academics.length);
}

function dedupDevices(devs: DeviceInfo[]): DeviceInfo[] {
  const seen = new Set<string>();
  return devs.filter(d => { const k = norm(d.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

function analyzeEquip(devs: DeviceInfo[]): { rf: string[]; hifu: string[]; laser: string[]; injectable: string[] } {
  const r = { rf: [] as string[], hifu: [] as string[], laser: [] as string[], injectable: [] as string[] };
  for (const d of devs) {
    const sub = (d.subcategory || '').toLowerCase();
    if (sub.includes('rf') || /thermage|rf|라디오파|고주파/i.test(d.name)) r.rf.push(d.name);
    else if (sub.includes('hifu') || /ulthera|hifu|초음파/i.test(d.name)) r.hifu.push(d.name);
    else if (sub.includes('laser') || /레이저|ipl|bbl/i.test(d.name)) r.laser.push(d.name);
    else if (d.device_type === 'injectable' || /필러|보톡스|톡신|주사/i.test(d.name)) r.injectable.push(d.name);
  }
  return r;
}

// ===== DOCX: Cover =====
function buildCover(filter: string): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 2000 }, children: [] }),
    p([t('MADMEDSALES', { s: 36, b: true, c: C_ACC })], { a: AlignmentType.CENTER }),
    gap(200),
    p([t(`${filter} 의사 정보 보고서`, { s: 44, b: true, c: C_PRI })], { a: AlignmentType.CENTER }),
    p([t('v2.0 — 세일즈 관점 통합 보고서', { s: 22, c: C_GRY })], { a: AlignmentType.CENTER }),
    gap(300),
    p([t(new Date().toISOString().split('T')[0], { s: 24, c: C_GRY })], { a: AlignmentType.CENTER }),
  ];
}

// ===== DOCX: Executive Summary =====
function buildSummary(
  filter: string, docs: MergedDoctor[], branchCnt: number,
  eq: ReturnType<typeof analyzeEquip>,
): (Paragraph | Table)[] {
  const c: (Paragraph | Table)[] = [];
  const photoCnt = docs.filter(d => d.photo_url).length;
  const acadCnt = docs.filter(d => d.academics.length > 0).length;
  const enriched = docs.filter(d => d.enrichment_source).length;

  // 병원 개요
  c.push(p([t('병원 개요', { s: 26, b: true, c: C_PRI })], { sp: { before: 200, after: 120 } }));
  c.push(new Table({ width: { size: 9500, type: WidthType.DXA }, rows: [
    kvRow('병원명', `${filter} (${branchCnt}개 지점/엔티티 통합)`),
    kvRow('의사 수', `${docs.length}명 (지점간 중복 제거)`),
    kvRow('사진 확보', `${photoCnt}명 (${pct(photoCnt, docs.length)})`),
    kvRow('학술활동 보유', `${acadCnt}명 (${pct(acadCnt, docs.length)})`),
    kvRow('데이터 보강', `보강완료 ${enriched}명 / 미보강 ${docs.length - enriched}명`),
  ]}));
  c.push(gap());

  // 보유 장비
  c.push(p([t('보유 장비 현황', { s: 26, b: true, c: C_PRI })], { sp: { before: 200, after: 120 } }));
  c.push(new Table({ width: { size: 9500, type: WidthType.DXA }, rows: [
    new TableRow({ children: [hCell('RF', 2375), hCell('HIFU', 2375), hCell('레이저', 2375), hCell('주사제', 2375)] }),
    new TableRow({ children: [
      new TableCell({ width: { size: 2375, type: WidthType.DXA }, borders: BDS, children: [p([t(eq.rf.join(', ') || '-', { s: 15 })], { ind: 60, sp: { before: 40, after: 40 } })] }),
      new TableCell({ width: { size: 2375, type: WidthType.DXA }, borders: BDS, children: [p([t(eq.hifu.join(', ') || '-', { s: 15 })], { ind: 60, sp: { before: 40, after: 40 } })] }),
      new TableCell({ width: { size: 2375, type: WidthType.DXA }, borders: BDS, children: [p([t(eq.laser.join(', ') || '-', { s: 15 })], { ind: 60, sp: { before: 40, after: 40 } })] }),
      new TableCell({ width: { size: 2375, type: WidthType.DXA }, borders: BDS, children: [p([t(eq.injectable.join(', ') || '-', { s: 15 })], { ind: 60, sp: { before: 40, after: 40 } })] }),
    ]}),
  ]}));
  if (eq.rf.length > 0) {
    c.push(p([
      t('→ ', { s: 18, b: true, c: C_GRN }),
      t(`RF 장비 운영 중 (${eq.rf.join(', ')}). TORR RF 업그레이드/보완 포지셔닝 유리`, { s: 18, c: C_GRN }),
    ], { sp: { before: 60, after: 60 } }));
  }
  c.push(gap());

  // 접근 전략
  c.push(p([t('접근 전략', { s: 26, b: true, c: C_PRI })], { sp: { before: 200, after: 120 } }));
  const dms = docs.filter(d => d.role === 'decision_maker');
  const kols = docs.filter(d => d.academics.length >= 3);
  const rfDocs = docs.filter(d =>
    d.academics.some(a => /RF|교과서|textbook/i.test(a.title)) ||
    (d.specialty && /RF|레이저|리프팅|탄력/i.test(d.specialty))
  );

  let pri = 1;
  const mentioned = new Set<string>();
  for (const dm of dms) {
    if (mentioned.has(dm.name)) continue; mentioned.add(dm.name);
    const reasons = [`${dm.title} (의사결정자)`];
    if (dm.academics.length > 0) reasons.push(`학술활동 ${dm.academics.length}건`);
    const rfA = dm.academics.find(a => /RF|교과서|textbook/i.test(a.title));
    if (rfA) reasons.push(`RF 관련: ${rfA.title}`);
    c.push(p([t(`${pri}순위: `, { s: 20, b: true, c: C_ACC }), t(`${dm.name} `, { s: 20, b: true }), t(`— ${reasons.join(' | ')}`, { s: 17, c: C_GRY })], { sp: { before: 40, after: 20 } }));
    pri++;
  }
  for (const kol of kols) {
    if (mentioned.has(kol.name) || pri > 4) break; mentioned.add(kol.name);
    const cats = [...new Set(kol.academics.map(a => a.salesCategory))].join('/');
    c.push(p([t(`${pri}순위: `, { s: 20, b: true, c: C_ACC }), t(`${kol.name} `, { s: 20, b: true }),
      t(`— ${kol.title} | ${cats} ${kol.academics.length}건`, { s: 17, c: C_GRY })], { sp: { before: 40, after: 20 } }));
    pri++;
  }

  c.push(gap(60));
  c.push(p([t('추천 접근:', { s: 19, b: true, c: C_PRI })], { sp: { before: 40, after: 20 } }));
  const strats: string[] = [];
  if (eq.rf.length > 0) strats.push(`기존 RF 장비(${eq.rf.join(', ')}) 운영 경험 → TORR RF 기술적 우위/보완 포지셔닝`);
  if (rfDocs.length > 0) strats.push(`RF 전문성 보유 의사(${rfDocs.map(d => d.name).join(', ')}) → 학술 접근 우선`);
  if (dms.length > 0) strats.push(`의사결정자(${dms[0].name} ${dms[0].title}) → 직접 미팅 + 데모 시연`);
  if (!strats.length) strats.push('데모 시연 → 원내 테스트 → 도입 검토');
  for (const s of strats) c.push(p([t(`• ${s}`, { s: 17 })], { ind: 200, sp: { before: 15, after: 15 } }));
  return c;
}

// ===== DOCX: Key Doctor Profile (detailed) =====
async function buildKeyProfile(d: MergedDoctor): Promise<(Paragraph | Table)[]> {
  const rows: TableRow[] = [];

  // Name + Photo
  const namePs: Paragraph[] = [
    p([t(d.name, { s: 24, b: true }), t(`  ${d.title}`, { s: 19, c: C_GRY })], { ind: 100, sp: { before: 60, after: 30 } }),
  ];
  if (d.branches.length > 1) namePs.push(p([t(`소속: ${d.branches.join(', ')}`, { s: 16, c: C_ACC, i: true })], { ind: 100, sp: { before: 5, after: 15 } }));
  if (d.specialty) namePs.push(p([t('전문분야: ', { s: 17, c: C_GRY }), t(d.specialty, { s: 17 })], { ind: 100, sp: { before: 5, after: 15 } }));
  const roleLabel = d.role === 'decision_maker' ? '의사결정자' : d.role === 'director' ? '원장급' : '전문의';
  const roleColor = d.role === 'decision_maker' ? C_RED : d.role === 'director' ? C_ORG : C_GRY;
  namePs.push(p([t(`[${roleLabel}]`, { s: 16, b: true, c: roleColor })], { ind: 100, sp: { before: 5, after: 30 } }));

  let photoPs: Paragraph[];
  if (d.photo_url) {
    const buf = await dlPhoto(d.photo_url);
    photoPs = buf
      ? [p([new ImageRun({ data: buf, transformation: { width: 95, height: 115 }, type: 'png' })], { a: AlignmentType.CENTER, sp: { before: 40, after: 40 } })]
      : [p([t('사진 미확보', { s: 14, c: C_GRY })], { a: AlignmentType.CENTER, sp: { before: 50, after: 50 } })];
  } else {
    photoPs = [p([t('사진 미확보', { s: 14, c: C_GRY })], { a: AlignmentType.CENTER, sp: { before: 50, after: 50 } })];
  }
  rows.push(new TableRow({ children: [
    new TableCell({ width: { size: 1600, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER, children: photoPs }),
    new TableCell({ borders: BDS, verticalAlign: VerticalAlign.CENTER, children: namePs }),
  ]}));

  if (d.education.length > 0) rows.push(fieldRow('학력', d.education));
  if (d.career.length > 0) rows.push(fieldRow('경력', d.career));

  // Academic (sales categories)
  if (d.academics.length > 0) {
    const byCat = new Map<string, SalesAcademic[]>();
    for (const a of d.academics) { const arr = byCat.get(a.salesCategory) || []; arr.push(a); byCat.set(a.salesCategory, arr); }
    const acadPs: Paragraph[] = [];
    for (const cat of CAT_ORDER) {
      const items = byCat.get(cat); if (!items) continue;
      acadPs.push(p([t(`[${cat}]`, { s: 16, b: true, c: C_ACC }), t(` ${items.length}건`, { s: 14, c: C_GRY })], { ind: 100, sp: { before: 40, after: 15 } }));
      for (const it of items) {
        acadPs.push(p([t(`• ${fmtAcad(it.title, it.year)}`, { s: 16 })], { ind: 200, sp: { before: 8, after: 8 } }));
      }
    }
    rows.push(new TableRow({ children: [
      new TableCell({ width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LT }, borders: BDS,
        children: [p([t('학술활동', { s: 18, b: true, c: C_PRI })], { ind: 100, sp: { before: 50, after: 50 } })] }),
      new TableCell({ borders: BDS, children: acadPs }),
    ]}));
  }

  // Enrichment status
  const st = enrichStat(d);
  if (st) {
    rows.push(new TableRow({ children: [
      new TableCell({ width: { size: 1600, type: WidthType.DXA }, shading: { fill: C_LT }, borders: BDS,
        children: [p([t('보강상태', { s: 16, c: C_PRI })], { ind: 100, sp: { before: 40, after: 40 } })] }),
      new TableCell({ borders: BDS,
        children: [p([t(st, { s: 16, c: C_ORG, i: true })], { ind: 100, sp: { before: 40, after: 40 } })] }),
    ]}));
  }

  return [new Table({ width: { size: 9500, type: WidthType.DXA }, rows }), gap()];
}

// ===== DOCX: Compact Staff Directory =====
async function buildDirectory(docs: MergedDoctor[]): Promise<(Paragraph | Table)[]> {
  const c: (Paragraph | Table)[] = [];
  c.push(p([t('전체 의료진 디렉토리', { s: 26, b: true, c: C_PRI }), t(` (${docs.length}명)`, { s: 20, c: C_GRY })], { sp: { before: 200, after: 120 } }));

  const rows: TableRow[] = [new TableRow({ children: [
    hCell('', 700), hCell('이름 / 직함', 2600), hCell('전문분야', 2000),
    hCell('학술', 1000), hCell('소속', 1600), hCell('상태', 1600),
  ]})];

  for (const d of docs) {
    let photoPs: Paragraph[];
    if (d.photo_url) {
      const buf = await dlPhoto(d.photo_url);
      photoPs = buf
        ? [p([new ImageRun({ data: buf, transformation: { width: 38, height: 48 }, type: 'png' })], { a: AlignmentType.CENTER, sp: { before: 15, after: 15 } })]
        : [p([t('-', { s: 14, c: C_GRY })], { a: AlignmentType.CENTER, sp: { before: 15, after: 15 } })];
    } else {
      photoPs = [p([t('-', { s: 14, c: C_GRY })], { a: AlignmentType.CENTER, sp: { before: 15, after: 15 } })];
    }

    const roleL = d.role === 'decision_maker' ? '[의사결정자]' : d.role === 'director' ? '[원장급]' : '';
    const roleC = d.role === 'decision_maker' ? C_RED : C_ORG;
    const nameChildren: Paragraph[] = [p([t(d.name, { s: 16, b: true }), t(` ${d.title}`, { s: 13, c: C_GRY })], { ind: 60, sp: { before: 15, after: 5 } })];
    if (roleL) nameChildren.push(p([t(roleL, { s: 12, b: true, c: roleC })], { ind: 60, sp: { before: 0, after: 15 } }));
    else nameChildren.push(p([], { sp: { before: 0, after: 15 } }));

    const acadStr = d.academics.length > 0 ? `${d.academics.length}건` : '-';
    const acadC = d.academics.length > 0 ? C_GRN : C_GRY;
    const brStr = d.branches.length > 1 ? `${d.branches.length}개 지점` : (d.branches[0] || '-').replace(/닥터스피부과\s*/g, '').replace(/의원|신사/g, '').trim() || d.branches[0] || '-';
    const st = enrichStat(d);
    const stC = st === '미보강' ? C_ORG : st ? C_GRY : C_GRN;
    const stT = st || (d.photo_url ? '사진+데이터' : '기본데이터');

    rows.push(new TableRow({ children: [
      new TableCell({ width: { size: 700, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER, children: photoPs }),
      new TableCell({ width: { size: 2600, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER, children: nameChildren }),
      new TableCell({ width: { size: 2000, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER,
        children: [p([t(d.specialty || '-', { s: 14, c: d.specialty ? undefined : C_GRY })], { ind: 60, sp: { before: 15, after: 15 } })] }),
      new TableCell({ width: { size: 1000, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER,
        children: [p([t(acadStr, { s: 14, c: acadC })], { a: AlignmentType.CENTER, sp: { before: 15, after: 15 } })] }),
      new TableCell({ width: { size: 1600, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER,
        children: [p([t(brStr, { s: 12 })], { ind: 60, sp: { before: 15, after: 15 } })] }),
      new TableCell({ width: { size: 1600, type: WidthType.DXA }, borders: BDS, verticalAlign: VerticalAlign.CENTER,
        children: [p([t(stT, { s: 12, c: stC })], { a: AlignmentType.CENTER, sp: { before: 15, after: 15 } })] }),
    ]}));
  }
  c.push(new Table({ width: { size: 9500, type: WidthType.DXA }, rows }));
  return c;
}

// ===== Main =====
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--hospital');
  const filter = idx >= 0 ? args[idx + 1] : '닥터스피부과';
  console.log(`\n=== ${filter} 의사 보고서 v2 생성 ===\n`);

  const data = await loadData(filter);
  if (!data) { console.log(`병원 "${filter}" 없음`); return; }
  console.log(`  병원: ${data.hospitals.size}개 엔티티`);

  const docs = mergeDoctors(data.hospitals, data.doctors, data.academics);
  console.log(`  의사: ${docs.length}명 (중복 제거)`);

  const devs = dedupDevices(data.devices);
  const eq = analyzeEquip(devs);
  console.log(`  장비: RF ${eq.rf.length} | HIFU ${eq.hifu.length} | 레이저 ${eq.laser.length} | 주사제 ${eq.injectable.length}`);

  // Download photos
  const urls = docs.filter(d => d.photo_url).map(d => d.photo_url!);
  if (urls.length > 0) { console.log(`  사진 다운로드 (${urls.length}장)...`); await Promise.all(urls.map(u => dlPhoto(u))); }

  // Key doctors: decision makers + academics >= 3
  const keyDocs = docs.filter(d => d.role === 'decision_maker' || d.academics.length >= 3).slice(0, 8);
  console.log(`  핵심 의료진: ${keyDocs.length}명 | 일반: ${docs.length - keyDocs.length}명`);

  // Build sections
  const cover = buildCover(filter);
  const summary = buildSummary(filter, docs, data.hospitals.size, eq);

  const keyContent: (Paragraph | Table)[] = [
    p([t('핵심 의료진 프로필', { s: 26, b: true, c: C_PRI })], { sp: { before: 300, after: 120 } }),
  ];
  for (const d of keyDocs) keyContent.push(...(await buildKeyProfile(d)));

  const dirContent = await buildDirectory(docs);
  const photoCnt = docs.filter(d => d.photo_url).length;
  const acadCnt = docs.filter(d => d.academics.length > 0).length;
  const footer = [
    gap(200),
    p([t(`데이터 품질: 의사 ${docs.length}명 | 사진 ${photoCnt}명(${pct(photoCnt, docs.length)}) | 학술 ${acadCnt}명(${pct(acadCnt, docs.length)}) | 장비 ${devs.length}개`, { s: 16, c: C_GRY, i: true })], { a: AlignmentType.CENTER }),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 }, paragraph: { spacing: { line: 300 } } } } },
    sections: [
      { properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } }, children: cover },
      { properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: [...summary, gap(200), ...keyContent] },
      { properties: { page: { margin: { top: 1000, bottom: 1000, left: 800, right: 800 } } }, children: [...dirContent, ...footer] },
    ],
  });

  const safeName = filter.replace(/[/\\?%*:|"<>]/g, '_');
  const outPath = path.resolve(__dirname, `../docs/${safeName}_의사보고서_v2.docx`);
  fs.writeFileSync(outPath, await Packer.toBuffer(doc));
  console.log(`\n보고서 생성 완료: ${outPath}`);
}

main().catch(console.error);
