import { db, getSettings, saveSettings, newId, requestPersistence } from './db.js';
import { preparePhoto, readReceipt } from './ocr.js';
import { buildWorkbook, receiptFileName, weLabel, weFilePrefix } from './excel.js';
import { shareFiles, canShareFiles, downloadFile } from './share.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let settings;
let editing = null; // expense being reviewed/edited
let sendCtx = null; // { expenses, report?, files, start, end }

// ---------- helpers ----------
function localISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}
// The "WE" date for a day: the next week-end day (default Saturday) on or after it.
function weekEndingFor(iso) {
  const day = new Date(iso + 'T12:00:00').getDay();
  return addDays(iso, (settings.weekEndDay - day + 7) % 7);
}
function currentPeriod() {
  const end = weekEndingFor(localISO());
  return { start: addDays(end, -6), end };
}
// WE date for a set of unsent receipts: the week of the newest receipt,
// so a report sent late (e.g. Monday) still gets last week's WE date.
function periodFor(expenses) {
  const latest = expenses.reduce((m, e) => (e.date && e.date > m ? e.date : m), '');
  const end = latest ? weekEndingFor(latest) : currentPeriod().end;
  return { start: addDays(end, -6), end };
}
function niceDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function money(n) {
  return (Number(n) || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
function num(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : +n.toFixed(2);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeName(s) {
  return (s || 'Employee').replace(/[^A-Za-z0-9 .'-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Employee';
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const urls = new Set();
function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}
function freeUrls() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

async function unsentExpenses() {
  const all = await db.all('expenses');
  return all.filter((e) => !e.reportId).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
}

// ---------- navigation ----------
const TITLES = { home: 'This Week', review: 'Receipt', send: 'Send Week', history: 'History', settings: 'Settings' };
let current = 'home';

async function go(view, opts = {}) {
  current = view;
  $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
  $('#title').textContent = opts.title || TITLES[view];
  $('#backBtn').hidden = !['review', 'send'].includes(view);
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.go === view));
  window.scrollTo(0, 0);
  if (view === 'home') await renderHome();
  if (view === 'history') await renderHistory();
  if (view === 'settings') renderSettings();
  if (view === 'send') await renderSend(opts.reportId);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) { e.preventDefault(); go(t.dataset.go); }
});
$('#backBtn').addEventListener('click', () => go(sendCtx?.report ? 'history' : 'home'));

// ---------- home ----------
async function renderHome() {
  freeUrls();
  const list = await unsentExpenses();
  const { start, end } = currentPeriod();
  const total = list.reduce((s, e) => s + (Number(e.total) || 0), 0);

  $('#weekRange').textContent = `WE ${weLabel(end)}  ·  ${niceDate(start)} – ${niceDate(end)}`;
  $('#weekTotal').textContent = money(total);
  $('#weekCount').textContent = list.length ? `${list.length} receipt${list.length > 1 ? 's' : ''} not yet sent` : 'No receipts yet';
  $('#emptyHint').hidden = list.length > 0;
  $('#sendBtn').disabled = list.length === 0;

  const isReportDay = new Date().getDay() === settings.reportDay;
  const overdue = list.some((e) => e.date && e.date < start);
  $('#fridayBanner').hidden = !(list.length && (isReportDay || overdue));
  $('#setupBanner').hidden = !!(settings.name && settings.email);

  const ul = $('#expenseList');
  ul.innerHTML = '';
  for (const e of [...list].reverse()) {
    const li = document.createElement('li');
    li.innerHTML = `
      ${e.photo ? `<img src="${blobUrl(e.photo)}" alt="">` : '<div class="noimg">✏️</div>'}
      <div class="grow">
        <div class="t">${esc(e.merchant || 'Unnamed expense')}</div>
        <div class="muted small">${esc(niceDate(e.date))} · ${esc(e.category)}${e.description ? ' · ' + esc(e.description) : ''}</div>
      </div>
      <div class="amt">${money(e.total)}</div>`;
    li.addEventListener('click', () => openReview(e));
    ul.appendChild(li);
  }
}

// ---------- capture & review ----------
$('#addReceiptBtn').addEventListener('click', () => $('#cameraInput').click());
$('#fromGalleryBtn').addEventListener('click', () => $('#galleryInput').click());
$('#retakeBtn').addEventListener('click', () => $('#cameraInput').click());
$('#manualBtn').addEventListener('click', () => openReview(null));
for (const id of ['#cameraInput', '#galleryInput']) {
  $(id).addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (file) await handlePhoto(file);
  });
}

