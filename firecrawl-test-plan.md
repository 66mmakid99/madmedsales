# Firecrawl Phase 1 캡처 테스트

## 1단계: Firecrawl 가입 + API 키 발급

1. https://www.firecrawl.dev/ 접속
2. 무료 가입 (500크레딧 제공, 카드 불필요)
3. 대시보드에서 API Key 복사
4. 프로젝트 루트의 .env 파일에 추가:
   ```
   FIRECRAWL_API_KEY=fc-xxxxxxxxxxxxxxxx
   ```

## 2단계: Claude Code 명령문

아래를 Claude Code에 붙여넣으세요:

---

```
Firecrawl API를 사용해서 병원 웹사이트를 통째로 캡처하는 테스트를 진행해.

## 설치
npm install firecrawl-js --save-dev

## 테스트 스크립트 작성
scripts/crawler/firecrawl-capture-test.ts 파일을 새로 만들어.

### 기능
1. Firecrawl의 crawl 엔드포인트로 사이트 전체를 크롤링
2. 각 페이지마다 markdown + html + screenshot + links 포맷으로 수집
3. 결과를 로컬 폴더에 저장

### 코드 구조

import Firecrawl from 'firecrawl-js';
import fs from 'fs/promises';
import path from 'path';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

// 테스트 대상: 난이도별 3개 병원
const TEST_HOSPITALS = [
  { name: '바노바기피부과', url: 'https://www.skinbanobagi.com/web' },
  { name: '톡스앤필강서', url: 'https://www.toxnfill32.com/' },
  { name: '815의원', url: 'https://www.815clinic.co.kr/' },
];

async function captureHospital(app: Firecrawl, hospital: {name: string, url: string}) {
  const startTime = Date.now();
  console.log(`\n=== ${hospital.name} 캡처 시작 ===`);
  console.log(`URL: ${hospital.url}`);

  try {
    // 1. Map: 사이트 URL 구조 파악 (1크레딧)
    console.log('[1/3] 사이트 맵 수집 중...');
    const mapResult = await app.map(hospital.url);
    const allUrls = mapResult?.links || [];
    console.log(`발견된 URL: ${allUrls.length}개`);
    
    // 시술/장비/이벤트 관련 URL 필터링
    const relevantPatterns = [
      /시술|treatment|service|진료|클리닉|clinic/i,
      /장비|equipment|device|기기/i,
      /이벤트|event|프로모션|promotion|할인/i,
      /의료진|doctor|staff|원장/i,
      /소개|about|info/i,
      /가격|price|비용|cost/i,
    ];
    
    const relevantUrls = allUrls.filter(url => 
      relevantPatterns.some(p => p.test(url))
    );
    console.log(`관련 URL (필터링): ${relevantUrls.length}개`);
    
    // URL 전체 목록 출력
    console.log('\n--- 발견된 전체 URL ---');
    allUrls.forEach((url, i) => console.log(`  ${i+1}. ${url}`));
    console.log('--- 필터링된 URL ---');
    relevantUrls.forEach((url, i) => console.log(`  ★ ${i+1}. ${url}`));

    // 2. Crawl: 사이트 크롤링 (페이지당 1~1.5크레딧)
    console.log('\n[2/3] 사이트 크롤링 중...');
    const crawlResult = await app.crawl(hospital.url, {
      limit: 15,  // 서브페이지 최대 15개 (테스트니까 제한)
      scrapeOptions: {
        formats: ['markdown', 'html', 'screenshot', 'links'],
        onlyMainContent: true,  // 네비게이션/푸터 제외
      }
    });

    const pages = crawlResult?.data || [];
    console.log(`크롤링 완료: ${pages.length}페이지`);

    // 3. 로컬 저장
    console.log('\n[3/3] 로컬 저장 중...');
    const today = new Date().toISOString().split('T')[0];
    const saveDir = path.join('snapshots', today, hospital.name.replace(/\s/g, '_'));
    await fs.mkdir(saveDir, { recursive: true });
    await fs.mkdir(path.join(saveDir, 'screenshots'), { recursive: true });

    // 메타 정보 저장
    const meta = {
      hospital_name: hospital.name,
      url: hospital.url,
      captured_at: new Date().toISOString(),
      total_urls_found: allUrls.length,
      relevant_urls: relevantUrls.length,
      pages_crawled: pages.length,
      all_urls: allUrls,
      relevant_urls_list: relevantUrls,
    };
    await fs.writeFile(
      path.join(saveDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );

    // 각 페이지 저장
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const pageDir = path.join(saveDir, `page-${String(i).padStart(3, '0')}`);
      await fs.mkdir(pageDir, { recursive: true });

      // 페이지 메타
      await fs.writeFile(
        path.join(pageDir, 'metadata.json'),
        JSON.stringify(page.metadata || {}, null, 2)
      );

      // Markdown 저장
      if (page.markdown) {
        await fs.writeFile(
          path.join(pageDir, 'content.md'),
          page.markdown
        );
      }

      // HTML 저장
      if (page.html) {
        await fs.writeFile(
          path.join(pageDir, 'content.html'),
          page.html
        );
      }

      // 스크린샷 저장 (base64 → PNG)
      if (page.screenshot) {
        // Firecrawl 스크린샷은 URL로 반환됨
        // URL이면 다운로드, base64면 디코딩
        const screenshotPath = path.join(saveDir, 'screenshots', `page-${String(i).padStart(3, '0')}.png`);
        if (page.screenshot.startsWith('http')) {
          // URL인 경우 다운로드
          const response = await fetch(page.screenshot);
          const buffer = Buffer.from(await response.arrayBuffer());
          await fs.writeFile(screenshotPath, buffer);
        } else {
          // base64인 경우
          const buffer = Buffer.from(page.screenshot, 'base64');
          await fs.writeFile(screenshotPath, buffer);
        }
      }

      // 링크 목록 저장
      if (page.links) {
        await fs.writeFile(
          path.join(pageDir, 'links.json'),
          JSON.stringify(page.links, null, 2)
        );
      }

      const url = page.metadata?.sourceURL || page.metadata?.url || '(unknown)';
      const mdLen = page.markdown?.length || 0;
      const hasScreenshot = !!page.screenshot;
      console.log(`  page-${i}: ${url}`);
      console.log(`    markdown: ${mdLen}자, screenshot: ${hasScreenshot ? '✅' : '❌'}, links: ${page.links?.length || 0}개`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ ${hospital.name} 완료 (${elapsed}초, ${pages.length}페이지)`);
    console.log(`저장 위치: ${saveDir}`);

    return {
      name: hospital.name,
      success: true,
      pages: pages.length,
      urls_found: allUrls.length,
      elapsed: parseFloat(elapsed),
    };

  } catch (error) {
    console.error(`❌ ${hospital.name} 실패: ${error.message}`);
    return {
      name: hospital.name,
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  if (!FIRECRAWL_API_KEY) {
    console.error('FIRECRAWL_API_KEY 환경변수가 설정되지 않았습니다.');
    console.error('.env 파일에 FIRECRAWL_API_KEY=fc-xxx 를 추가하세요.');
    process.exit(1);
  }

  const app = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });
  
  console.log('=================================');
  console.log('Firecrawl 병원 사이트 캡처 테스트');
  console.log(`테스트 대상: ${TEST_HOSPITALS.length}개 병원`);
  console.log(`예상 크레딧: ~${TEST_HOSPITALS.length * 17}크레딧 (map 1 + crawl 15 × 1.0 = 16/병원)`);
  console.log('=================================\n');

  const results = [];
  for (const hospital of TEST_HOSPITALS) {
    const result = await captureHospital(app, hospital);
    results.push(result);
    
    // 병원 간 간격
    if (TEST_HOSPITALS.indexOf(hospital) < TEST_HOSPITALS.length - 1) {
      console.log('\n--- 10초 대기 ---\n');
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // 종합 보고
  console.log('\n=================================');
  console.log('종합 결과');
  console.log('=================================');
  for (const r of results) {
    if (r.success) {
      console.log(`✅ ${r.name}: ${r.pages}페이지 캡처, ${r.urls_found}개 URL 발견 (${r.elapsed}초)`);
    } else {
      console.log(`❌ ${r.name}: ${r.error}`);
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const totalPages = results.filter(r => r.success).reduce((s, r) => s + (r.pages || 0), 0);
  console.log(`\n성공: ${successCount}/${results.length}`);
  console.log(`총 페이지: ${totalPages}`);
  console.log(`예상 크레딧 사용: ~${totalPages + results.length}크레딧`);
  console.log(`\n캡처된 파일은 ./snapshots/ 폴더에서 확인하세요.`);
}

main();

### 실행 방법
npx tsx scripts/crawler/firecrawl-capture-test.ts

### 보고 형식

각 병원에 대해:
1. Map에서 발견된 전체 URL 목록
2. 관련 URL(시술/장비/이벤트) 필터링 결과
3. 크롤링된 페이지 수와 각 페이지의 markdown 길이
4. 스크린샷 저장 성공 여부
5. 저장된 파일 구조

테스트 완료 후:
- snapshots 폴더 구조를 tree로 출력해
- 바노바기피부과의 markdown에서 장비명이 몇 개나 언급되는지 간단히 grep해서 보고해
  (써마지, 울쎄라, 인모드, 슈링크, 리프테라, 포텐자 등)
- 현재 파이프라인(Playwright 직접 크롤링)과 비교해서 어떤 차이가 있는지 의견을 말해
```

---

## 참고사항

### 크레딧 소비 예상
- Map: 1크레딧/사이트
- Crawl: 1크레딧/페이지 (스크린샷 포함 시 1.5)
- 3개 병원 × (1 + 15×1.5) ≈ **70크레딧**
- 무료 500크레딧 중 70 사용 → 430 남음

### 이 테스트로 검증할 것
1. Firecrawl이 한국 피부과 사이트를 제대로 크롤링하는가?
2. 서브페이지(시술안내, 장비소개, 이벤트)를 자동으로 찾는가?
3. 스크린샷 품질이 Playwright 직접 캡처 대비 어떤가?
4. Markdown 변환 품질은? (특히 이미지 배너 텍스트)
5. 팝업/모달 처리가 되는가?
6. SPA(톡스앤필, 이지함) 사이트도 잘 되는가?

### 테스트 대상 선정 이유
- 바노바기피부과: 이미지 배너 중심 + 장비 정보 풍부 → 핵심 벤치마크
- 톡스앤필 강서: 1차 테스트 완전 실패 사이트 → 모바일 SPA
- 815의원: 1차 테스트 성공 사이트 → 기준점 비교용
