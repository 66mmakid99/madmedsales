import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  SnapshotData,
  EquipmentMasterEntry,
  SessionData,
  PageCounts,
  BulkDataMaps,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '..', '..', 'scripts', '.env') });

function createScoringClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정');
    process.exit(1);
  }
  return createClient(url, key);
}

export const supabase = createScoringClient();

// ─── Paginated fetch helper ──────────────────────────────────
async function fetchAll<T>(
  table: string,
  select: string,
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const results: T[] = [];
  let offset = 0;

  while (true) {
    const query = supabase.from(table).select(select).range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) throw new Error(`${table} 로드 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return results;
}

// ─── Loaders ─────────────────────────────────────────────────
export async function loadAllSnapshots(): Promise<Map<string, SnapshotData>> {
  const rows = await fetchAll<{
    hospital_id: string;
    equipments_found: unknown[] | null;
    treatments_found: unknown[] | null;
    pricing_found: unknown[] | null;
  }>('scv_crawl_snapshots', 'hospital_id, equipments_found, treatments_found, pricing_found');

  const map = new Map<string, SnapshotData>();
  for (const r of rows) {
    map.set(r.hospital_id, {
      equipments_found: toStringArray(r.equipments_found),
      treatments_found: toStringArray(r.treatments_found),
      pricing_found: toStringArray(r.pricing_found),
    });
  }
  return map;
}

export async function loadDoctorCounts(): Promise<Map<string, number>> {
  const rows = await fetchAll<{ hospital_id: string; name: string }>(
    'hospital_doctors',
    'hospital_id, name',
  );

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.hospital_id, (map.get(r.hospital_id) || 0) + 1);
  }
  return map;
}

export async function loadEquipmentMaster(): Promise<Map<string, EquipmentMasterEntry[]>> {
  const rows = await fetchAll<{
    hospital_id: string;
    equipment_name: string;
    equipment_category: string | null;
    equipment_brand: string | null;
  }>('sales_hospital_equipments', 'hospital_id, equipment_name, equipment_category, equipment_brand');

  const map = new Map<string, EquipmentMasterEntry[]>();
  for (const r of rows) {
    const list = map.get(r.hospital_id) || [];
    list.push({
      canonical_name: r.equipment_name,
      category: r.equipment_category || '',
      equipment_type: r.equipment_brand || '',
    });
    map.set(r.hospital_id, list);
  }
  return map;
}

export async function loadCrawlSessions(): Promise<Map<string, SessionData>> {
  const rows = await fetchAll<{
    hospital_id: string;
    total_urls: number;
    crawled_pages: number;
  }>('scv_crawl_sessions', 'hospital_id, total_urls, crawled_pages');

  const map = new Map<string, SessionData>();
  for (const r of rows) {
    map.set(r.hospital_id, {
      total_urls: r.total_urls,
      crawled_pages: r.crawled_pages,
    });
  }
  return map;
}

export async function loadPageTypeCounts(): Promise<Map<string, PageCounts>> {
  // scv_crawl_sessions에 이미 타입별 카운트가 있으므로 활용
  const rows = await fetchAll<{
    hospital_id: string;
    type_event: number | null;
    type_treatment: number | null;
    type_price: number | null;
    crawled_pages: number | null;
  }>('scv_crawl_sessions', 'hospital_id, type_event, type_treatment, type_price, crawled_pages');

  const map = new Map<string, PageCounts>();
  for (const r of rows) {
    map.set(r.hospital_id, {
      event: r.type_event || 0,
      blog: 0,
      price: r.type_price || 0,
      treatment: r.type_treatment || 0,
      total: r.crawled_pages || 0,
    });
  }
  return map;
}

export async function buildBulkDataMaps(): Promise<BulkDataMaps> {
  console.log('📊 벌크 데이터 로드 시작...');

  const [snapshots, doctorCounts, equipmentMaster, sessions, pageCounts] = await Promise.all([
    loadAllSnapshots(),
    loadDoctorCounts(),
    loadEquipmentMaster(),
    loadCrawlSessions(),
    loadPageTypeCounts(),
  ]);

  const allHospitalIds = new Set<string>();
  for (const id of snapshots.keys()) allHospitalIds.add(id);
  for (const id of doctorCounts.keys()) allHospitalIds.add(id);
  for (const id of equipmentMaster.keys()) allHospitalIds.add(id);
  for (const id of sessions.keys()) allHospitalIds.add(id);
  for (const id of pageCounts.keys()) allHospitalIds.add(id);

  console.log(`  ✅ 스냅샷: ${snapshots.size}개`);
  console.log(`  ✅ 의사수: ${doctorCounts.size}개`);
  console.log(`  ✅ 장비: ${equipmentMaster.size}개 병원`);
  console.log(`  ✅ 세션: ${sessions.size}개`);
  console.log(`  ✅ 페이지: ${pageCounts.size}개 병원`);
  console.log(`  📋 전체 병원 수: ${allHospitalIds.size}개`);

  return { snapshots, doctorCounts, equipmentMaster, sessions, pageCounts, allHospitalIds };
}

// ─── Helpers ─────────────────────────────────────────────────
function toStringArray(val: unknown[] | null | undefined): string[] {
  if (!val) return [];
  return val.map((v) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && v !== null) {
      return (v as Record<string, string>).name || (v as Record<string, string>).normalized_name || JSON.stringify(v);
    }
    return String(v);
  });
}
