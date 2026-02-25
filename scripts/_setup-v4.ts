/**
 * v4 환경 세팅: DB 컬럼 추가 + Storage 버킷 + Firecrawl screenshot 형식 확인
 */
import FirecrawlApp from '@mendable/firecrawl-js';
import { supabase } from './utils/supabase.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

async function main(): Promise<void> {
  console.log('=== v4 환경 세팅 ===\n');

  // 1. DB 컬럼 추가 (이미 있으면 무시)
  console.log('1. DB 컬럼 확인...');
  // hospital_crawl_pages 컬럼 확인
  const { data: testPage } = await supabase
    .from('hospital_crawl_pages')
    .select('screenshot_url, analysis_method')
    .limit(1);

  if (testPage !== null) {
    console.log('   ✅ screenshot_url, analysis_method 컬럼 이미 존재');
  } else {
    console.log('   ⚠️ 컬럼 추가 필요 — Supabase SQL Editor에서 실행:');
    console.log('   ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS screenshot_url TEXT;');
    console.log('   ALTER TABLE hospital_crawl_pages ADD COLUMN IF NOT EXISTS analysis_method TEXT DEFAULT \'text\';');
  }

  // 2. Supabase Storage 버킷 생성
  console.log('\n2. Storage 버킷 확인...');
  const { data: buckets } = await supabase.storage.listBuckets();
  const existing = buckets?.find(b => b.name === 'hospital-screenshots');
  if (existing) {
    console.log('   ✅ hospital-screenshots 버킷 이미 존재');
  } else {
    const { data, error } = await supabase.storage.createBucket('hospital-screenshots', {
      public: true,
      fileSizeLimit: 1048576,
    });
    if (error) {
      console.log('   ❌ 버킷 생성 실패:', error.message);
    } else {
      console.log('   ✅ hospital-screenshots 버킷 생성 완료');
    }
  }

  // 3. Firecrawl screenshot 반환 형식 확인
  console.log('\n3. Firecrawl screenshot 형식 테스트...');
  const firecrawlApp = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });

  try {
    const result = await firecrawlApp.v1.scrapeUrl('http://www.dongancenter.com/info/doctor.htm', {
      formats: ['markdown', 'screenshot'],
      waitFor: 3000,
    });

    if (!result.success) {
      console.log('   ❌ scrape 실패:', (result as Record<string, unknown>).error);
      return;
    }

    console.log('   markdown 길이:', result.markdown?.length || 0);

    const ss = (result as Record<string, unknown>).screenshot;
    if (!ss) {
      console.log('   ❌ screenshot 없음 (null/undefined)');
    } else if (typeof ss === 'string') {
      if (ss.startsWith('http')) {
        console.log('   ✅ screenshot 형식: URL');
        console.log('   URL:', ss.substring(0, 120) + '...');
        // URL에서 다운로드 테스트
        const resp = await fetch(ss);
        const buf = Buffer.from(await resp.arrayBuffer());
        console.log('   다운로드 크기:', (buf.length / 1024).toFixed(1) + 'KB');
      } else if (ss.startsWith('data:image')) {
        console.log('   ✅ screenshot 형식: data URI');
        const base64Part = ss.split(',')[1];
        const buf = Buffer.from(base64Part, 'base64');
        console.log('   디코딩 크기:', (buf.length / 1024).toFixed(1) + 'KB');
      } else {
        // 순수 base64
        console.log('   ✅ screenshot 형식: base64 string');
        console.log('   문자열 길이:', ss.length);
        const buf = Buffer.from(ss, 'base64');
        console.log('   디코딩 크기:', (buf.length / 1024).toFixed(1) + 'KB');
      }
    } else {
      console.log('   ❓ screenshot 타입:', typeof ss);
    }

    // result 키들 확인
    console.log('\n   result 키:', Object.keys(result));
  } catch (err) {
    console.log('   ❌ Firecrawl 에러:', err);
  }
}

main().catch(console.error);
