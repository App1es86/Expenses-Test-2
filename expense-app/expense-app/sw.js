// Offline support: keeps a copy of the app (and the receipt-reading engine) on the phone.
// Bump VERSION whenever you change any file so phones pick up the update.
const VERSION = 'v1';
const CACHE = 'expense-app-' + VERSION;

const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'js/app.js',
  'js/db.js',
  'js/ocr.js',
  'js/parse.js',
  'js/excel.js',
  'js/share.js',
  'vendor/tesseract.min.js',
  'vendor/worker.min.js',
  'vendor/exceljs.min.js',
  'vendor/tesseract-core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract-core/tesseract-core-simd-lstm.wasm.js',
  'vendor/lang/eng.traineddata.gz',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('expense-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
