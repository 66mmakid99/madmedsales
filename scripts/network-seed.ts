/**
 * 네트워크/프랜차이즈 시드 데이터 + 키워드 매칭 스크립트
 *
 * 1. networks 테이블에 TOP 브랜드 삽입
 * 2. 전체 병원 키워드 매칭 → network_branches에 candidate로 삽입
 *
 * 실행: npx tsx scripts/network-seed.ts
 */
import * as dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: 'scripts/.env' });

const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ===== 시드 데이터: 확인된 프랜차이즈/네트워크 브랜드 =====
interface BrandSeed {
  name: string;
  category: 'franchise' | 'network' | 'group';
  keywords: string[];           // 병원명에서 매칭할 키워드
  official_site_url?: string;
  official_name?: string;
  notes?: string;
}

const BRAND_SEEDS: BrandSeed[] = [
  // === 대형 프랜차이즈 (30+ 지점) ===
  { name: '유앤아이의원', category: 'franchise', keywords: ['유앤아이'], official_site_url: 'https://www.uandiskin.co.kr' },
  { name: '메이퓨어의원', category: 'franchise', keywords: ['메이퓨어'] },
  { name: '밴스의원', category: 'franchise', keywords: ['밴스'] },
  { name: '블리비의원', category: 'franchise', keywords: ['블리비'] },
  { name: '톤즈의원', category: 'franchise', keywords: ['톤즈'] },
  { name: '톡스앤필의원', category: 'franchise', keywords: ['톡스앤필'] },
  { name: '닥터에버스의원', category: 'franchise', keywords: ['닥터에버스'] },
  { name: '오라클피부과', category: 'franchise', keywords: ['오라클'], official_site_url: 'https://www.oracle-skin.com' },

  // === 중형 프랜차이즈 (15~30 지점) ===
  { name: '다시봄날의원', category: 'franchise', keywords: ['다시봄날'] },
  { name: '휴먼피부과', category: 'network', keywords: ['휴먼피부과'], official_site_url: 'https://www.humanskin.co.kr', notes: '주의: 파스텔휴먼, 모건휴먼 등은 비소속' },
  { name: '닥터스피부과', category: 'franchise', keywords: ['닥터스피부과'] },
  { name: 'CNP차앤박피부과', category: 'franchise', keywords: ['차앤박', 'CNP'], official_site_url: 'https://www.cnpskin.com' },
  { name: '데이뷰의원', category: 'franchise', keywords: ['데이뷰'] },
  { name: '리멤버피부과', category: 'franchise', keywords: ['리멤버'] },
  { name: '아비쥬의원', category: 'franchise', keywords: ['아비쥬'], official_site_url: 'https://www.abijou.co.kr' },
  { name: '뷰티온의원', category: 'franchise', keywords: ['뷰티온'] },
  { name: '셀린의원', category: 'franchise', keywords: ['셀린의원'] },
  { name: '고운세상피부과', category: 'network', keywords: ['고운세상'], official_site_url: 'https://www.gounnet.co.kr', official_name: '(주)고운세상네트웍스' },
  { name: '미앤미의원', category: 'franchise', keywords: ['미앤미'] },

  // === 소형 프랜차이즈 (5~15 지점) ===
  { name: '포에버의원', category: 'franchise', keywords: ['포에버의원'] },
  { name: '스노우의원', category: 'franchise', keywords: ['스노우의원'] },
  { name: '뷰티라운지의원', category: 'franchise', keywords: ['뷰티라운지'] },
  { name: '예쁨주의쁨의원', category: 'franchise', keywords: ['예쁨주의쁨'] },
  { name: '리버스의원', category: 'franchise', keywords: ['리버스의원'] },
  { name: '리즈온의원', category: 'franchise', keywords: ['리즈온'] },
  { name: '뮤즈의원', category: 'franchise', keywords: ['뮤즈의원'] },
  { name: '제너리스의원', category: 'franchise', keywords: ['제너리스'] },
  { name: '이지함피부과', category: 'franchise', keywords: ['이지함'], official_site_url: 'https://www.ezham.co.kr' },
  { name: '타토아의원', category: 'franchise', keywords: ['타토아'] },
  { name: '아이디의원', category: 'franchise', keywords: ['아이디의원'] },
  { name: '닥터디자이너의원', category: 'franchise', keywords: ['닥터디자이너'] },
  { name: 'CU클린업피부과', category: 'franchise', keywords: ['클린업'], official_site_url: 'https://www.cucleanup.co.kr' },
  { name: '맥스웰의원', category: 'franchise', keywords: ['맥스웰'] },
  { name: '오체안피부과', category: 'franchise', keywords: ['오체안'] },
  { name: '셀로디피부과', category: 'franchise', keywords: ['셀로디'] },
  { name: '세가지소원의원', category: 'franchise', keywords: ['세가지소원'] },
  { name: '클림의원', category: 'franchise', keywords: ['클림의원'] },

  // === 네트워크형 ===
  { name: '리더스피부과', category: 'network', keywords: ['리더스피부과'] },
  { name: '에스앤유피부과', category: 'network', keywords: ['에스앤유피부과'] },
  { name: '하얀나라피부과', category: 'network', keywords: ['하얀나라피부과'] },
];

