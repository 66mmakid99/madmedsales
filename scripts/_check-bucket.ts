import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // 1. 버킷 목록
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  console.log('버킷 목록:', buckets?.map(b => `${b.name} (public: ${b.public})`));
  if (listErr) console.log('목록 에러:', listErr.message);

  // 2. hospital-screenshots 버킷 파일 확인
  const { data: files, error: fileErr } = await supabase.storage
    .from('hospital-screenshots')
    .list('', { limit: 10 });

  if (fileErr) {
    console.log('\n버킷 파일 조회 에러:', fileErr.message);
  } else {
    console.log('\n루트 폴더:', files?.map(f => f.name));
  }

  // 3. 특정 파일 URL 테스트
  const testPath = '1267b395-1132-4511-a8ba-1afc228a8867/main___20260224.webp';
  const { data: urlData } = supabase.storage
    .from('hospital-screenshots')
    .getPublicUrl(testPath);
  console.log('\nPublic URL:', urlData.publicUrl);

  // 4. 실제 다운로드 테스트
  const { data: dlData, error: dlErr } = await supabase.storage
    .from('hospital-screenshots')
    .download(testPath);

  if (dlErr) {
    console.log('다운로드 에러:', dlErr.message);
  } else {
    console.log('다운로드 성공:', dlData?.size, 'bytes');
  }
}

main().catch(console.error);
