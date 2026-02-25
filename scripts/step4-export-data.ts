/**
 * step4-export-data.ts
 *
 * TORR RF 71 병원 전체 데이터를 JSON으로 export
 * - crm_hospitals + hospitals + equipments + treatments + doctors
 * - 재분석/스코어링용 데이터 패키지
 */

import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

interface ExportHospital {
  crm_id: string;
  hospital_id: string | null;
  name: string;
  region: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  crawled_at: string | null;
  equipments: Array<{
    name: string;
    category: string;
    manufacturer: string | null;
    source: string | null;
  }>;
  treatments: Array<{
    name: string;
    category: string;
    price: number | null;
    is_promoted: boolean;
    source: string | null;
  }>;
  doctors: Array<{
    name: string;
    title: string;
    specialty: string | null;
  }>;
  data_status: 'rich' | 'partial' | 'empty' | 'no_crawl';
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Step 4: TORR RF 전체 데이터 Export');
  console.log('═══════════════════════════════════════════════════\n');

  // CRM 병원 전체
  const { data: crmHospitals, error } = await supabase
    .from('crm_hospitals')
    .select('id, name, sales_hospital_id, region, address, phone, website, notes')
    .eq('tenant_id', TENANT_ID)
    .order('name');

  if (error || !crmHospitals) {
    console.error('CRM 조회 실패:', error?.message);
    return;
  }

  console.log(`📋 CRM 병원: ${crmHospitals.length}개\n`);

  const exports: ExportHospital[] = [];

  for (const crm of crmHospitals) {
    const hid = crm.sales_hospital_id;
    let crawledAt: string | null = null;
    let equipments: ExportHospital['equipments'] = [];
    let treatments: ExportHospital['treatments'] = [];
    let doctors: ExportHospital['doctors'] = [];

    if (hid) {
      // hospitals crawled_at
      const { data: hospital } = await supabase
        .from('hospitals')
        .select('crawled_at')
        .eq('id', hid)
        .single();
      crawledAt = hospital?.crawled_at || null;

      // equipments
      const { data: eqData } = await supabase
        .from('hospital_equipments')
        .select('equipment_name, equipment_category, manufacturer, source')
        .eq('hospital_id', hid);
      if (eqData) {
        equipments = eqData.map(e => ({
          name: e.equipment_name,
          category: e.equipment_category || 'other',
          manufacturer: e.manufacturer || null,
          source: e.source || null,
        }));
      }

      // treatments
      const { data: trData } = await supabase
        .from('hospital_treatments')
        .select('treatment_name, treatment_category, price, is_promoted, source')
        .eq('hospital_id', hid);
      if (trData) {
        treatments = trData.map(t => ({
          name: t.treatment_name,
          category: t.treatment_category || 'other',
          price: t.price || null,
          is_promoted: t.is_promoted || false,
          source: t.source || null,
        }));
      }

      // doctors
      const { data: drData } = await supabase
        .from('hospital_doctors')
        .select('name, title, specialty')
        .eq('hospital_id', hid);
      if (drData) {
        doctors = drData.map(d => ({
          name: d.name,
          title: d.title || '원장',
          specialty: d.specialty || null,
        }));
      }
    }

    // data status
    let dataStatus: ExportHospital['data_status'];
    const totalData = equipments.length + treatments.length + doctors.length;
    if (!hid || !crawledAt) dataStatus = 'no_crawl';
    else if (totalData === 0) dataStatus = 'empty';
    else if (totalData < 5) dataStatus = 'partial';
    else dataStatus = 'rich';

    exports.push({
      crm_id: crm.id,
      hospital_id: hid,
      name: crm.name,
      region: crm.region || null,
      address: crm.address || null,
      phone: crm.phone || null,
      website: crm.website || null,
      crawled_at: crawledAt,
      equipments,
      treatments,
      doctors,
      data_status: dataStatus,
    });
  }

  // 통계
  const stats = {
    total: exports.length,
    rich: exports.filter(e => e.data_status === 'rich').length,
    partial: exports.filter(e => e.data_status === 'partial').length,
    empty: exports.filter(e => e.data_status === 'empty').length,
    no_crawl: exports.filter(e => e.data_status === 'no_crawl').length,
    total_equipments: exports.reduce((s, e) => s + e.equipments.length, 0),
    total_treatments: exports.reduce((s, e) => s + e.treatments.length, 0),
    total_doctors: exports.reduce((s, e) => s + e.doctors.length, 0),
    export_date: new Date().toISOString(),
  };

  const output = { stats, hospitals: exports };
  const outputPath = path.resolve(__dirname, 'data', 'torr-rf-hospitals-full-export.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log('───── Export 통계 ─────');
  console.log(`총 병원: ${stats.total}개`);
  console.log(`  데이터 풍부 (rich): ${stats.rich}개`);
  console.log(`  데이터 부분 (partial): ${stats.partial}개`);
  console.log(`  데이터 없음 (empty): ${stats.empty}개`);
  console.log(`  미크롤링 (no_crawl): ${stats.no_crawl}개`);
  console.log(`총 장비: ${stats.total_equipments}개`);
  console.log(`총 시술: ${stats.total_treatments}개`);
  console.log(`총 의사: ${stats.total_doctors}명`);
  console.log(`\n💾 Export: ${outputPath}`);
}

main().catch(console.error);
