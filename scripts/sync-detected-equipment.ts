/**
 * sync-detected-equipment.ts
 *
 * 크롤링에서 감지된 장비(sales_hospital_equipments)를
 * CRM 납품 관리(crm_equipment)에 자동 등록하는 후처리 스크립트.
 *
 * Flow:
 * 1. crm_products 로드 → 제품명 매칭 맵 구축
 * 2. sales_hospital_equipments 전체 조회
 * 3. equipment_name → crm_product 매칭
 * 4. hospitals → crm_hospitals 매핑 확인
 * 5. crm_equipment에 중복 없으면 INSERT (source='crawl_detected')
 *
 * Usage: npx tsx scripts/sync-detected-equipment.ts
 */

import { supabase } from './utils/supabase.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('CRM_SYNC');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ── 제품명 매칭 ──

interface CrmProduct {
  id: string;
  name: string;
}

/** 제품별 한국어/영문 별칭 (대소문자 무시, 공백/하이픈 정규화 후 매칭) */
const PRODUCT_ALIASES: Record<string, string[]> = {
  'TORR RF': [
    'torr rf', 'torr', 'torrrf', '토르', '토르rf', '토르 rf',
    '토르 리프팅', '토르리프팅', 'torr mpr', '토르 mpr', '토르mpr',
  ],
  'ULBLANC': [
    'ulblanc', '울블랑', '울블랑크', 'ul blanc',
  ],
  'NEWCHAE': [
    'newchae', 'newchae shot', '뉴채', '뉴채샷', '뉴채 샷',
  ],
  'LUMINO WAVE': [
    'lumino wave', 'luminowave', 'lumino', '루미노', '루미노웨이브', '루미노 웨이브',
  ],
};

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_\s]+/g, '')  // 공백, 하이픈, 언더스코어 제거
    .trim();
}

function buildProductMatcher(products: CrmProduct[]): (equipmentName: string) => CrmProduct | null {
  // 정규화된 별칭 → product 매핑
  const aliasMap = new Map<string, CrmProduct>();

  for (const product of products) {
    const aliases = PRODUCT_ALIASES[product.name];
    if (!aliases) continue;

    for (const alias of aliases) {
      aliasMap.set(normalizeForMatch(alias), product);
    }
    // 제품명 자체도 추가
    aliasMap.set(normalizeForMatch(product.name), product);
  }

  return (equipmentName: string): CrmProduct | null => {
    const normalized = normalizeForMatch(equipmentName);

    // 1) 정확 매칭
    const exact = aliasMap.get(normalized);
    if (exact) return exact;

    // 2) 부분 매칭: 별칭이 equipment_name에 포함되거나, equipment_name이 별칭에 포함
    for (const [alias, product] of aliasMap) {
      if (normalized.includes(alias) || alias.includes(normalized)) {
        return product;
      }
    }

    return null;
  };
}

// ── 메인 Sync 로직 ──

interface SyncResult {
  inserted: number;
  skippedExisting: number;
  skippedNoCrmHospital: number;
  skippedNoProductMatch: number;
  details: SyncDetail[];
}

interface SyncDetail {
  hospitalName: string;
  equipmentName: string;
  action: 'inserted' | 'skipped_existing' | 'skipped_no_crm' | 'skipped_no_match';
  productName?: string;
}

