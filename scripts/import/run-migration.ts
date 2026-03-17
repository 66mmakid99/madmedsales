/**
 * 마이그레이션 실행: 038_hospital_emails.sql
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from '../utils/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sqlPath = path.resolve(__dirname, '../../supabase/migrations/038_hospital_emails.sql');
const sql = readFileSync(sqlPath, 'utf-8');

async function main() {
  console.log('마이그레이션 실행:', sqlPath);

  // Supabase는 supabase-js로 직접 DDL 실행이 안됨 → rpc나 pg 직접 연결 필요
  // service role key로 REST API through rpc 시도
  const { error } = await supabase.rpc('exec_sql', { sql_text: sql }).single();

  if (error) {
    // exec_sql RPC가 없는 경우 → SQL 출력만 해줌
    console.log('\nexec_sql RPC 없음. 아래 SQL을 Supabase SQL Editor에서 직접 실행하세요:\n');
    console.log('='.repeat(60));
    console.log(sql);
    console.log('='.repeat(60));
  } else {
    console.log('마이그레이션 성공!');
  }
}

main().catch(console.error);
