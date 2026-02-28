/**
 * normalize-area.ts
 *
 * 1. juso.dev API로 시도 + 시군구 행정구역 데이터 수집
 * 2. Supabase area_codes 마스터 테이블에 upsert
 * 3. hospitals.address 파싱 → sido/sigungu 매칭 → UPDATE
 * 4. 결과 리포트 출력
 *
 * Usage: npx tsx scripts/normalize-area.ts
 *        npx tsx scripts/normalize-area.ts --skip-master  (area_codes 수집 건너뛰기)
 */

import { supabase } from './utils/supabase.js';

// ── juso.dev API ──

const REGCODE_API = 'https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes';

interface RegCode {
  code: string;
  name: string;
}

interface RegCodeResponse {
  regcodes: RegCode[];
}

async function fetchRegcodes(pattern: string): Promise<RegCode[]> {
  const url = `${REGCODE_API}?regcode_pattern=${encodeURIComponent(pattern)}&is_ignore_zero=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} for pattern ${pattern}`);
  const data = (await res.json()) as RegCodeResponse;
  return data.regcodes;
}

// ── Types ──

interface AreaCode {
  code: string;
  name: string;
  sido: string;
  sigungu: string | null;
  level: number; // 1=시도, 2=시군구
}

// ── Step 1: juso.dev API로 행정구역 데이터 수집 ──

async function buildAreaMaster(): Promise<AreaCode[]> {
  console.log('[Step 1] 시도 목록 조회...');
  let sidoList = await fetchRegcodes('*00000000');

  // is_ignore_zero=true면 빈 결과일 수 있으니 fallback
  if (sidoList.length === 0) {
    const url = `${REGCODE_API}?regcode_pattern=*00000000`;
    const res = await fetch(url);
    const data = (await res.json()) as RegCodeResponse;
    sidoList = data.regcodes;
  }
  console.log(`  -> ${sidoList.length}개 시도`);

  const areas: AreaCode[] = [];

  // 시도 추가
  for (const s of sidoList) {
    areas.push({
      code: s.code,
      name: s.name,
      sido: s.name,
      sigungu: null,
      level: 1,
    });
  }

  // 시군구 조회 (시도별)
  console.log('[Step 1] 시군구 목록 조회...');
  for (const s of sidoList) {
    const prefix = s.code.substring(0, 2);
    const sigunguList = await fetchRegcodes(`${prefix}*00000`);

    for (const sg of sigunguList) {
      // name이 "서울특별시 종로구" 형태 → 시도명 제거하여 시군구명 추출
      const sigunguName = sg.name.replace(s.name, '').trim();
      if (!sigunguName) continue; // 시도 자체가 나올 수 있음

      areas.push({
        code: sg.code,
        name: sg.name, // 풀네임: "서울특별시 강남구"
        sido: s.name,
        sigungu: sigunguName,
        level: 2,
      });
    }

    // rate limit 방지
    await new Promise(r => setTimeout(r, 100));
  }

  const sigunguCount = areas.filter(a => a.level === 2).length;
  console.log(`  -> 총 ${areas.length}개 (시도 ${sidoList.length} + 시군구 ${sigunguCount})`);
  return areas;
}

// ── Step 2: Supabase area_codes 테이블에 upsert ──

async function upsertAreaCodes(areas: AreaCode[]): Promise<void> {
  console.log('\n[Step 2] area_codes 테이블에 upsert...');

  // 기존 데이터 삭제 후 insert (upsert 대용 - 전량 교체)
  const { error: delErr } = await supabase.from('area_codes').delete().neq('code', '');
  if (delErr) {
    console.error('  삭제 실패:', delErr.message);
    throw new Error('area_codes 테이블 접근 오류. 마이그레이션 024를 확인하세요.');
  }

  // 500개씩 배치 insert
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < areas.length; i += BATCH) {
    const batch = areas.slice(i, i + BATCH);
    const { error } = await supabase.from('area_codes').insert(batch);
    if (error) throw new Error(`Insert error at batch ${i}: ${error.message}`);
    inserted += batch.length;
  }

  console.log(`  -> ${inserted}건 저장 완료`);
}

// ── Step 3: hospitals.address 파싱 + sido/sigungu 매칭 ──