export async function syncDetectedEquipment(): Promise<SyncResult> {
  log.info('크롤링 감지 장비 → CRM 동기화 시작');

  // 1) crm_products 로드
  const { data: products, error: prodErr } = await supabase
    .from('crm_products')
    .select('id, name')
    .eq('is_active', true);

  if (prodErr || !products) {
    throw new Error(`crm_products 조회 실패: ${prodErr?.message}`);
  }

  const matchProduct = buildProductMatcher(products);
  log.info(`제품 ${products.length}개 로드: ${products.map(p => p.name).join(', ')}`);

  // 2) sales_hospital_equipments 전체 조회 (페이지네이션)
  const detected: Array<{
    hospital_id: string;
    equipment_name: string;
    equipment_category: string;
    created_at: string;
  }> = [];
  const PAGE = 1000;
  let offset = 0;

  while (true) {
    const { data: page, error: detErr } = await supabase
      .from('sales_hospital_equipments')
      .select('hospital_id, equipment_name, equipment_category, created_at')
      .range(offset, offset + PAGE - 1);

    if (detErr) throw new Error(`sales_hospital_equipments 조회 실패: ${detErr.message}`);
    if (!page || page.length === 0) break;

    detected.push(...page);
    offset += PAGE;
    if (page.length < PAGE) break;
  }

  log.info(`감지된 장비 ${detected.length}건 조회`);

  // 3) hospitals → crm_hospitals 매핑 로드
  const { data: crmHospitals, error: chErr } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id, tenant_id');

  if (chErr || !crmHospitals) {
    throw new Error(`crm_hospitals 조회 실패: ${chErr?.message}`);
  }

  // sales_hospital_id → crm_hospital 매핑
  const salesToCrm = new Map<string, { id: string; name: string; tenantId: string }>();
  for (const ch of crmHospitals) {
    if (ch.sales_hospital_id) {
      salesToCrm.set(ch.sales_hospital_id, {
        id: ch.id,
        name: ch.name,
        tenantId: ch.tenant_id,
      });
    }
  }

  log.info(`CRM 병원 매핑: ${salesToCrm.size}개 (전체 ${crmHospitals.length}개)`);

  // 4) 기존 crm_equipment 로드 (중복 체크용, 페이지네이션)
  const existingEquip: Array<{ hospital_id: string; product_id: string }> = [];
  let eqOffset = 0;

  while (true) {
    const { data: eqPage, error: eqErr } = await supabase
      .from('crm_equipment')
      .select('hospital_id, product_id')
      .range(eqOffset, eqOffset + PAGE - 1);

    if (eqErr) throw new Error(`crm_equipment 조회 실패: ${eqErr.message}`);
    if (!eqPage || eqPage.length === 0) break;

    existingEquip.push(...eqPage);
    eqOffset += PAGE;
    if (eqPage.length < PAGE) break;
  }

  const existingSet = new Set(
    existingEquip.map(e => `${e.hospital_id}::${e.product_id}`)
  );

  // 5) 병원명 조회 (로그용, 배치)
  const hospitalIds = [...new Set(detected.map(d => d.hospital_id))];
  const nameMap = new Map<string, string>();
  const ID_CHUNK = 200;

  for (let i = 0; i < hospitalIds.length; i += ID_CHUNK) {
    const chunk = hospitalIds.slice(i, i + ID_CHUNK);
    const { data: hospitalNames } = await supabase
      .from('hospitals')
      .select('id, name')
      .in('id', chunk);

    for (const h of hospitalNames ?? []) {
      nameMap.set(h.id, h.name);
    }
  }

  // 6) Sync 실행
  const result: SyncResult = {
    inserted: 0,
    skippedExisting: 0,
    skippedNoCrmHospital: 0,
    skippedNoProductMatch: 0,
    details: [],
  };

  const toInsert: Array<{
    hospital_id: string;
    tenant_id: string;
    product_id: string;
    source: string;
    status: string;
    detected_at: string;
  }> = [];

  for (const det of detected) {
    const hospitalName = nameMap.get(det.hospital_id) ?? det.hospital_id;

    // 제품 매칭
    const product = matchProduct(det.equipment_name);
    if (!product) {
      result.skippedNoProductMatch++;
      result.details.push({
        hospitalName,
        equipmentName: det.equipment_name,
        action: 'skipped_no_match',
      });
      continue;
    }

    // CRM 병원 매핑
    const crmHospital = salesToCrm.get(det.hospital_id);
    if (!crmHospital) {
      result.skippedNoCrmHospital++;
      result.details.push({
        hospitalName,
        equipmentName: det.equipment_name,
        action: 'skipped_no_crm',
        productName: product.name,
      });
      log.warn(`${hospitalName}: ${product.name} 감지됨 but CRM 병원 미등록 → 스킵`);
      continue;
    }

    // 중복 체크
    const key = `${crmHospital.id}::${product.id}`;
    if (existingSet.has(key)) {
      result.skippedExisting++;
      result.details.push({
        hospitalName,
        equipmentName: det.equipment_name,
        action: 'skipped_existing',
        productName: product.name,
      });
      log.info(`${hospitalName}: ${product.name} 이미 crm_equipment에 존재 → 스킵`);
      continue;
    }

    // INSERT 대상
    toInsert.push({
      hospital_id: crmHospital.id,
      tenant_id: crmHospital.tenantId ?? TENANT_ID,
      product_id: product.id,
      source: 'crawl_detected',
      status: 'detected',
      detected_at: det.created_at ?? new Date().toISOString(),
    });

    existingSet.add(key); // 같은 배치 내 중복 방지

    result.details.push({
      hospitalName,
      equipmentName: det.equipment_name,
      action: 'inserted',
      productName: product.name,
    });

    log.info(`${hospitalName}: ${product.name} 크롤링 감지 → crm_equipment 등록 (source=crawl_detected)`);
  }

  // 배치 INSERT
  if (toInsert.length > 0) {
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      const { error: insErr } = await supabase
        .from('crm_equipment')
        .insert(batch);

      if (insErr) {
        log.error(`INSERT 실패 (batch ${i}): ${insErr.message}`);
      } else {
        result.inserted += batch.length;
      }
    }
  }

  return result;
}

