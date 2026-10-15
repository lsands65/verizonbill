// Parses a Verizon "MyBill" PDF (text extracted with pdf.js) and splits it per phone number.
// Works in the browser (global `BillParser`) and in Node (require); it only needs pdf.js text items.
(function (root) {

  const AMOUNT_RE = /(-?)\$([\d,]*\.\d{2})$/;
  const PHONE_RE = /^(\d{3})-(\d{3})-(\d{4})\b(.*)$/;
  // The right-hand "notes" column on detail pages starts around x=387; charges live left of it.
  const DETAIL_COLUMN_MAX_X = 370;

  const toCents = (sign, digits) => (sign === '-' ? -1 : 1) * Math.round(parseFloat(digits.replace(/,/g, '')) * 100);
  const formatCents = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  // Extract positioned text items from a pdf.js document.
  async function extractPages(pdfDoc) {
    const pages = [];
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) })));
    }
    return pages;
  }

  // Group text items into visual rows (top to bottom), joining glyphs that pdf.js split apart.
  function buildRows(items) {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of sorted) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
      if (row) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      const its = r.items.sort((a, b) => a.x - b.x);
      let text = '';
      let end = null;
      for (const it of its) {
        const gap = end === null ? 0 : it.x - end;
        if (end !== null && gap > Math.max(1.5, (it.h || 8) * 0.2)) text += ' ';
        text += it.str;
        end = it.x + (it.w || 0);
      }
      text = text.replace(/\s+/g, ' ').trim();
      const m = text.match(AMOUNT_RE);
      return {
        y: r.y,
        text,
        label: m ? text.slice(0, m.index).replace(/(\s*-?\$[\d,]*\.\d{2})+$/, '').trim() : text,
        amount: m ? toCents(m[1], m[2]) : null,
      };
    });
  }

  function parseBill(pages) {
    const fullRows = pages.map(buildRows);
    const allText = fullRows.flat().map((r) => r.text);

    const meta = {};
    for (const t of allText) {
      let m;
      if (!meta.account && (m = t.match(/Account:\s*([\d-]+)/))) meta.account = m[1];
      if (!meta.period && (m = t.match(/Billing period:\s*(.+?\d{4})/))) meta.period = m[1];
      if (!meta.invoice && (m = t.match(/Invoice:\s*(\d+)/))) meta.invoice = m[1];
    }
    const findAmount = (re) => {
      for (const r of fullRows.flat()) if (r.amount !== null && re.test(r.label)) return r.amount;
      return null;
    };
    meta.monthCharges = findAmount(/^This month'?s charges$/i);
    meta.previousBalance = findAmount(/^Balance from last bill$/i);
    meta.summaryTotal = findAmount(/^Total:$/);
    meta.totalDue = findAmount(/^Total due/i);

    // Line-item detail pages: "Charges by line details" (and its "(continued)" pages).
    const detailRows = [];
    pages.forEach((items, i) => {
      if (!fullRows[i].some((r) => /^Charges by line details/i.test(r.text))) return;
      const rows = buildRows(items.filter((it) => it.x < DETAIL_COLUMN_MAX_X));
      const start = rows.findIndex((r) => /^Charges by line details/i.test(r.text));
      detailRows.push(...rows.slice(start + 1));
    });

    let accountWide = 0;
    let accountWideItems = [];
    const lines = [];
    let current = null;
    for (let i = 0; i < detailRows.length; i++) {
      const row = detailRows[i];
      if (/^Account-wide charges/i.test(row.label) && row.amount !== null) {
        accountWide = row.amount;
        current = { items: accountWideItems };
        continue;
      }
      // A line header is "Name  $total" followed (within 2 rows) by the device and the phone number.
      if (row.amount !== null) {
        const next = detailRows.slice(i + 1, i + 3);
        const phoneIdx = next.findIndex((r) => r.amount === null && PHONE_RE.test(r.text));
        if (phoneIdx !== -1) {
          const pm = next[phoneIdx].text.match(PHONE_RE);
          const device = phoneIdx === 1 ? next[0].text : '';
          current = {
            name: row.label,
            total: row.amount,
            device,
            phone: `${pm[1]}-${pm[2]}-${pm[3]}`,
            note: pm[4].replace(/[()]/g, '').trim(),
            items: [],
          };
          lines.push(current);
          i += phoneIdx + 1;
          continue;
        }
        if (current && row.label) current.items.push({ label: row.label, amount: row.amount });
      }
    }

    return { meta, accountWide, accountWideItems, lines };
  }

  // Split the bill: lines sharing a phone number are combined, and account-wide charges are
  // divided evenly across those combined groups (leftover pennies go to the first groups).
  function splitBill(parsed) {
    const groups = [];
    for (const line of parsed.lines) {
      let g = groups.find((x) => x.phone === line.phone);
      if (!g) groups.push((g = { phone: line.phone, lines: [], lineTotal: 0 }));
      g.lines.push(line);
      g.lineTotal += line.total;
    }
    for (const g of groups) {
      const primary = g.lines.find((l) => !/number share/i.test(l.note)) || g.lines[0];
      g.name = primary.name;
    }
    const n = groups.length;
    const base = n ? Math.trunc(parsed.accountWide / n) : 0;
    let remainder = parsed.accountWide - base * n;
    const step = Math.sign(remainder);
    for (const g of groups) {
      g.accountShare = base;
      if (remainder !== 0) { g.accountShare += step; remainder -= step; }
      g.total = g.lineTotal + g.accountShare;
    }

    const linesSum = parsed.lines.reduce((s, l) => s + l.total, 0);
    const computed = linesSum + parsed.accountWide;
    const expected = parsed.meta.monthCharges ?? parsed.meta.summaryTotal;
    const checks = [];
    if (expected !== null && expected !== undefined) {
      checks.push({ ok: computed === expected, text: `Lines + account-wide charges = ${formatCents(computed)}; bill says ${formatCents(expected)}` });
    } else {
      checks.push({ ok: false, text: "Couldn't find this month's charges on the bill to verify against" });
    }
    return { groups, accountWide: parsed.accountWide, computed, expected, checks, ok: checks.every((c) => c.ok) };
  }

  const api = { extractPages, buildRows, parseBill, splitBill, formatCents, toCents };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BillParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
