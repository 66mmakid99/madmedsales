/**
 * Ground Truth 반자동 검증 템플릿 생성기
 *
 * 1. Inspector 결과 + 크롤링 메타데이터 + 병원 URL을 조합
 * 2. 대/중/소 균형잡힌 20병원 자동 선정
 * 3. 검증자가 웹사이트 방문 후 O/X만 체크하면 되는 HTML 체크리스트 생성
 *
 * 실행: npx tsx scripts/inspector/generate-gt-template.ts
 * 출력: output/ground-truth-checklist.html + ground-truth-data.json (pre-filled)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { classifyHospitalType } from './classify-hospital';
import type { HospitalType } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface HospitalMeta {
  id: string;
  name: string;
  website: string;
  address: string;
  hospitalType: HospitalType;
  pagesCrawled: number;
  pageTypes: Record<string, number>;
  status: string;
  doctorsExtracted: number;
  doctorsInDb: number;
  equipmentPages: number;
  treatmentPages: number;
  ocrSuccessCount: number;
  crossValidationGrade: string;
  inspectorGrade: string | null;
  confidenceScore: number | null;
}

// ============================================================
// 데이터 수집
// ============================================================
async function collectHospitalMeta(): Promise<HospitalMeta[]> {
  const { data: validations, error } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id, status, issues, inspector_grade, confidence_score')
    .eq('crawl_version', 'madmedscv_v1')
    .order('validated_at', { ascending: false })
    .limit(300);

  if (error || !validations) {
    console.error('DB 조회 실패:', error?.message);
    return [];
  }

  const results: HospitalMeta[] = [];

  for (const v of validations) {
    const issues = (v.issues || {}) as Record<string, unknown>;
    const pagesCrawled = (issues.pages_crawled as number) || 0;
    if (pagesCrawled === 0) continue;

    const { data: h } = await supabase
      .from('hospitals')
      .select('name, website, address')
      .eq('id', v.hospital_id)
      .single();

    if (!h || !h.website) continue;

    const { count: docCount } = await supabase
      .from('hospital_doctors')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', v.hospital_id);

    // scv_crawl_pages에서 page_type별 실제 카운트
    const { data: scvPages } = await supabase
      .from('scv_crawl_pages')
      .select('page_type')
      .eq('hospital_id', v.hospital_id);

    const ptDist = (issues.page_type_distribution as Record<string, number>) || {};
    const equipmentPages = (scvPages || []).filter((p: { page_type: string }) => p.page_type === 'equipment').length
      || ptDist['equipment'] || 0;
    const treatmentPages = (scvPages || []).filter((p: { page_type: string }) => p.page_type === 'treatment').length
      || ptDist['treatment'] || 0;

    results.push({
      id: v.hospital_id,
      name: h.name || '',
      website: h.website || '',
      address: h.address || '',
      hospitalType: classifyHospitalType(pagesCrawled),
      pagesCrawled,
      pageTypes: ptDist,
      status: v.status || '',
      doctorsExtracted: (issues.doctors_extracted as number) || 0,
      doctorsInDb: docCount || 0,
      equipmentPages,
      treatmentPages,
      ocrSuccessCount: (issues.ocr_success_count as number) || 0,
      crossValidationGrade: (issues.cross_validation_grade as string) || '-',
      inspectorGrade: v.inspector_grade || null,
      confidenceScore: v.confidence_score || null,
    });
  }

  return results;
}

// ============================================================
// 20병원 균형 선정: 대형 7, 중형 7, 소형 6
// ============================================================
function selectSample(all: HospitalMeta[]): HospitalMeta[] {
  const quota: Record<HospitalType, number> = { large: 7, medium: 7, small: 6 };
  const selected: HospitalMeta[] = [];

  for (const type of ['large', 'medium', 'small'] as HospitalType[]) {
    const pool = all.filter(h => h.hospitalType === type);
    // status 다양성 확보: completed 우선 + warning 섞기
    const completed = pool.filter(h => h.status === 'completed');
    const warning = pool.filter(h => h.status !== 'completed');

    const target = quota[type];
    const fromCompleted = Math.min(Math.ceil(target * 0.7), completed.length);
    const fromWarning = Math.min(target - fromCompleted, warning.length);

    selected.push(...completed.slice(0, fromCompleted));
    selected.push(...warning.slice(0, fromWarning));

    // 부족하면 나머지에서 채우기
    const still = target - fromCompleted - fromWarning;
    if (still > 0) {
      const remaining = pool.filter(h => !selected.includes(h));
      selected.push(...remaining.slice(0, still));
    }
  }

  return selected.slice(0, 20);
}

// ============================================================
// HTML 체크리스트 생성
// ============================================================
function generateHtml(hospitals: HospitalMeta[]): string {
  const cards = hospitals.map((h, i) => {
    const pageTypesStr = Object.entries(h.pageTypes)
      .map(([k, v]) => `<span class="tag">${k} ${v}</span>`)
      .join(' ');

    const typeBadge = h.hospitalType === 'large' ? 'badge-lg' :
      h.hospitalType === 'medium' ? 'badge-md' : 'badge-sm';

    return `
    <div class="card hospital-row" data-id="${h.id}" data-idx="${i}">
      <div class="card-header">
        <div class="card-title">
          <span class="card-num">${i + 1}</span>
          <strong>${h.name}</strong>
          <span class="badge ${typeBadge}">${h.hospitalType.toUpperCase()}</span>
          <span class="badge badge-pages">${h.pagesCrawled}p</span>
          <span class="badge badge-status-${h.status === 'completed' ? 'ok' : 'warn'}">${h.status}</span>
        </div>
        <a href="${h.website}" target="_blank" class="site-link">${h.website}</a>
      </div>
      <div class="card-body">
        <div class="col-crawled">
          <div class="col-label">SCV 추출값</div>
          <div class="row-pair">
            <span class="field-label">의사</span>
            <span class="crawled-val">${h.doctorsExtracted}명</span>
          </div>
          <div class="row-pair">
            <span class="field-label">장비</span>
            <span class="crawled-val">${h.equipmentPages}페이지</span>
          </div>
          <div class="row-pair">
            <span class="field-label">시술</span>
            <span class="crawled-val">${h.treatmentPages}페이지</span>
          </div>
          <div class="row-pair">
            <span class="field-label">OCR</span>
            <span class="crawled-val">${h.ocrSuccessCount}건</span>
          </div>
          <div class="page-tags">${pageTypesStr}</div>
        </div>
        <div class="col-arrow">vs</div>
        <div class="col-actual">
          <div class="col-label">실제 (직접 확인)</div>
          <div class="input-row">
            <label>의사 수</label>
            <input type="number" class="check num-input" data-field="actual_doctors" min="0" value="${h.doctorsExtracted}" placeholder="0">
          </div>
          <div class="input-row">
            <label>장비 수</label>
            <input type="number" class="check num-input" data-field="actual_equipments" min="0" value="${h.equipmentPages}" placeholder="0">
          </div>
          <div class="input-row">
            <label>시술 수</label>
            <input type="number" class="check num-input" data-field="actual_treatments" min="0" value="${h.treatmentPages}" placeholder="0">
          </div>
          <div class="input-row">
            <label>가격 공개 수</label>
            <input type="number" class="check num-input" data-field="actual_prices" min="0" value="0" placeholder="0">
          </div>
        </div>
        <div class="col-verdict">
          <div class="col-label">판정</div>
          <div class="verdict-group">
            <label class="quality-label">종합 품질</label>
            <div class="quality-radios">
              <label class="radio-pill pill-s"><input type="radio" class="check" name="quality_${i}" data-field="site_quality" value="good"> S 풍부</label>
              <label class="radio-pill pill-a"><input type="radio" class="check" name="quality_${i}" data-field="site_quality" value="partial"> A 부분</label>
              <label class="radio-pill pill-f"><input type="radio" class="check" name="quality_${i}" data-field="site_quality" value="bad"> F 빈약</label>
              <label class="radio-pill pill-x"><input type="radio" class="check" name="quality_${i}" data-field="site_quality" value="no_data"> X 불량</label>
            </div>
          </div>
          <div class="input-row">
            <label>메모</label>
            <input type="text" class="check" data-field="notes" placeholder="특이사항">
          </div>
        </div>
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Ground Truth Checklist — MADMEDSALES Inspector v2</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Pretendard', sans-serif; padding: 20px 40px; background: #f0f2f5; color: #1a1a2e; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .desc { color: #666; margin-bottom: 16px; font-size: 14px; }

  /* 상단 통계 */
  .top-bar { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-box { background: white; padding: 10px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
  .stat-box .num { font-size: 28px; font-weight: 800; }
  .stat-box .label { font-size: 11px; color: #888; }
  .stat-box.done .num { color: #34a853; }
  .stat-box.remain .num { color: #ea4335; }

  /* 버튼 */
  .toolbar { display: flex; gap: 10px; margin-bottom: 24px; }
  .toolbar button { padding: 10px 28px; font-size: 14px; font-weight: 700; border: none; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
  .btn-export { background: #1a73e8; color: white; }
  .btn-export:hover { background: #1557b0; }
  .btn-open { background: #34a853; color: white; }
  .btn-open:hover { background: #2d8f47; }
  .btn-save { background: #ff6d01; color: white; }
  .btn-save:hover { background: #e06000; }

  /* 카드 */
  .card { background: white; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 16px; overflow: hidden; transition: box-shadow 0.15s; }
  .card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.12); }
  .card.completed { border-left: 4px solid #34a853; }
  .card-header { padding: 12px 20px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .card-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .card-num { background: #1a1a2e; color: white; width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; flex-shrink: 0; }
  .card-title strong { font-size: 15px; }
  .site-link { font-size: 12px; color: #1a73e8; word-break: break-all; }

  /* 뱃지 */
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-lg { background: #fce4ec; color: #c62828; }
  .badge-md { background: #fff3e0; color: #e65100; }
  .badge-sm { background: #e8f5e9; color: #2e7d32; }
  .badge-pages { background: #e3f2fd; color: #1565c0; }
  .badge-status-ok { background: #e8f5e9; color: #2e7d32; }
  .badge-status-warn { background: #fff8e1; color: #f57f17; }

  /* 카드 본문 3열 */
  .card-body { display: grid; grid-template-columns: 200px 30px 240px 1fr; gap: 0; padding: 16px 20px; align-items: start; }
  .col-crawled, .col-actual, .col-verdict { padding: 0 8px; }
  .col-arrow { display: flex; align-items: center; justify-content: center; font-size: 14px; color: #bbb; font-weight: 700; padding-top: 24px; }
  .col-label { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid #eee; }

  .row-pair { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .field-label { color: #666; }
  .crawled-val { font-weight: 600; font-variant-numeric: tabular-nums; }

  .page-tags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 10px; color: #555; }

  /* 입력 필드 */
  .input-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .input-row label { font-size: 12px; color: #555; min-width: 72px; flex-shrink: 0; }
  .num-input { width: 72px; padding: 6px 8px; font-size: 14px; font-weight: 600; border: 2px solid #ddd; border-radius: 6px; text-align: center; font-variant-numeric: tabular-nums; transition: border-color 0.15s; }
  .num-input:focus { border-color: #1a73e8; outline: none; }
  .num-input:not(:placeholder-shown) { border-color: #34a853; background: #f6fff6; }
  .col-verdict input[type="text"] { flex: 1; padding: 6px 8px; font-size: 13px; border: 2px solid #ddd; border-radius: 6px; }
  .col-verdict input[type="text"]:focus { border-color: #1a73e8; outline: none; }

  /* 라디오 pill */
  .quality-label { font-size: 12px; color: #555; display: block; margin-bottom: 6px; }
  .quality-radios { display: flex; gap: 4px; flex-wrap: wrap; }
  .radio-pill { padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 2px solid #ddd; transition: all 0.15s; user-select: none; }
  .radio-pill input { display: none; }
  .radio-pill:hover { border-color: #aaa; }
  .pill-s:has(input:checked) { background: #e8f5e9; border-color: #4caf50; color: #2e7d32; }
  .pill-a:has(input:checked) { background: #fff3e0; border-color: #ff9800; color: #e65100; }
  .pill-f:has(input:checked) { background: #fce4ec; border-color: #f44336; color: #c62828; }
  .pill-x:has(input:checked) { background: #f3e5f5; border-color: #9c27b0; color: #6a1b9a; }
  .verdict-group { margin-bottom: 12px; }

  @media (max-width: 900px) {
    .card-body { grid-template-columns: 1fr; }
    .col-arrow { display: none; }
  }
</style>
</head>
<body>
<h1>Ground Truth Checklist</h1>
<p class="desc">각 병원 URL을 열어 실제 장비/의사/시술 수를 세고 입력하세요. 종합 품질을 선택한 뒤 [JSON 내보내기].</p>

<div class="top-bar">
  <div class="stat-box"><div class="num">${hospitals.length}</div><div class="label">총 병원</div></div>
  <div class="stat-box done"><div class="num" id="done">0</div><div class="label">완료</div></div>
  <div class="stat-box remain"><div class="num" id="remaining">${hospitals.length}</div><div class="label">남음</div></div>
</div>

<div class="toolbar">
  <button class="btn-open" onclick="openAllSites()">전체 사이트 열기</button>
  <button class="btn-export" onclick="exportJson()">JSON 내보내기</button>
  <button class="btn-save" onclick="saveLocal()">임시 저장 (로컬)</button>
</div>

${cards}

<div class="toolbar" style="margin-top: 24px;">
  <button class="btn-export" onclick="exportJson()">JSON 내보내기</button>
  <button class="btn-save" onclick="saveLocal()">임시 저장 (로컬)</button>
</div>

<script>
const hospitals = ${JSON.stringify(hospitals.map(h => ({
  id: h.id, name: h.name, hospitalType: h.hospitalType,
  pagesCrawled: h.pagesCrawled, doctorsExtracted: h.doctorsExtracted,
  equipmentPages: h.equipmentPages, treatmentPages: h.treatmentPages,
  ocrSuccessCount: h.ocrSuccessCount,
})))};

function updateProgress() {
  const cards = document.querySelectorAll('.hospital-row');
  let done = 0;
  cards.forEach(card => {
    const radio = card.querySelector('input[data-field="site_quality"]:checked');
    if (radio) { done++; card.classList.add('completed'); }
    else { card.classList.remove('completed'); }
  });
  document.getElementById('done').textContent = done;
  document.getElementById('remaining').textContent = cards.length - done;
}
document.querySelectorAll('.check').forEach(el => el.addEventListener('change', updateProgress));
document.querySelectorAll('.check').forEach(el => el.addEventListener('input', updateProgress));

function openAllSites() {
  if (!confirm(hospitals.length + '개 탭을 열겠습니까?')) return;
  ${hospitals.map(h => `window.open('${h.website}', '_blank');`).join('\n  ')}
}

function gatherData() {
  const result = [];
  document.querySelectorAll('.hospital-row').forEach((card, i) => {
    const h = hospitals[i];
    const radio = card.querySelector('input[data-field="site_quality"]:checked');
    const qualityMap = { good: 'good', partial: 'partial', bad: 'bad', no_data: 'no_data' };

    const actualDoctors = parseInt(card.querySelector('[data-field="actual_doctors"]').value) || h.doctorsExtracted || 0;
    const actualEquipments = parseInt(card.querySelector('[data-field="actual_equipments"]').value) || h.equipmentPages || 0;
    const actualTreatments = parseInt(card.querySelector('[data-field="actual_treatments"]').value) || h.treatmentPages || 0;
    const actualPrices = parseInt(card.querySelector('[data-field="actual_prices"]').value) || 0;
    const quality = radio ? radio.value : '';
    const notes = card.querySelector('[data-field="notes"]').value;

    result.push({
      hospital_id: h.id,
      hospital_name: h.name,
      hospital_type_actual: h.hospitalType,
      actual_doctor_count: actualDoctors,
      actual_equipment_count: actualEquipments,
      actual_treatment_count: actualTreatments,
      actual_price_count: actualPrices,
      has_price_info: actualPrices > 0,
      actual_quality: qualityMap[quality] || 'partial',
      scv_extracted: {
        doctors: h.doctorsExtracted,
        ocr_success: h.ocrSuccessCount,
      },
      notes,
    });
  });
  return result;
}

function exportJson() {
  const result = gatherData();
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ground-truth-data.json';
  a.click();
  URL.revokeObjectURL(url);
  alert('ground-truth-data.json 다운로드 완료!');
}

function saveLocal() {
  const result = gatherData();
  localStorage.setItem('gt_checklist', JSON.stringify(result));
  alert('로컬 임시 저장 완료! (브라우저 닫아도 유지)');
}

// 페이지 로드 시 로컬 복원
(function restoreLocal() {
  const saved = localStorage.getItem('gt_checklist');
  if (!saved) return;
  try {
    const data = JSON.parse(saved);
    document.querySelectorAll('.hospital-row').forEach((card, i) => {
      const d = data[i];
      if (!d) return;
      if (d.actual_doctor_count !== undefined) card.querySelector('[data-field="actual_doctors"]').value = d.actual_doctor_count;
      if (d.actual_equipment_count !== undefined) card.querySelector('[data-field="actual_equipments"]').value = d.actual_equipment_count;
      if (d.actual_treatment_count !== undefined) card.querySelector('[data-field="actual_treatments"]').value = d.actual_treatment_count;
      if (d.actual_price_count !== undefined) card.querySelector('[data-field="actual_prices"]').value = d.actual_price_count;
      if (d.notes) card.querySelector('[data-field="notes"]').value = d.notes;
      if (d.actual_quality && d.actual_quality !== 'partial') {
        const radio = card.querySelector('input[data-field="site_quality"][value="' + d.actual_quality + '"]');
        if (radio) radio.checked = true;
      }
    });
    updateProgress();
  } catch(e) {}
})();
</script>
</body>
</html>`;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  console.log('Ground Truth 템플릿 생성 중...');

  const all = await collectHospitalMeta();
  console.log(`전체 병원: ${all.length}개`);
  console.log(`  large: ${all.filter(h => h.hospitalType === 'large').length}`);
  console.log(`  medium: ${all.filter(h => h.hospitalType === 'medium').length}`);
  console.log(`  small: ${all.filter(h => h.hospitalType === 'small').length}`);

  const sample = selectSample(all);
  console.log(`\n선정된 ${sample.length}개 병원:`);
  for (const h of sample) {
    console.log(`  [${h.hospitalType}] ${h.name} — ${h.pagesCrawled}p, ${h.status}`);
  }

  // HTML 체크리스트
  const html = generateHtml(sample);
  const outDir = path.resolve(__dirname, '..', '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const htmlPath = path.resolve(outDir, 'ground-truth-checklist.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`\nHTML 체크리스트: ${htmlPath}`);

  // pre-filled JSON (검증 전 초기값)
  const prefilled = sample.map(h => ({
    hospital_id: h.id,
    hospital_name: h.name,
    hospital_type_actual: h.hospitalType,
    actual_equipment_count: 0,
    actual_treatment_count: 0,
    actual_doctor_count: h.doctorsExtracted,
    has_price_info: false,
    actual_quality: 'partial' as const,
    notes: '',
  }));

  const jsonPath = path.resolve(__dirname, 'ground-truth-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(prefilled, null, 2));
  console.log(`JSON 템플릿: ${jsonPath}`);
  console.log('\n=== 다음 단계 ===');
  console.log('1. output/ground-truth-checklist.html 을 브라우저로 엽니다');
  console.log('2. 각 병원 URL 클릭 → 드롭다운 선택');
  console.log('3. [JSON 내보내기] → scripts/inspector/ground-truth-data.json 에 덮어쓰기');
  console.log('4. npx tsx scripts/inspector/ground-truth.ts 실행 → KPI 측정');
}

main().catch(console.error);
