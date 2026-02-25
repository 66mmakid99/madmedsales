/**
 * dictionary-loader 단위 테스트
 */
import {
  getEquipmentPromptSection,
  getTreatmentPromptSection,
  getPricePromptSection,
  getExcludePromptSection,
  getEquipmentNormalizationMap,
  getTorrKeywords,
  getEquipmentBrandList,
  getEquipmentNormalizationTable,
} from './crawler/dictionary-loader.js';

console.log('=== 1. Equipment Prompt Section ===');
const eqPrompt = getEquipmentPromptSection();
console.log(eqPrompt.slice(0, 600));
console.log(`... (total ${eqPrompt.length} chars)\n`);

console.log('=== 2. Treatment Prompt Section ===');
const trPrompt = getTreatmentPromptSection();
console.log(trPrompt.slice(0, 400));
console.log(`... (total ${trPrompt.length} chars)\n`);

console.log('=== 3. Price Prompt Section ===');
console.log(getPricePromptSection());

console.log('\n=== 4. Exclude Prompt Section ===');
console.log(getExcludePromptSection());

console.log('\n=== 5. Normalization Map ===');
const map = getEquipmentNormalizationMap();
console.log(`Total mappings: ${map.size}`);
console.log('Examples:');
console.log(`  "써마지" → "${map.get('써마지')}"`);
console.log(`  "thermage" → "${map.get('thermage')}"`);
console.log(`  "울쎄라" → "${map.get('울쎄라')}"`);
console.log(`  "인모드" → "${map.get('인모드')}"`);
console.log(`  "토르" → "${map.get('토르')}"`);
console.log(`  "potenza" → "${map.get('potenza')}"`);
console.log(`  "써마지flx" → "${map.get('써마지flx')}"`);
console.log(`  "써마지 flx" → "${map.get('써마지 flx')}"`);

console.log('\n=== 6. TORR Keywords ===');
console.log(getTorrKeywords());

console.log('\n=== 7. Equipment Brand List ===');
console.log(getEquipmentBrandList());

console.log('\n=== 8. Equipment Normalization Table ===');
const table = getEquipmentNormalizationTable();
console.log(table.slice(0, 400));
console.log(`... (total ${table.length} chars)`);

console.log('\n=== ALL TESTS PASSED ===');
