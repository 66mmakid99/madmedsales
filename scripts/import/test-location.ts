import { extractLocation } from './lib/location-extractor.js';

const cases = [
  '닥터쁘띠의원강남점',
  '샤인빔의원송도점',
  '유앤아이의원여의도점',
  '아비쥬의원강남점',
  '닥터쁘띠의원 대전점',
  '닥터쁘띠의원 홍대점',
  '새봄여성의원_광주_남구',
  '클래스원의원_강남',
  '노원,닥터쁘띠의원',
  '강남,리베르의원',
  '애플산부인과 명동점',
  '샤인빔의원_경남_창원',
  '더 치유의원_울산_남구',
];

console.log('=== location-extractor 검증 ===\n');
for (const c of cases) {
  const hint = extractLocation(c);
  console.log(`"${c}"`);
  console.log(`  → sido=[${hint.sido ?? ''}] sigungu=[${hint.sigungu ?? ''}] raw=[${hint.raw ?? ''}]\n`);
}
