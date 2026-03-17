/**
 * Migration 030 적용 스크립트
 * device_dictionary 모델 분리 (울쎄라 시스템/프라임) + 써마지 FLX 별칭 보강
 *
 * DB_URL 환경변수 필요 또는 Supabase SQL Editor에서 직접 실행
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
    console.log('Supabase SQL Editor에서 직접 실행하세요:');
    console.log('  supabase/migrations/030_device_dictionary_model_split.sql');
    console.log('');
    console.log('또는 scripts/.env에 DB_URL을 추가하세요:');
    console.log('  DB_URL=postgresql://postgres:[YOUR-DB-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    console.log('='.repeat(60));

    const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '030_device_dictionary_model_split.sql');
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
    console.log('PostgreSQL 연결 성공');

    // Before
    const { rows: before } = await client.query(
      `SELECT name, aliases FROM device_dictionary WHERE name ILIKE '%울쎄라%' OR name ILIKE '%써마지 FLX%' ORDER BY name`
    );
    console.log('\n[Before]');
    for (const r of before) {
      console.log(`  ${r.name}: ${JSON.stringify(r.aliases)}`);
    }

    const sqlPath = path.resolve(__dirname, '..', 'supabase', 'migrations', '030_device_dictionary_model_split.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('\nMigration 030 적용 완료');

    // After
    const { rows: after } = await client.query(
      `SELECT name, aliases FROM device_dictionary WHERE name ILIKE '%울쎄라%' OR name ILIKE '%써마지 FLX%' ORDER BY name`
    );
    console.log('\n[After]');
    for (const r of after) {
      console.log(`  ${r.name}: ${JSON.stringify(r.aliases)}`);
    }

    const { rows: total } = await client.query('SELECT count(*) as cnt FROM device_dictionary');
    console.log(`\ndevice_dictionary 총 ${total[0].cnt}건`);

  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    console.error('오류:', msg);
  } finally {
    await client.end();
  }
}

main();