const SIDO_ALIAS: Record<string, string> = {
  '서울': '서울특별시',
  '서울시': '서울특별시',
  '서울특별시': '서울특별시',
  '부산': '부산광역시',
  '부산시': '부산광역시',
  '부산광역시': '부산광역시',
  '대구': '대구광역시',
  '대구시': '대구광역시',
  '대구광역시': '대구광역시',
  '인천': '인천광역시',
  '인천시': '인천광역시',
  '인천광역시': '인천광역시',
  '광주': '광주광역시',
  '광주시': '광주광역시',
  '광주광역시': '광주광역시',
  '대전': '대전광역시',
  '대전시': '대전광역시',
  '대전광역시': '대전광역시',
  '울산': '울산광역시',
  '울산시': '울산광역시',
  '울산광역시': '울산광역시',
  '세종': '세종특별자치시',
  '세종시': '세종특별자치시',
  '세종특별자치시': '세종특별자치시',
  '경기': '경기도',
  '경기도': '경기도',
  '강원': '강원특별자치도',
  '강원도': '강원특별자치도',
  '강원특별자치도': '강원특별자치도',
  '충북': '충청북도',
  '충청북도': '충청북도',
  '충남': '충청남도',
  '충청남도': '충청남도',
  '전북': '전북특별자치도',
  '전라북도': '전북특별자치도',
  '전북특별자치도': '전북특별자치도',
  '전남': '전라남도',
  '전라남도': '전라남도',
  '경북': '경상북도',
  '경상북도': '경상북도',
  '경남': '경상남도',
  '경상남도': '경상남도',
  '제주': '제주특별자치도',
  '제주도': '제주특별자치도',
  '제주특별자치도': '제주특별자치도',
};

interface SigunguEntry {
  sido: string;
  sigungu: string;
}

