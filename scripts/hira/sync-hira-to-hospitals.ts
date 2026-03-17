/**
 * Step 1-B: 심평원 데이터 → hospitals 테이블 매핑
 *
 * 1) scripts/data/hira-raw/*.json (crawl-hira.ts 산출물) 읽기
 * 2) hospitals 테이블의 name + address로 매칭
 * 3) hira_specialist_count, hira_opened_at, hira_department, hira_bed_count 업데이트
 * 4) 매칭 실패 건은 로그 + unmatched.json 출력
 *
 * 실행: npx tsx scripts/hira/sync-hira-to-hospitals.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('sync-hira');

const DATA_DIR = path.resolve(__dirname, '../data/hira-raw');

interface HiraRawItem {
  ykiho: string;
  yadmNm: string;
  clCd: string;
  clCdNm: string;
  dgsbjtCd: string;
  dgsbjtCdNm: string;
  sidoCd: string;
  sidoCdNm: string;
  sgguCd: string;
  sgguCdNm: string;
  emdongNm: string;
  addr: string;
  telno: string;
  estbDd: string;
  drTotCnt: number;
  cmdcResdntCnt: number;
  XPos: string;
  YPos: string;
}

interface MatchResult {
  matched: number;
  unmatched: number;
  updated: number;
  errors: number;
}

function normalizeHospitalName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[㈜(주)]/g, '')
    .replace(/의원|병원|클리닉|의료원|센터/g, '')
    .toLowerCase()
    .trim();
}

function parseEstbDate(estbDd: string | number): string | null {
  const s = String(estbDd ?? '');
  if (s.length < 8) return null;
  const y = s.slice(0, 4);
  const m = s.slice(4, 6);
  const d = s.slice(6, 8);
  return `${y}-${m}-${d}`;
}

async function loadHiraData(): Promise<HiraRawItem[]> {
  const files = await fs.readdir(DATA_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error(
      `No JSON files in ${DATA_DIR}. Run crawl-hira.ts first.`
    );
  }

  const allItems: HiraRawItem[] = [];
  for (const file of jsonFiles) {
    const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
    const items: HiraRawItem[] = JSON.parse(raw);
    allItems.push(...items);
    log.info(`Loaded ${items.length} records from ${file}`);
  }

  // ykiho 기준 중복 제거
  const unique = new Map<string, HiraRawItem>();
  for (const item of allItems) {
    if (!unique.has(item.ykiho)) {
      unique.set(item.ykiho, item);
    }
  }

  log.info(`Total unique HIRA records: ${unique.size} (raw: ${allItems.length})`);
  return Array.from(unique.values());
}

async function loadHospitals(): Promise<
  Array<{ id: string; name: string; address: string | null; phone: string | null }>
> {
  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name, address, phone')
    .eq('status', 'active');

  if (error) throw new Error(`Failed to load hospitals: ${error.message}`);
  return data ?? [];
}

function matchHiraToHospital(
  hiraItem: HiraRawItem,
  hospitals: Array<{ id: string; name: string; address: string | null; phone: string | null }>
): string | null {
  const hiraNorm = normalizeHospitalName(hiraItem.yadmNm);

  // 1차: 이름 정규화 매칭
  const nameMatches = hospitals.filter(
    (h) => normalizeHospitalName(h.name) === hiraNorm
  );

  if (nameMatches.length === 1) return nameMatches[0].id;

  // 2차: 이름 + 주소 일부 매칭
  if (nameMatches.length > 1) {
    const hiraAddr = hiraItem.addr?.replace(/\s+/g, '') ?? '';
    for (const h of nameMatches) {
      const hospAddr = h.address?.replace(/\s+/g, '') ?? '';
      if (hospAddr && hiraAddr && (hospAddr.includes(hiraAddr.slice(0, 10)) || hiraAddr.includes(hospAddr.slice(0, 10)))) {
        return h.id;
      }
    }
    // 주소 매칭 안 되면 첫번째 반환 (동명이원)
    return nameMatches[0].id;
  }

  // 3차: 부분 이름 매칭 (ex: "바노바기성형외과의원" ↔ "바노바기")
  const partialMatches = hospitals.filter((h) => {
    const hNorm = normalizeHospitalName(h.name);
    return (
      (hiraNorm.length >= 2 && hNorm.includes(hiraNorm)) ||
      (hNorm.length >= 2 && hiraNorm.includes(hNorm))
    );
  });

  if (partialMatches.length === 1) return partialMatches[0].id;

  // 4차: 전화번호 매칭
  if (hiraItem.telno) {
    const hiraPhone = hiraItem.telno.replace(/[^0-9]/g, '');
    const phoneMatch = hospitals.find((h) => {
      const hospPhone = h.phone?.replace(/[^0-9]/g, '') ?? '';
      return hospPhone && hospPhone === hiraPhone;
    });
    if (phoneMatch) return phoneMatch.id;
  }

  return null;
}

async function syncBatch(
  updates: Array<{
    id: string;
    hira_specialist_count: number;
    hira_opened_at: string | null;
    hira_department: string;
    hira_bed_count: number;
    hira_synced_at: string;
  }>
): Promise<number> {
  let updated = 0;
  // Supabase는 bulk upsert를 지원하지만, hospitals 테이블은 PK=id이므로 개별 업데이트
  for (const row of updates) {
    const { error } = await supabase
      .from('hospitals')
      .update({
        hira_specialist_count: row.hira_specialist_count,
        hira_opened_at: row.hira_opened_at,
        hira_department: row.hira_department,
        hira_bed_count: row.hira_bed_count,
        hira_synced_at: row.hira_synced_at,
      })
      .eq('id', row.id);

    if (error) {
      log.error(`Failed to update hospital ${row.id}: ${error.message}`);
    } else {
      updated++;
    }
  }
  return updated;
}

async function main(): Promise<void> {
  log.info('=== Starting HIRA → hospitals sync ===');

  const hiraItems = await loadHiraData();
  const hospitals = await loadHospitals();
  log.info(`Loaded ${hospitals.length} hospitals from DB`);

  const result: MatchResult = { matched: 0, unmatched: 0, updated: 0, errors: 0 };
  const unmatched: HiraRawItem[] = [];
  const batch: Array<{
    id: string;
    hira_specialist_count: number;
    hira_opened_at: string | null;
    hira_department: string;
    hira_bed_count: number;
    hira_synced_at: string;
  }> = [];

  const now = new Date().toISOString();

  for (const hira of hiraItems) {
    const hospitalId = matchHiraToHospital(hira, hospitals);

    if (!hospitalId) {
      result.unmatched++;
      unmatched.push(hira);
      continue;
    }

    result.matched++;
    batch.push({
      id: hospitalId,
      hira_specialist_count: hira.cmdcResdntCnt ?? hira.drTotCnt ?? 0,
      hira_opened_at: parseEstbDate(hira.estbDd),
      hira_department: hira.dgsbjtCdNm ?? '',
      hira_bed_count: 0,
      hira_synced_at: now,
    });

    // 100건씩 배치 업데이트
    if (batch.length >= 100) {
      const count = await syncBatch(batch);
      result.updated += count;
      result.errors += batch.length - count;
      batch.length = 0;
      log.info(`Progress: ${result.matched} matched, ${result.updated} updated`);
    }
  }

  // 잔여 배치
  if (batch.length > 0) {
    const count = await syncBatch(batch);
    result.updated += count;
    result.errors += batch.length - count;
  }

  // 매칭 실패 건 저장
  if (unmatched.length > 0) {
    const unmatchedPath = path.resolve(__dirname, '../data/hira-unmatched.json');
    await fs.writeFile(unmatchedPath, JSON.stringify(unmatched, null, 2), 'utf-8');
    log.warn(`${unmatched.length} unmatched records saved to hira-unmatched.json`);
  }

  log.info('=== Sync complete ===');
  log.info(`Matched: ${result.matched} / ${hiraItems.length}`);
  log.info(`Updated: ${result.updated}`);
  log.info(`Unmatched: ${result.unmatched}`);
  log.info(`Errors: ${result.errors}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
