// Builds the weekly expense report .xlsx in the browser (ExcelJS, bundled in /vendor).

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function imageSize(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 600, h: 900 }); };
    img.src = url;
  });
}

const MONEY = '"$"#,##0.00';

// "2026-11-28" -> "11/28/26"
export function weLabel(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}
// File-name safe version: "WE 11-28-26" (phones/Windows don't allow "/")
export function weFilePrefix(iso) {
  return 'WE ' + weLabel(iso).replace(/\//g, '-');
}
export function receiptId(i) {
  return `Receipt ${String(i + 1).padStart(2, '0')}`;
}
export function receiptFileName(i, weIso) {
  return `${weIso ? weFilePrefix(weIso) + ' ' : ''}${receiptId(i)}.jpg`;
}

// expenses: sorted array. Returns a Blob.
export async function buildWorkbook({ expenses, settings, periodStart, periodEnd }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = settings.name || 'Expense App';
  wb.created = new Date();

  const ws = wb.addWorksheet('Expense Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { key: 'num', width: 11 },
    { key: 'date', width: 12 },
    { key: 'merchant', width: 26 },
    { key: 'category', width: 17 },
    { key: 'description', width: 30 },
    { key: 'payment', width: 17 },
    { key: 'subtotal', width: 12 },
    { key: 'tax', width: 10 },
    { key: 'tip', width: 10 },
    { key: 'total', width: 12 },
    { key: 'notes', width: 30 },
  ];

  ws.mergeCells('A1:K1');
  ws.getCell('A1').value = 'EXPENSE REPORT';
  ws.getCell('A1').font = { size: 16, bold: true };
  ws.getCell('A2').value = 'Employee:';
  ws.getCell('B2').value = settings.name || '';
  ws.getCell('A3').value = 'Email:';
  ws.getCell('B3').value = settings.email || '';
  ws.getCell('A4').value = 'Week ending:';
  ws.getCell('B4').value = `WE ${weLabel(periodEnd)}   (${weLabel(periodStart)} – ${weLabel(periodEnd)})`;
  ['A2', 'A3', 'A4'].forEach((a) => (ws.getCell(a).font = { bold: true }));

  const headerRow = 6;
  const headers = ['Receipt #', 'Date', 'Merchant', 'Category', 'Description / Purpose', 'Payment', 'Subtotal', 'Tax', 'Tip', 'Total', 'Notes'];
  const hr = ws.getRow(headerRow);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = { bottom: { style: 'thin' } };
  });
  hr.height = 20;

  expenses.forEach((e, i) => {
    const r = ws.getRow(headerRow + 1 + i);
    r.values = [
      receiptId(i),
      e.date ? new Date(e.date + 'T12:00:00') : null,
      e.merchant || '',
      e.category || '',
      e.description || '',
      e.payment || '',
      e.subtotal ?? null,
      e.tax ?? null,
      e.tip ?? null,
      e.total ?? 0,
      e.notes || '',
    ];
    r.getCell(2).numFmt = 'mm/dd/yyyy';
    [7, 8, 9, 10].forEach((c) => (r.getCell(c).numFmt = MONEY));
    r.alignment = { vertical: 'top', wrapText: true };
    if (i % 2) r.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }));
  });

  const first = headerRow + 1;
  const last = headerRow + Math.max(1, expenses.length);
  const totalRowNum = last + 1;
  const tr = ws.getRow(totalRowNum);
  tr.getCell(9).value = 'TOTAL';
  tr.getCell(10).value = {
    formula: `SUM(J${first}:J${last})`,
    result: +expenses.reduce((s, e) => s + (Number(e.total) || 0), 0).toFixed(2),
  };
  tr.getCell(10).numFmt = MONEY;
  tr.font = { bold: true };
  tr.getCell(10).border = { top: { style: 'thin' }, bottom: { style: 'double' } };

  // Totals by category
  let row = totalRowNum + 2;
  ws.getCell(`I${row}`).value = 'By category';
  ws.getCell(`I${row}`).font = { bold: true };
  const cats = [...new Set(expenses.map((e) => e.category || 'Other'))].sort();
  for (const cat of cats) {
    row++;
    ws.getCell(`I${row}`).value = cat;
    ws.getCell(`J${row}`).value = {
      formula: `SUMIF(D${first}:D${last},"${cat.replace(/"/g, '""')}",J${first}:J${last})`,
      result: +expenses.filter((e) => (e.category || 'Other') === cat).reduce((s, e) => s + (Number(e.total) || 0), 0).toFixed(2),
    };
    ws.getCell(`J${row}`).numFmt = MONEY;
  }

  // Personal card / cash = owed back to employee
  row += 2;
  ws.getCell(`I${row}`).value = 'Paid personally (reimburse)';
  ws.getCell(`I${row}`).font = { bold: true };
  ws.getCell(`J${row}`).value = +expenses
    .filter((e) => e.payment && e.payment !== 'Company card')
    .reduce((s, e) => s + (Number(e.total) || 0), 0)
    .toFixed(2);
  ws.getCell(`J${row}`).numFmt = MONEY;
  ws.getCell(`J${row}`).font = { bold: true };

  row += 3;
  ws.getCell(`A${row}`).value = 'Employee signature: ______________________';
  ws.getCell(`F${row}`).value = 'Approved by: ______________________';

  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  // Second sheet with the receipt photos
  const ps = wb.addWorksheet('Receipts');
  ps.getColumn(1).width = 90;
  let y = 0; // row index (0-based) where next image goes
  const ROW_PX = 20;
  for (let i = 0; i < expenses.length; i++) {
    const e = expenses[i];
    const label = ps.getRow(y + 1);
    label.getCell(1).value = `${receiptId(i)} — ${e.merchant || ''} — ${e.date || ''} — $${(Number(e.total) || 0).toFixed(2)}`;
    label.font = { bold: true, size: 12 };
    y += 1;
    if (e.photo) {
      const { w, h } = await imageSize(e.photo);
      const targetW = 450;
      const targetH = Math.round((h / w) * targetW);
      const id = wb.addImage({ base64: await blobToBase64(e.photo), extension: 'jpeg' });
      ps.addImage(id, { tl: { col: 0, row: y }, ext: { width: targetW, height: targetH } });
      y += Math.ceil(targetH / ROW_PX) + 2;
    } else {
      y += 1;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