function parseAddress(
  address: string,
  sigunguMap: Map<string, SigunguEntry[]>
): { sido: string; sigungu: string } | null {
  if (!address) return null;

  // 우편번호 제거 (5자리 숫자로 시작하는 경우)
  const cleaned = address.replace(/^\d{5}\s*/, '').trim();
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  // 첫 토큰으로 시도 추출
  const sidoCandidate = parts[0];
  const sido = SIDO_ALIAS[sidoCandidate];
  if (!sido) return null;

  const candidates = sigunguMap.get(sido);
  if (!candidates) return null;

  // 주소 나머지에서 시군구 매칭 (긴 것부터 → "수원시 권선구" > "수원시")
  const restAddr = parts.slice(1).join(' ');

  // 1) 2토큰 매칭 (예: "성남시 분당구", "수원시 권선구")
  for (const c of candidates) {
    if (c.sigungu.includes(' ') && restAddr.startsWith(c.sigungu)) {
      return { sido, sigungu: c.sigungu };
    }
  }

  // 2) 1토큰 매칭 (예: "강남구")
  const secondToken = parts[1];
  for (const c of candidates) {
    if (c.sigungu === secondToken) {
      return { sido, sigungu: c.sigungu };
    }
  }

  // 3) 복합 시군구 매칭: "경기도 고양시 일산서구 ..." → "고양시 일산서구"
  if (parts.length >= 3) {
    const twoTokens = `${parts[1]} ${parts[2]}`;
    for (const c of candidates) {
      if (c.sigungu === twoTokens) {
        return { sido, sigungu: c.sigungu };
      }
    }
  }

  return null;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      const wait = (i + 1) * 2000;
      console.log(`  retry ${i + 1}/${retries} (${wait}ms)...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

interface MatchReport {
  updated: number;
  skipped: number;
  unmatched: { id: string; name: string; address: string | null; sido: string | null; sigungu: string | null }[];
  changedSido: number;
  changedSigungu: number;
}

async function normalizeHospitals(areas: AreaCode[]): Promise<MatchReport> {
  console.log('\n[Step 3] hospitals 주소 정규화...');

  // 시군구 맵 구축 (시도별 시군구 목록, 긴 이름 우선)
  const sigunguMap = new Map<string, SigunguEntry[]>();
  for (const a of areas) {
    if (a.level !== 2 || !a.sigungu) continue;
    const list = sigunguMap.get(a.sido) ?? [];
    list.push({ sido: a.sido, sigungu: a.sigungu });
    sigunguMap.set(a.sido, list);
  }
  for (const [key, list] of sigunguMap) {
    list.sort((a, b) => b.sigungu.length - a.sigungu.length);
    sigunguMap.set(key, list);
  }

  // hospitals 전체 로드 → 파싱 → 배치 그룹화
  console.log('  -> hospitals 전체 조회...');
  const PAGE = 1000;
  let offset = 0;
  let totalSkipped = 0;
  let changedSido = 0;
  let changedSigungu = 0;
  const unmatched: MatchReport['unmatched'] = [];
  const updateGroups = new Map<string, string[]>();

  while (true) {
    const { data: hospitals, error } = await withRetry(() =>
      supabase.from('hospitals').select('id, name, address, sido, sigungu').range(offset, offset + PAGE - 1)
    );

    if (error) throw new Error(`Query error: ${error.message}`);
    if (!hospitals || hospitals.length === 0) break;

    for (const h of hospitals) {
      const result = parseAddress(h.address ?? '', sigunguMap);

      if (!result) {
        unmatched.push({ id: h.id, name: h.name, address: h.address, sido: h.sido, sigungu: h.sigungu });
        continue;
      }

      // 이미 동일하면 스킵
      if (h.sido === result.sido && h.sigungu === result.sigungu) {
        totalSkipped++;
        continue;
      }

      // 변경 추적
      if (h.sido !== result.sido) changedSido++;
      if (h.sigungu !== result.sigungu) changedSigungu++;

      const key = `${result.sido}|||${result.sigungu}`;
      const ids = updateGroups.get(key) ?? [];
      ids.push(h.id);
      updateGroups.set(key, ids);
    }

    offset += PAGE;
    if (hospitals.length < PAGE) break;
    process.stdout.write(`  -> ${offset}건 로드됨...\r`);
  }

  const totalToUpdate = [...updateGroups.values()].reduce((s, ids) => s + ids.length, 0);
  console.log(`  -> 파싱 완료: 업데이트 ${totalToUpdate}건, 스킵 ${totalSkipped}건, 매칭실패 ${unmatched.length}건`);
  console.log(`  -> ${updateGroups.size}개 시도/시군구 그룹으로 배치 업데이트...`);

  // 그룹별 배치 업데이트
  let totalUpdated = 0;
  let groupIdx = 0;
  for (const [key, ids] of updateGroups) {
    const [sido, sigungu] = key.split('|||');
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error: upErr } = await withRetry(() =>
        supabase.from('hospitals').update({ sido, sigungu }).in('id', chunk)
      );
      if (upErr) {
        console.error(`  배치 업데이트 실패 [${sido} ${sigungu}]: ${upErr.message}`);
      } else {
        totalUpdated += chunk.length;
      }
    }
    groupIdx++;
    if (groupIdx % 20 === 0) {
      process.stdout.write(`  -> ${groupIdx}/${updateGroups.size} 그룹 완료 (${totalUpdated}건)...\r`);
    }
  }

  return { updated: totalUpdated, skipped: totalSkipped, unmatched, changedSido, changedSigungu };
}

// ── Step 4: 결과 리포트 ──

function printReport(report: MatchReport): void {
  console.log('\n========================================');
  console.log('  결과 리포트');
  console.log('========================================');
  console.log(`  매칭 성공 (업데이트):  ${report.updated}건`);
  console.log(`  매칭 성공 (변경없음):  ${report.skipped}건`);
  console.log(`  매칭 실패:            ${report.unmatched.length}건`);
  console.log(`  변경된 sido:          ${report.changedSido}건`);
  console.log(`  변경된 sigungu:       ${report.changedSigungu}건`);
  console.log('========================================');

  if (report.unmatched.length > 0) {
    console.log('\n매칭 실패 목록:');
    console.log('-'.repeat(110));
    console.log(
      `${'병원명'.padEnd(30)}${'현재 sido'.padEnd(15)}${'현재 sigungu'.padEnd(18)}주소`
    );
    console.log('-'.repeat(110));

    for (const u of report.unmatched.slice(0, 100)) {
      const name = (u.name ?? '').substring(0, 28).padEnd(30);
      const sido = (u.sido ?? '-').substring(0, 13).padEnd(15);
      const sigungu = (u.sigungu ?? '-').substring(0, 16).padEnd(18);
      const addr = (u.address ?? '주소없음').substring(0, 47);
      console.log(`${name}${sido}${sigungu}${addr}`);
    }

    if (report.unmatched.length > 100) {
      console.log(`... 외 ${report.unmatched.length - 100}건`);
    }
  }
}

// ── Main ──

async function loadAreaCodesFromSupabase(): Promise<AreaCode[]> {
  const { data, error } = await supabase
    .from('area_codes')
    .select('code, name, sido, sigungu, level');
  if (error) throw new Error(`area_codes 조회 실패: ${error.message}`);
  return (data ?? []) as AreaCode[];
}

async function main(): Promise<void> {
  const skipMaster = process.argv.includes('--skip-master');

  console.log('hospitals sido/sigungu 정규화 시작\n');

  let areas: AreaCode[];

  if (skipMaster) {
    console.log('--skip-master: area_codes 테이블에서 마스터 로드');
    areas = await loadAreaCodesFromSupabase();
    console.log(`  -> ${areas.length}건 로드\n`);
  } else {
    // Step 1: 마스터 데이터 수집
    areas = await buildAreaMaster();

    // Step 2: Supabase 저장
    await upsertAreaCodes(areas);
  }

  // Step 3: hospitals 정규화
  const report = await normalizeHospitals(areas);

  // Step 4: 결과 리포트
  printReport(report);

  console.log('\n완료!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
