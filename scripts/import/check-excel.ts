import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const filePath = process.argv[2] ?? path.resolve(__dirname, '../../madmedsales_병원-이메일-이름-주소aasdsf.xlsx');

const wb = XLSX.readFile(filePath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

console.log('Sheet:', wb.SheetNames[0]);
console.log('Total rows:', rows.length);
console.log('Headers:', rows[0]);
console.log('\nSample rows (2-5):');
rows.slice(1, 5).forEach((r, i) => console.log(`  [${i+2}]`, r));