function fillCategories(selected) {
  const sel = $('#expenseForm [name=category]');
  const cats = [...settings.categories];
  if (selected && !cats.includes(selected)) cats.push(selected);
  sel.innerHTML = cats.map((c) => `<option>${esc(c)}</option>`).join('');
  sel.value = selected || cats[cats.length - 1] || '';
}

function setForm(e) {
  const f = $('#expenseForm');
  fillCategories(e.category);
  f.total.value = e.total != null ? Number(e.total).toFixed(2) : '';
  f.date.value = e.date || localISO();
  f.merchant.value = e.merchant || '';
  f.description.value = e.description || '';
  f.payment.value = e.payment || settings.defaultPayment || 'Company card';
  f.subtotal.value = e.subtotal != null ? Number(e.subtotal).toFixed(2) : '';
  f.tax.value = e.tax != null ? Number(e.tax).toFixed(2) : '';
  f.tip.value = e.tip != null ? Number(e.tip).toFixed(2) : '';
  f.notes.value = e.notes || '';
  $('#ocrTextBox').hidden = !e.ocrText;
  $('#ocrText').textContent = e.ocrText || '';
}

function openReview(expense) {
  const isNew = !expense || !expense.id;
  editing = expense ? { ...expense } : { photo: null, category: 'Other' };
  go('review', { title: isNew ? 'New Expense' : 'Edit Expense' });
  $('#photoWrap').hidden = !editing.photo;
  if (editing.photo) $('#photoPreview').src = blobUrl(editing.photo);
  $('#ocrStatus').hidden = true;
  $('#ocrNote').hidden = true;
  $('#ocrNote').classList.remove('warn');
  $('#deleteBtn').hidden = isNew || !!editing.reportId;
  $('#saveBtn').disabled = false;
  setForm(editing);
}

async function handlePhoto(file) {
  const keep = editing && current === 'review' ? editing : null; // "Retake" keeps typed details
  let prepared;
  try {
    prepared = await preparePhoto(file);
  } catch (err) {
    toast(err.message || 'Could not open that photo');
    return;
  }
  openReview({ ...(keep || {}), photo: prepared.photo });

  $('#ocrStatus').hidden = false;
  $('#ocrLabel').textContent = 'Reading receipt…';
  $('#ocrBar').style.width = '5%';
  try {
    const { text, fields } = await readReceipt(prepared.ocrImage, (m) => {
      if (m.status === 'recognizing text') {
        $('#ocrBar').style.width = Math.round(10 + m.progress * 90) + '%';
      } else if (/loading|initializ/.test(m.status)) {
        $('#ocrLabel').textContent = 'Getting ready (first time takes longer)…';
      }
    });
    if (current !== 'review') return;
    const f = $('#expenseForm');
    // Only fill fields the person hasn't typed in yet.
    const fill = (name, val, fmt = (v) => v) => {
      if (val != null && val !== '' && !f[name].value) f[name].value = fmt(val);
    };
    const m2 = (v) => Number(v).toFixed(2);
    fill('total', fields.total, m2);
    fill('subtotal', fields.subtotal, m2);
    fill('tax', fields.tax, m2);
    fill('tip', fields.tip, m2);
    fill('merchant', fields.merchant);
    if (fields.date) f.date.value = fields.date;
    if (fields.category && settings.categories.includes(fields.category)) f.category.value = fields.category;
    if (fields.payment === 'Cash') f.payment.value = 'Cash';
    editing.ocrText = text;
    $('#ocrTextBox').hidden = !text.trim();
    $('#ocrText').textContent = text;
    $('#ocrNote').hidden = false;
    $('#ocrNote').textContent = fields.total == null
      ? 'Couldn\'t read the total. Please type it in. (Flat, well-lit photos read best.)'
      : fields.mismatch
        ? '⚠️ Subtotal + tax + tip doesn\'t match the total. One of the numbers may be misread. Please check them against the photo.'
        : 'Check the details below and fix anything that\'s wrong.';
    $('#ocrNote').classList.toggle('warn', !!fields.mismatch);
  } catch (err) {
    console.error(err);
    $('#ocrNote').hidden = false;
    $('#ocrNote').textContent = 'Couldn\'t read this receipt automatically. Type in the details. The photo is still attached.';
  } finally {
    $('#ocrStatus').hidden = true;
  }
}