interface HospitalRow {
  id: string;
  name: string;
  sido: string | null;
  sigungu: string | null;
}

async function fetchAllHospitals(): Promise<HospitalRow[]> {
  const all: HospitalRow[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('hospitals')
      .select('id, name, sido, sigungu')
      .range(offset, offset + limit - 1);
    if (error) throw new Error(`Failed to fetch hospitals: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as HospitalRow[]));
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function seedNetworks(): Promise<Map<string, string>> {
  console.log('=== Step 1: 네트워크 브랜드 시드 데이터 삽입 ===\n');

  const networkMap = new Map<string, string>(); // name -> id

  // 기존 데이터 확인
  const { data: existing } = await supabase.from('networks').select('id, name');
  if (existing && existing.length > 0) {
    console.log(`기존 네트워크 ${existing.length}개 발견. 중복 건너뜀.\n`);
    for (const n of existing) {
      networkMap.set(n.name, n.id);
    }
  }

  let inserted = 0;
  for (const brand of BRAND_SEEDS) {
    if (networkMap.has(brand.name)) continue;

    const { data, error } = await supabase
      .from('networks')
      .insert({
        name: brand.name,
        category: brand.category,
        official_name: brand.official_name ?? null,
        official_site_url: brand.official_site_url ?? null,
        notes: brand.notes ?? null,
        status: 'unverified',
      })
      .select('id')
      .single();

    if (error) {
      console.log(`  ❌ ${brand.name}: ${error.message}`);
      continue;
    }
    networkMap.set(brand.name, data.id);
    inserted++;
  }

  console.log(`삽입 완료: ${inserted}개 신규 / ${networkMap.size}개 총 네트워크\n`);
  return networkMap;
}

async function matchAndInsertBranches(networkMap: Map<string, string>): Promise<void> {
  console.log('=== Step 2: 키워드 매칭 → 후보 지점 삽입 ===\n');

  const hospitals = await fetchAllHospitals();
  console.log(`병원 ${hospitals.length}개 로드 완료\n`);

  // 기존 branches 확인 (이미 매칭된 것은 건너뜀)
  const { data: existingBranches } = await supabase
    .from('network_branches')
    .select('hospital_id, network_id');
  const existingSet = new Set<string>();
  if (existingBranches) {
    for (const b of existingBranches) {
      existingSet.add(`${b.network_id}:${b.hospital_id}`);
    }
  }
  console.log(`기존 매핑 ${existingSet.size}개 발견. 중복 건너뜀.\n`);

  // 키워드 긴 것 우선으로 매칭 (더 구체적인 것이 먼저)
  const sortedBrands = [...BRAND_SEEDS].sort((a, b) => {
    const maxA = Math.max(...a.keywords.map(k => k.length));
    const maxB = Math.max(...b.keywords.map(k => k.length));
    return maxB - maxA;
  });

  // 매칭 수행
  const matches: Array<{
    network_id: string;
    hospital_id: string;
    branch_name: string;
    keyword_match_score: number;
    brand_name: string;
  }> = [];
  const matchedHospitals = new Set<string>();

  for (const hospital of hospitals) {
    if (matchedHospitals.has(hospital.id)) continue;

    for (const brand of sortedBrands) {
      const networkId = networkMap.get(brand.name);
      if (!networkId) continue;

      const matched = brand.keywords.some(kw => hospital.name.includes(kw));
      if (!matched) continue;

      // 중복 체크
      const key = `${networkId}:${hospital.id}`;
      if (existingSet.has(key)) break;

      // 키워드 매칭 점수: 키워드 길이 비율 기반
      const matchedKw = brand.keywords.find(kw => hospital.name.includes(kw))!;
      const kwScore = Math.min(Math.round((matchedKw.length / hospital.name.length) * 100), 100);

      matches.push({
        network_id: networkId,
        hospital_id: hospital.id,
        branch_name: hospital.name,
        keyword_match_score: kwScore,
        brand_name: brand.name,
      });
      matchedHospitals.add(hospital.id);
      break; // 한 병원은 하나의 네트워크에만 매칭
    }
  }

  console.log(`새 후보 매칭 ${matches.length}개 발견\n`);

  // 배치 삽입 (50개씩)
  const BATCH = 50;
  let totalInserted = 0;
  const brandCounts = new Map<string, number>();

  for (let i = 0; i < matches.length; i += BATCH) {
    const batch = matches.slice(i, i + BATCH);
    const rows = batch.map(m => ({
      network_id: m.network_id,
      hospital_id: m.hospital_id,
      branch_name: m.branch_name,
      role: 'branch' as const,
      confidence: 'candidate' as const,
      confidence_score: m.keyword_match_score,
      keyword_match_score: m.keyword_match_score,
      verified_by: 'auto',
      verification_notes: `키워드 매칭 (자동 스캔)`,
    }));

    const { error } = await supabase.from('network_branches').insert(rows);
    if (error) {
      console.log(`  배치 ${Math.floor(i / BATCH) + 1} 삽입 실패: ${error.message}`);
    } else {
      totalInserted += batch.length;
      for (const m of batch) {
        brandCounts.set(m.brand_name, (brandCounts.get(m.brand_name) ?? 0) + 1);
      }
    }
  }

  // 네트워크별 total_branches 업데이트
  for (const [brandName, count] of brandCounts) {
    const networkId = networkMap.get(brandName);
    if (!networkId) continue;
    await supabase
      .from('networks')
      .update({ total_branches: count })
      .eq('id', networkId);
  }

  // 결과 출력
  console.log(`\n=== 결과 ===\n`);
  console.log(`삽입 완료: ${totalInserted}개 후보 지점\n`);

  const sorted = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('| 순위 | 브랜드 | 후보 지점수 |');
  console.log('|------|--------|------------|');
  sorted.forEach(([brand, count], i) => {
    console.log(`| ${i + 1} | ${brand} | ${count} |`);
  });

  console.log(`\n전체 ${hospitals.length}개 병원 중 ${totalInserted}개 (${(totalInserted / hospitals.length * 100).toFixed(1)}%) 매칭됨`);
  console.log(`\n⚠️  모든 매칭은 'candidate' 상태입니다. Admin UI에서 검증이 필요합니다.`);
}

async function main(): Promise<void> {
  // 테이블 존재 확인
  const { error } = await supabase.from('networks').select('id').limit(1);
  if (error) {
    console.error('❌ networks 테이블이 없습니다!');
    console.error('먼저 Supabase Dashboard SQL Editor에서 migration 018을 실행하세요:');
    console.error('  파일: supabase/migrations/018_network_verification.sql');
    process.exit(1);
  }

  const networkMap = await seedNetworks();
  await matchAndInsertBranches(networkMap);
}

main().catch(console.error);
