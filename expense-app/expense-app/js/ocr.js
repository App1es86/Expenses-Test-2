// Photo handling + on-device text recognition (Tesseract.js, bundled in /vendor).
import { parseReceipt } from './parse.js';

let workerPromise;

function getWorker(onProgress) {
  if (!workerPromise) {
    const base = new URL('../vendor/', import.meta.url).href;
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'tesseract-core/',
      langPath: base + 'lang',
      logger: (m) => onProgressRef.fn && onProgressRef.fn(m),
    });
  }
  onProgressRef.fn = onProgress;
  return workerPromise;
}
const onProgressRef = { fn: null };

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Shrink the photo for storage/email (~1600px JPEG) and make a high-contrast
// grayscale copy that Tesseract reads more reliably.
export async function preparePhoto(file) {
  const img = await loadImage(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const photo = await canvasToBlob(c, 'image/jpeg', 0.8);

  // OCR copy: grayscale + contrast stretch.
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  let min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    const g = ((px[i] - min) / range) * 255;
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  const ocrImage = await canvasToBlob(c, 'image/png');

  return { photo, ocrImage, width: w, height: h };
}

export async function readReceipt(ocrImage, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(ocrImage);
  return { text: data.text, fields: parseReceipt(data.text) };
}