$('#expenseForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const total = num(f.total.value);
  if (total == null) { toast('Enter the total'); f.total.focus(); return; }
  const e = {
    ...editing,
    id: editing.id || newId(),
    createdAt: editing.createdAt || Date.now(),
    updatedAt: Date.now(),
    total,
    date: f.date.value || localISO(),
    merchant: f.merchant.value.trim(),
    category: f.category.value,
    description: f.description.value.trim(),
    payment: f.payment.value,
    subtotal: num(f.subtotal.value),
    tax: num(f.tax.value),
    tip: num(f.tip.value),
    notes: f.notes.value.trim(),
    reportId: editing.reportId || null,
  };
  $('#saveBtn').disabled = true;
  try {
    await db.put('expenses', e);
    toast('Saved ✓');
    editing = null;
    go('home');
  } catch (err) {
    console.error(err);
    toast('Could not save. Phone storage may be full.');
    $('#saveBtn').disabled = false;
  }
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!editing?.id) return;
  if (!confirm('Delete this expense?')) return;
  await db.del('expenses', editing.id);
  toast('Deleted');
  go('home');
});

// ---------- send ----------
async function renderSend(reportId, weOverride) {
  freeUrls();
  $('#shareBtn').disabled = true;
  $('#downloadBtn').disabled = true;
  $('#prepStatus').textContent = 'Preparing report…';
  $('#fileList').textContent = '';

  let expenses, report = null, start, end;
  if (reportId) {
    report = await db.get('reports', reportId);
    const all = await db.all('expenses');
    expenses = all.filter((e) => e.reportId === reportId).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    ({ start, end } = report);
  } else {
    expenses = await unsentExpenses();
    ({ start, end } = periodFor(expenses));
    if (weOverride) { end = weOverride; start = addDays(end, -6); }
    // Include any older unsent receipts in the date range shown.
    start = expenses.reduce((m, e) => (e.date && e.date < m ? e.date : m), start);
  }
  const total = expenses.reduce((s, e) => s + (Number(e.total) || 0), 0);
  sendCtx = { expenses, report, start, end, total, files: null };

  $('#weInput').value = end;
  $('#weInput').disabled = !!report;
  $('#sendWE').textContent = `WE ${weLabel(end)}`;
  $('#sendRange').textContent = `${niceDate(start)} – ${niceDate(end)}${report ? ' · sent ' + new Date(report.sentAt).toLocaleDateString() : ''}`;
  $('#sendTotal').textContent = money(total);
  $('#sendCount').textContent = `${expenses.length} receipt${expenses.length === 1 ? '' : 's'}`;
  $('#sendTo').textContent = settings.email || 'your work email';
  $('#copyEmailBtn').hidden = !settings.email || !navigator.clipboard;
  $('#markSentBtn').hidden = !!report || expenses.length === 0;

  if (!expenses.length) { $('#prepStatus').textContent = 'Nothing to send yet.'; return; }

  try {
    const xlsx = await buildWorkbook({ expenses, settings, periodStart: start, periodEnd: end });
    // e.g. "WE 11-28-26 Jane Smith.xlsx"
    const base = `${weFilePrefix(end)} ${safeName(settings.name)}`;
    const files = [new File([xlsx], base + '.xlsx', { type: xlsx.type })];
    expenses.forEach((e, i) => {
      if (e.photo) files.push(new File([e.photo], receiptFileName(i, end), { type: 'image/jpeg' }));
    });
    if (sendCtx.expenses !== expenses) return; // user navigated away
    sendCtx.files = files;
    const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
    $('#fileList').textContent = `Attachments: ${files.map((f) => f.name).join(', ')} (${mb.toFixed(1)} MB)`;
    $('#downloadBtn').disabled = false;
    if (canShareFiles(files)) {
      $('#shareBtn').disabled = false;
      $('#prepStatus').textContent = 'Ready.';
    } else {
      $('#prepStatus').textContent = 'This browser can\'t share files. Use "Download files instead" and attach them to an email.';
    }
  } catch (err) {
    console.error(err);
    $('#prepStatus').textContent = 'Something went wrong building the report: ' + err.message;
  }
}

function emailText() {
  const { start, end, total, expenses } = sendCtx;
  return {
    title: `Expense Report WE ${weLabel(end)} – ${settings.name || 'Employee'}`,
    text:
      `Expense report for ${settings.name || 'employee'}\n` +
      `WE ${weLabel(end)}  (${weLabel(start)} – ${weLabel(end)})\n` +
      `Receipts: ${expenses.length}\n` +
      `Total: ${money(total)}\n\n` +
      `The Excel report and receipt photos are attached.`,
  };
}

$('#shareBtn').addEventListener('click', async () => {
  if (!sendCtx?.files) return;
  try {
    const shared = await shareFiles({ files: sendCtx.files, ...emailText() });
    if (shared && !sendCtx.report) toast('Once the email has gone, tap "Mark as sent".', 4000);
  } catch (err) {
    console.error(err);
    toast('Sharing didn\'t work here. Use "Download files instead".', 4000);
  }
});

