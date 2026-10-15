// Command-line check of the parser: node scripts/split.mjs path/to/MyBill.pdf
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const { extractPages, parseBill, splitBill, formatCents } = require('../billparser.js');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/split.mjs path/to/MyBill.pdf');
  process.exit(2);
}
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
const parsed = parseBill(await extractPages(doc));
const result = splitBill(parsed);

console.log(`Billing period: ${parsed.meta.period}   Account-wide charges: ${formatCents(result.accountWide)} split ${result.groups.length} ways\n`);
for (const g of result.groups) {
  const lines = g.lines.map((l) => `${l.name} (${l.device})`).join(' + ');
  console.log(`${g.name.padEnd(20)} ${g.phone}  ${formatCents(g.lineTotal).padStart(9)} + ${formatCents(g.accountShare).padStart(7)} = ${formatCents(g.total).padStart(9)}   ${lines}`);
}
console.log(`\nTotal ${formatCents(result.groups.reduce((s, g) => s + g.total, 0))}`);
for (const c of result.checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.text}`);
process.exit(result.ok ? 0 : 1);
