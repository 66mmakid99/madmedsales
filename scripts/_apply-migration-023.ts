/**
 * Migration 023 적용 스크립트
 * medical_devices, device_dictionary 테이블 생성 + hospitals.site_type 컬럼 추가
 *
 * Supabase Management API 불가 → pg 직접 연결 방식
 * DB_URL 환경변수가 필요합니다 (Supabase Dashboard > Settings > Database > Connection string)
 *
 * 또는 Supabase SQL Editor에서 직접 실행:
 *   supabase/migrations/023_medical_devices_and_site_type.sql
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.log('='.repeat(60));
    console.log('DB_URL 환경변수가 없습니다.');
    console.log('');
    console.log('Supabase Dashboard에서 직접 SQL을 실행하세요:');
    console.log('1. https://supabase.com/dashboard → 프로젝트 선택');
    console.log('2. SQL Editor 탭 열기');
    console.log('3. 아래 파일의 내용을 붙여넣기하여 실행:');
    console.log('   supabase/migrations/023_medical_devices_and_site_type.sql');
    console.log('');
    console.log('또는 scripts/.env에 DB_URL을 추가하세요:');
    console.log('  DB_URL=postgresql://postgres:[YOUR-DB-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    console.log('='.repeat(60));

    // Print the SQL for easy copy-paste
    const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '023_medical_devices_and_site_type.sql');
    if (fs.existsSync(sqlPath)) {
      console.log('\n--- SQL 내용 (복사하여 SQL Editor에 붙여넣기) ---\n');
      console.log(fs.readFileSync(sqlPath, 'utf8'));
      console.log('\n--- 끝 ---');
    }
    return;
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ PostgreSQL 연결 성공');

    const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '023_medical_devices_and_site_type.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute as single transaction
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration 023 적용 완료');

    // Verify
    const { rows: tables } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('medical_devices', 'device_dictionary')
    `);
    console.log('생성된 테이블:', tables.map(t => t.table_name).join(', '));

    const { rows: cols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'hospitals' AND column_name IN ('site_type', 'site_type_confidence', 'site_type_signals', 'crawl_fail_reason')
    `);
    console.log('hospitals 추가 컬럼:', cols.map(c => c.column_name).join(', '));

    const { rows: dictCount } = await client.query('SELECT count(*) as cnt FROM device_dictionary');
    console.log('device_dictionary 초기 데이터:', dictCount[0].cnt, '건');

  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error('❌ 오류:', msg);
  } finally {
    await client.end();
  }
}

main();