$('#downloadBtn').addEventListener('click', () => {
  if (!sendCtx?.files) return;
  sendCtx.files.forEach((f, i) => setTimeout(() => downloadFile(f), i * 400));
  toast('Files downloaded. Attach them to an email.', 4000);
});

$('#copyEmailBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(settings.email); toast('Email copied'); } catch {}
});

$('#weInput').addEventListener('change', (ev) => {
  if (sendCtx && !sendCtx.report && ev.target.value) renderSend(null, ev.target.value);
});

$('#markSentBtn').addEventListener('click', async () => {
  if (!sendCtx || sendCtx.report || !sendCtx.expenses.length) return;
  if (!confirm('Did you send the email? This moves these receipts to History and starts a new week.')) return;
  const report = {
    id: newId(),
    start: sendCtx.start,
    end: sendCtx.end,
    sentAt: Date.now(),
    count: sendCtx.expenses.length,
    total: +sendCtx.total.toFixed(2),
  };
  await db.put('reports', report);
  for (const e of sendCtx.expenses) await db.put('expenses', { ...e, reportId: report.id });
  toast('Week marked as sent ✓');
  go('home');
});

// ---------- history ----------
async function renderHistory() {
  const reports = (await db.all('reports')).sort((a, b) => b.sentAt - a.sentAt);
  $('#historyEmpty').hidden = reports.length > 0;
  const ul = $('#historyList');
  ul.innerHTML = '';
  for (const r of reports) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="noimg">📁</div>
      <div class="grow">
        <div class="t">WE ${esc(weLabel(r.end))}</div>
        <div class="muted small">${r.count} receipt${r.count === 1 ? '' : 's'} · sent ${esc(new Date(r.sentAt).toLocaleDateString())}</div>
      </div>
      <div class="amt">${money(r.total)}</div>`;
    li.addEventListener('click', () => go('send', { reportId: r.id, title: 'Sent Week' }));
    ul.appendChild(li);
  }
}

// ---------- settings ----------
function renderSettings() {
  const f = $('#settingsForm');
  f.name.value = settings.name;
  f.email.value = settings.email;
  f.weekEndDay.value = String(settings.weekEndDay);
  f.reportDay.value = String(settings.reportDay);
  f.defaultPayment.value = settings.defaultPayment || 'Company card';
  f.categories.value = settings.categories.join('\n');
  showStorage();
}

async function showStorage() {
  try {
    const est = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.();
    $('#storageInfo').textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB on this phone${persisted ? ' · protected storage on' : ''}.`;
  } catch {}
}

$('#settingsForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const cats = f.categories.value.split('\n').map((s) => s.trim()).filter(Boolean);
  settings = {
    ...settings,
    name: f.name.value.trim(),
    email: f.email.value.trim(),
    weekEndDay: +f.weekEndDay.value,
    reportDay: +f.reportDay.value,
    defaultPayment: f.defaultPayment.value,
    categories: cats.length ? cats : settings.categories,
  };
  await saveSettings(settings);
  toast('Settings saved ✓');
  go('home');
});

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

$('#backupBtn').addEventListener('click', async () => {
  const expenses = await db.all('expenses');
  const out = [];
  for (const e of expenses) out.push({ ...e, photo: e.photo ? await blobToDataURL(e.photo) : null });
  const data = { app: 'expense-app', version: 1, exportedAt: new Date().toISOString(), settings, reports: await db.all('reports'), expenses: out };
  const file = new File([JSON.stringify(data)], `expenses-backup-${localISO()}.json`, { type: 'application/json' });
  if (canShareFiles([file])) {
    try { await shareFiles({ files: [file], title: 'Expense backup' }); return; } catch {}
  }
  downloadFile(file);
});

$('#restoreBtn').addEventListener('click', () => $('#restoreInput').click());
$('#restoreInput').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'expense-app') throw new Error('Not an expense backup file');
    if (!confirm(`Restore ${data.expenses.length} expenses from ${data.exportedAt.slice(0, 10)}? Existing items with the same ID are replaced.`)) return;
    for (const r of data.reports || []) await db.put('reports', r);
    for (const e of data.expenses) {
      const photo = e.photo ? await (await fetch(e.photo)).blob() : null;
      await db.put('expenses', { ...e, photo });
    }
    if (data.settings) { settings = { ...settings, ...data.settings }; await saveSettings(settings); }
    toast('Backup restored ✓');
    go('home');
  } catch (err) {
    toast('Restore failed: ' + err.message, 4000);
  }
});

// ---------- start ----------
(async function init() {
  settings = await getSettings();
  requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  await go(settings.name && settings.email ? 'home' : 'settings');
  if (!settings.name) toast('Welcome! Enter your name and work email to get started.', 4000);
})();
