import { detectTorrRf } from './v5/torr-detector.js';

const result = detectTorrRf(
  '병원에서 토르 RF 리프팅과 써마지FLX를 함께 사용합니다. TORR Comfort Dual도 보유. MPR 리프팅 가능.',
  [{ url: 'https://example.com/torr', markdown: '토르리프팅 소개 페이지', pageType: 'treatment' }]
);

console.log('detected:', result.detected);
console.log('confidence:', result.confidence);
console.log('products:', result.products_found);
console.log('evidence count:', result.evidence.length);
for (const e of result.evidence.slice(0, 5)) {
  console.log(`  [${e.source}] "${e.keyword}" → ${e.context?.slice(0, 50) || e.url || ''}`);
}
console.log('\nTORR detector test PASSED');
