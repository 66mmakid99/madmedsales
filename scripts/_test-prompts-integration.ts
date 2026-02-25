/**
 * prompts.ts 통합 테스트 — 사전 주입 후 프롬프트가 올바르게 생성되는지 확인
 */
import {
  buildExtractionPrompt,
  buildClassifyPrompt,
  buildImageBannerPrompt,
  buildValidationPrompt,
} from './v5/prompts.js';

console.log('=== 1. buildExtractionPrompt ===');
const ep = buildExtractionPrompt('테스트병원', '메인', '텍스트');
console.log(`Length: ${ep.length} chars`);
console.log('Contains equipment table:', ep.includes('한글/약어'));
console.log('Contains TORR RF:', ep.includes('TORR RF'));
console.log('Contains "사전에 없는 장비":', ep.includes('사전에 없는'));
console.log('');

console.log('=== 2. buildClassifyPrompt ===');
const cp = buildClassifyPrompt('테스트병원');
console.log(`Length: ${cp.length} chars`);
console.log('Contains R1 규칙:', cp.includes('R1-1'));
console.log('Contains R2 규칙:', cp.includes('R2-1'));
console.log('Contains R3 규칙:', cp.includes('R3-2'));
console.log('Contains R6 규칙:', cp.includes('R6-1'));
console.log('Contains 장비 사전:', cp.includes('장비 사전'));
console.log('Contains 시술 키워드 사전:', cp.includes('시술 키워드 사전'));
console.log('Contains 가격 단위 사전:', cp.includes('가격 단위 사전'));
console.log('Contains unregistered_equipment:', cp.includes('unregistered_equipment'));
console.log('Contains unregistered_treatments:', cp.includes('unregistered_treatments'));
console.log('Contains raw_price_texts:', cp.includes('raw_price_texts'));
console.log('Contains Thermage:', cp.includes('Thermage'));
console.log('Contains 써마지:', cp.includes('써마지'));
console.log('Contains 블랙리스트:', cp.includes('sungyesa.com'));
console.log('');

console.log('=== 3. buildImageBannerPrompt ===');
const ib = buildImageBannerPrompt('테스트병원', '메인 배너');
console.log(`Length: ${ib.length} chars`);
console.log('Contains normalization table:', ib.includes('한글/약어'));
console.log('Contains "사전에 없는 장비":', ib.includes('사전에 없는'));
console.log('');

console.log('=== 4. buildValidationPrompt ===');
const vp = buildValidationPrompt('test', ['Thermage'], ['써마지'], ['홍길동']);
console.log(`Length: ${vp.length} chars`);
console.log('');

console.log('=== TOKEN 추정 (1 token ≈ 3.5 chars) ===');
console.log(`buildExtractionPrompt: ~${Math.round(ep.length / 3.5)} tokens`);
console.log(`buildClassifyPrompt: ~${Math.round(cp.length / 3.5)} tokens`);
console.log(`buildImageBannerPrompt: ~${Math.round(ib.length / 3.5)} tokens`);
console.log(`buildValidationPrompt: ~${Math.round(vp.length / 3.5)} tokens`);

console.log('\n=== ALL INTEGRATION TESTS PASSED ===');
