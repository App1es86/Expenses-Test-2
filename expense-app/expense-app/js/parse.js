// Turns raw OCR text from a receipt into expense fields.
// Pure functions only (no browser APIs) so it can be unit-tested with Node.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// Amount like 12.34, 1,234.56, $ 12.34, 12,34 (OCR often turns "." into ",")
const AMOUNT_RE = /(?<![\d.])(\d{1,3}(?:,\d{3})+|\d+)\s?[.,]\s?(\d{2})(?![\d])/g;

export function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const v = parseFloat(m[1].replace(/,/g, '') + '.' + m[2]);
    if (!isNaN(v)) out.push(v);
  }
  return out;
}

function lastAmount(line) {
  const a = amountsIn(line);
  return a.length ? a[a.length - 1] : null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function validDate(y, m, d) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function findDate(text) {
  let m;
  // 2026-11-24 or 2026/11/24
  if ((m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) {
    const r = validDate(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  // 11/24/2026, 11-24-26 (US month-first)
  for (const mm of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
    let r = validDate(+mm[3], +mm[1], +mm[2]);
    if (!r) r = validDate(+mm[3], +mm[2], +mm[1]); // fall back to day-first
    if (r) return r;
  }
  // Nov 24, 2026 / November 24 2026
  if ((m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})\b/))) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) { const r = validDate(+m[3], mon, +m[2]); if (r) return r; }
  }
  // 24 Nov 2026
  if ((m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})\b/))) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) { const r = validDate(+m[3], mon, +m[1]); if (r) return r; }
  }
  return '';
}

const NOT_MERCHANT = /(receipt|invoice|welcome|thank|store\s*#|tel|phone|www\.|http|\.com|street|\bst\b|\bave\b|\brd\b|blvd|suite|order|table|server|cashier|date|time)/i;

export function findMerchant(lines) {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/[^A-Za-z0-9&'.\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 3) continue;
    if (letters / line.length < 0.5) continue; // mostly numbers/junk
    if (NOT_MERCHANT.test(line)) continue;
    // Title-case shouty receipt headers: "SHELL OIL" -> "Shell Oil"
    return line === line.toUpperCase()
      ? line.toLowerCase().replace(/(^|[\s&\-])(\w)/g, (m, sep, c) => sep + c.toUpperCase())
      : line;
  }
  return '';
}

const CATEGORY_RULES = [
  ['Fuel', /\b(shell|chevron|exxon|mobil|bp|texaco|sunoco|valero|marathon|citgo|speedway|phillips 66|conoco|arco|circle k|wawa|sheetz|pilot|flying j|love'?s|fuel|gasoline|diesel|unleaded|gallons?|gal)\b/i],
  ['Lodging', /\b(hotel|motel|inn|suites|resort|marriott|hilton|hyatt|holiday inn|hampton|best western|lodging|room rate|airbnb)\b/i],
  ['Travel', /\b(airline|airlines|flight|boarding|uber|lyft|taxi|cab|parking|toll|rental car|hertz|enterprise|avis|amtrak|transit)\b/i],
  ['Meals', /\b(restaurant|grill|cafe|café|coffee|starbucks|mcdonald'?s|subway|pizza|burger|diner|bar|kitchen|taco|wendy'?s|chipotle|bistro|tip|gratuity|server|table)\b/i],
  ['Tools & Supplies', /\b(home depot|lowe'?s|menards|hardware|ace|harbor freight|grainger|fastenal|lumber|tool|tools)\b/i],
  ['Office', /\b(staples|office depot|officemax|paper|ink|toner|printing|fedex|ups|usps|postage|shipping)\b/i],
];

export function guessCategory(text) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return 'Other';
}

export function findPayment(text) {
  if (/\b(visa)\b/i.test(text)) return 'Card - Visa';
  if (/\b(master\s?card|mc)\b/i.test(text)) return 'Card - Mastercard';
  if (/\b(amex|american express)\b/i.test(text)) return 'Card - Amex';
  if (/\b(discover)\b/i.test(text)) return 'Card - Discover';
  if (/\b(debit)\b/i.test(text)) return 'Card - Debit';
  if (/\b(cash)\b/i.test(text) && !/cash\s*back/i.test(text)) return 'Cash';
  return '';
}

export function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let total = null, subtotal = null, tax = null, tip = null;

  // Best "total" line, in order of preference.
  const totalPatterns = [
    /\b(grand\s*total|total\s*due|amount\s*due|balance\s*due|total\s*amount|amount\s*paid)\b/i,
    /(?<!sub\s?-?)\btotal\b/i,
  ];
  for (const re of totalPatterns) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (re.test(lines[i]) && !/sub\s?-?total/i.test(lines[i]) && !/\btotal\s*(tax|savings|items?)\b/i.test(lines[i])) {
        // Amount may be on the same line, or OCR may push it to the next line.
        const v = lastAmount(lines[i]) ?? (lines[i + 1] ? lastAmount(lines[i + 1]) : null);
        if (v != null) { total = v; break; }
      }
    }
    if (total != null) break;
  }

  for (const line of lines) {
    if (subtotal == null && /sub\s?-?total/i.test(line)) subtotal = lastAmount(line);
    if (tax == null && /\b(sales\s*tax|tax|gst|hst|pst|vat)\b/i.test(line) && !/total\s*tax\s*free|tax\s*id/i.test(line)) tax = lastAmount(line);
    if (tip == null && /\b(tip|gratuity)\b/i.test(line)) tip = lastAmount(line);
  }

  // No labelled total: the largest amount on the receipt is the best guess.
  if (total == null) {
    const all = lines.flatMap(amountsIn).filter((v) => v < 100000);
    if (all.length) total = Math.max(...all);
  }
  if (total == null && subtotal != null) total = +(subtotal + (tax || 0) + (tip || 0)).toFixed(2);

  // Cross-check: if subtotal + tax + tip doesn't equal the total, one of the
  // numbers was probably misread. Flag it so the person double-checks.
  let mismatch = false;
  if (total != null && subtotal != null && (tax != null || tip != null)) {
    const sum = +(subtotal + (tax || 0) + (tip || 0)).toFixed(2);
    mismatch = Math.abs(sum - total) > 0.005 && Math.abs(subtotal + (tax || 0) - total) > 0.005;
  }

  return {
    mismatch,
    merchant: findMerchant(lines),
    date: findDate(text),
    subtotal, tax, tip, total,
    payment: findPayment(text),
    category: guessCategory(text),
  };
}
