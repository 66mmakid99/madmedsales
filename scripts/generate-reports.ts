/**
 * TORR RF 납품 병원 데이터 보고서 생성 스크립트
 *
 * scripts/data/torr-rf-hospitals-full-export.json을 읽어
 * docs/report/ 폴더에 개별 병원 보고서 마크다운 파일을 생성합니다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Types ---

interface Equipment {
  name: string;
  category: string;
  manufacturer: string | null;
  source: string;
}

interface Treatment {
  name: string;
  category: string;
  price: number | null;
  is_promoted: boolean;
  source: string;
}

interface Doctor {
  name: string;
  title: string | null;
  specialty: string | null;
}

interface Hospital {
  crm_id: string;
  hospital_id: string | null;
  name: string;
  region: string;
  address: string;
  phone: string | null;
  website: string | null;
  crawled_at: string | null;
  equipments: Equipment[];
  treatments: Treatment[];
  doctors: Doctor[];
  data_status: 'rich' | 'partial' | 'empty' | 'no_crawl';
}

interface ExportData {
  stats: {
    total: number;
    rich: number;
    partial: number;
    empty: number;
    no_crawl: number;
    total_equipments: number;
    total_treatments: number;
    total_doctors: number;
    export_date: string;
  };
  hospitals: Hospital[];
}

// --- Constants ---

const CATEGORY_KO: Record<string, string> = {
  laser: '레이저',
  rf: 'RF/고주파',
  hifu: 'HIFU/초음파',
  body: '바디/체형',
  lifting: '리프팅',
  booster: '부스터',
  filler_botox: '필러/보톡스',
  skin: '피부관리',
  hair: '탈모/모발',
  other: '기타',
};

const STATUS_KO: Record<string, string> = {
  rich: '풍부',
  partial: '부분 수집',
  empty: '미수집 (크롤링 완료)',
  no_crawl: '미수집 (크롤링 미완료)',
};

const TORR_KEYWORDS = ['torr', '토르', 'rf', '고주파', 'TORR'];

// --- Helper Functions ---

function translateCategory(cat: string): string {
  return CATEGORY_KO[cat] ?? cat;
}

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '-';
  if (price >= 10000) {
    const man = Math.floor(price / 10000);
    const remainder = price % 10000;
    if (remainder === 0) {
      return `${man}만원`;
    }
    return `${man}만 ${remainder.toLocaleString()}원`;
  }
  return `${price.toLocaleString()}원`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function findTorrReferences(hospital: Hospital): string[] {
  const findings: string[] = [];

  for (const eq of hospital.equipments) {
    const combined = `${eq.name} ${eq.category} ${eq.manufacturer ?? ''}`.toLowerCase();
    for (const kw of TORR_KEYWORDS) {
      if (combined.includes(kw.toLowerCase())) {
        findings.push(`장비: **${eq.name}**${eq.manufacturer ? ` (${eq.manufacturer})` : ''} - 카테고리: ${translateCategory(eq.category)}`);
        break;
      }
    }
  }

  for (const tr of hospital.treatments) {
    const combined = `${tr.name} ${tr.category}`.toLowerCase();
    for (const kw of TORR_KEYWORDS) {
      if (combined.includes(kw.toLowerCase())) {
        findings.push(`시술: **${tr.name}** - 카테고리: ${translateCategory(tr.category)}${tr.price ? ` - 가격: ${formatPrice(tr.price)}` : ''}`);
        break;
      }
    }
  }

  return findings;
}

// --- Report Generation ---

function generateReport(hospital: Hospital): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${hospital.name} 데이터 수집 보고서`);
  lines.push('');
  lines.push('> TORR RF 납품 병원 데이터 수집 결과');
  lines.push('');

  // 기본 정보
  lines.push('## 기본 정보');
  lines.push('');
  lines.push('| 항목 | 내용 |');
  lines.push('|------|------|');
  lines.push(`| 병원명 | ${hospital.name} |`);
  lines.push(`| 지역 | ${hospital.region} |`);
  lines.push(`| 주소 | ${hospital.address} |`);
  lines.push(`| 연락처 | ${hospital.phone ?? '-'} |`);
  lines.push(`| 웹사이트 | ${hospital.website ?? '-'} |`);
  lines.push(`| 데이터 상태 | ${STATUS_KO[hospital.data_status]} |`);
  lines.push(`| 크롤링 일시 | ${formatDate(hospital.crawled_at)} |`);
  lines.push('');

  // 보유 장비
  lines.push(`## 보유 장비 (${hospital.equipments.length}개)`);
  lines.push('');
  if (hospital.equipments.length > 0) {
    lines.push('| 장비명 | 카테고리 | 제조사 |');
    lines.push('|--------|----------|--------|');
    for (const eq of hospital.equipments) {
      lines.push(`| ${eq.name} | ${translateCategory(eq.category)} | ${eq.manufacturer ?? '-'} |`);
    }
  } else {
    lines.push('수집된 장비 데이터가 없습니다.');
  }
  lines.push('');

  // 시술 메뉴
  lines.push(`## 시술 메뉴 (${hospital.treatments.length}개)`);
  lines.push('');
  if (hospital.treatments.length > 0) {
    lines.push('| 시술명 | 카테고리 | 가격 | 프로모션 |');
    lines.push('|--------|----------|------|----------|');
    for (const tr of hospital.treatments) {
      const promo = tr.is_promoted ? '⭐' : '';
      lines.push(`| ${tr.name} | ${translateCategory(tr.category)} | ${formatPrice(tr.price)} | ${promo} |`);
    }
  } else {
    lines.push('수집된 시술 데이터가 없습니다.');
  }
  lines.push('');

  // 의료진
  lines.push(`## 의료진 (${hospital.doctors.length}명)`);
  lines.push('');
  if (hospital.doctors.length > 0) {
    lines.push('| 이름 | 직함 | 전공 |');
    lines.push('|------|------|------|');
    for (const doc of hospital.doctors) {
      lines.push(`| ${doc.name} | ${doc.title ?? '-'} | ${doc.specialty ?? '-'} |`);
    }
  } else {
    lines.push('수집된 의료진 데이터가 없습니다.');
  }
  lines.push('');

  // TORR RF 관련 분석
  lines.push('## TORR RF 관련 분석');
  lines.push('');
  const torrFindings = findTorrReferences(hospital);
  if (torrFindings.length > 0) {
    lines.push('TORR RF 또는 고주파/RF 관련 항목이 발견되었습니다:');
    lines.push('');
    for (const finding of torrFindings) {
      lines.push(`- ${finding}`);
    }
  } else {
    lines.push('TORR RF 관련 직접 언급은 발견되지 않았습니다.');
  }
  lines.push('');

  // 영업 참고사항
  lines.push('## 영업 참고사항');
  lines.push('');
  lines.push('- 데이터 수집 출처: Firecrawl + Gemini Flash AI 분석');
  lines.push(`- 수집일: ${formatDateShort(hospital.crawled_at)}`);
  lines.push('- 장비/시술 데이터는 웹사이트 공개 정보 기반이며, 실제와 다를 수 있음');
  lines.push('');

  return lines.join('\n');
}

function generateIndex(data: ExportData): string {
  const lines: string[] = [];

  lines.push('# TORR RF 납품 병원 데이터 수집 보고서 INDEX');
  lines.push('');
  lines.push(`> 생성일: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> 데이터 내보내기일: ${formatDateShort(data.stats.export_date)}`);
  lines.push('');

  // 요약 통계
  lines.push('## 요약 통계');
  lines.push('');
  lines.push('| 항목 | 수량 |');
  lines.push('|------|------|');
  lines.push(`| 총 병원 수 | ${data.stats.total}개 |`);
  lines.push(`| 데이터 풍부 (rich) | ${data.stats.rich}개 |`);
  lines.push(`| 부분 수집 (partial) | ${data.stats.partial}개 |`);
  lines.push(`| 미수집 - 크롤링 완료 (empty) | ${data.stats.empty}개 |`);
  lines.push(`| 미수집 - 크롤링 미완료 (no_crawl) | ${data.stats.no_crawl}개 |`);
  lines.push(`| 총 장비 수 | ${data.stats.total_equipments}개 |`);
  lines.push(`| 총 시술 수 | ${data.stats.total_treatments}개 |`);
  lines.push(`| 총 의료진 수 | ${data.stats.total_doctors}명 |`);
  lines.push('');

  // 데이터 상태별 목록
  const statusOrder: Array<Hospital['data_status']> = ['rich', 'partial', 'empty', 'no_crawl'];
  const statusTitles: Record<string, string> = {
    rich: '데이터 풍부 (Rich)',
    partial: '부분 수집 (Partial)',
    empty: '미수집 - 크롤링 완료 (Empty)',
    no_crawl: '미수집 - 크롤링 미완료 (No Crawl)',
  };

  for (const status of statusOrder) {
    const hospitals = data.hospitals.filter(h => h.data_status === status);
    if (hospitals.length === 0) continue;

    lines.push(`## ${statusTitles[status]} (${hospitals.length}개)`);
    lines.push('');
    lines.push('| # | 병원명 | 지역 | 장비 | 시술 | 의료진 | 보고서 |');
    lines.push('|---|--------|------|------|------|--------|--------|');

    hospitals.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    for (let i = 0; i < hospitals.length; i++) {
      const h = hospitals[i];
      const fileName = `${h.name}.md`;
      lines.push(
        `| ${i + 1} | ${h.name} | ${h.region} | ${h.equipments.length} | ${h.treatments.length} | ${h.doctors.length} | [보고서](${fileName}) |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Main ---

function main(): void {
  const projectRoot = path.resolve(__dirname, '..');
  const inputPath = path.join(projectRoot, 'scripts', 'data', 'torr-rf-hospitals-full-export.json');
  const outputDir = path.join(projectRoot, 'docs', 'report');

  // 1. Read export data
  console.log(`입력 파일 읽는 중: ${inputPath}`);
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const data: ExportData = JSON.parse(raw);
  console.log(`총 ${data.hospitals.length}개 병원 데이터 로드 완료`);

  // 2. Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`출력 디렉토리 생성: ${outputDir}`);
  } else {
    console.log(`출력 디렉토리 존재: ${outputDir}`);
  }

  // 3. Generate individual reports
  let count = 0;
  for (const hospital of data.hospitals) {
    const fileName = `${hospital.name}.md`;
    const filePath = path.join(outputDir, fileName);
    const content = generateReport(hospital);
    fs.writeFileSync(filePath, content, 'utf-8');
    count++;
  }
  console.log(`개별 보고서 ${count}개 생성 완료`);

  // 4. Generate index
  const indexPath = path.join(outputDir, '00-INDEX.md');
  const indexContent = generateIndex(data);
  fs.writeFileSync(indexPath, indexContent, 'utf-8');
  console.log('인덱스 파일 생성: 00-INDEX.md');

  // 5. Summary
  const totalFiles = count + 1; // reports + index
  console.log('');
  console.log('=== 보고서 생성 완료 ===');
  console.log(`총 생성 파일: ${totalFiles}개 (보고서 ${count}개 + 인덱스 1개)`);
  console.log(`출력 경로: ${outputDir}`);

  // Status breakdown
  const statusCounts: Record<string, number> = {};
  for (const h of data.hospitals) {
    statusCounts[h.data_status] = (statusCounts[h.data_status] ?? 0) + 1;
  }
  console.log('');
  console.log('데이터 상태별:');
  console.log(`  풍부 (rich): ${statusCounts['rich'] ?? 0}개`);
  console.log(`  부분 수집 (partial): ${statusCounts['partial'] ?? 0}개`);
  console.log(`  미수집/크롤링 완료 (empty): ${statusCounts['empty'] ?? 0}개`);
  console.log(`  미수집/크롤링 미완료 (no_crawl): ${statusCounts['no_crawl'] ?? 0}개`);
}

main();
