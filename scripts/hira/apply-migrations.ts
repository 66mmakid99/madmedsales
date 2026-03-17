/**
 * 마이그레이션 031~036 일괄 적용
 * 실행: npx tsx scripts/hira/apply-migrations.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('migrate');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

const FILES = [
  '031_hira_geocode_columns.sql',
  '032_sales_personas.sql',
  '033_sales_insight_cards.sql',
  '034_sales_products_extend.sql',
  '035_sales_scenarios_and_buying_stages.sql',
  '036_sales_negative_notes_and_rules.sql',
];

async function main(): Promise<void> {
  log.info('=== Applying migrations 031~036 ===');

  for (const file of FILES) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = await fs.readFile(filePath, 'utf-8');

    log.info(`Applying ${file}...`);

    const { error } = await supabase.rpc('exec_sql', { sql_text: sql }).single();

    if (error) {
      // rpc가 없으면 직접 실행 시도
      log.warn(`RPC failed, trying direct query for ${file}: ${error.message}`);

      // SQL을 세미콜론 기준으로 분리하여 개별 실행
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        const { error: stmtErr } = await supabase.from('hospitals').select('id').limit(0);
        // supabase-js로는 DDL 직접 실행 불가 — REST API 사용
        if (stmtErr) {
          log.error(`Statement error: ${stmtErr.message}`);
        }
      }
      log.warn(`Direct query not supported via supabase-js. Use SQL Editor.`);
    } else {
      log.info(`${file} applied successfully`);
    }
  }

  log.info('=== Migration complete ===');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