// ── 리포트 출력 ──

function printReport(result: SyncResult): void {
  console.log('\n========================================');
  console.log('  CRM 장비 동기화 결과');
  console.log('========================================');
  console.log(`  신규 등록:       ${result.inserted}건 (source=crawl_detected)`);
  console.log(`  기존 확인:       ${result.skippedExisting}건 (이미 crm_equipment에 존재)`);
  console.log(`  CRM 미등록 병원: ${result.skippedNoCrmHospital}건`);
  console.log(`  제품 매칭 실패:  ${result.skippedNoProductMatch}건`);
  console.log('========================================');

  // 상세 목록
  const inserted = result.details.filter(d => d.action === 'inserted');
  if (inserted.length > 0) {
    console.log('\n[신규 등록]');
    for (const d of inserted) {
      console.log(`  + ${d.hospitalName}: ${d.productName}`);
    }
  }

  const noCrm = result.details.filter(d => d.action === 'skipped_no_crm');
  if (noCrm.length > 0) {
    console.log('\n[CRM 미등록 병원 - 수동 확인 필요]');
    for (const d of noCrm) {
      console.log(`  ? ${d.hospitalName}: ${d.productName} (${d.equipmentName})`);
    }
  }

  const noMatch = result.details.filter(d => d.action === 'skipped_no_match');
  if (noMatch.length > 0) {
    // 유니크 장비명만 출력 (모든 병원 나열하면 너무 길어짐)
    const uniqueNames = new Map<string, number>();
    for (const d of noMatch) {
      uniqueNames.set(d.equipmentName, (uniqueNames.get(d.equipmentName) ?? 0) + 1);
    }
    const sorted = [...uniqueNames.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n[제품 매칭 실패 - 상위 장비명 (${sorted.length}종)]`);
    for (const [name, cnt] of sorted.slice(0, 20)) {
      console.log(`  - "${name}" (${cnt}건)`);
    }
    if (sorted.length > 20) {
      console.log(`  ... 외 ${sorted.length - 20}종`);
    }
  }
}

// ── Main ──

async function main(): Promise<void> {
  const result = await syncDetectedEquipment();
  printReport(result);
  console.log('\n완료!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
