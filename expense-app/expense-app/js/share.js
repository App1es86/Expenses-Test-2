// Hands the report to the phone's share menu (pick Outlook), with a download fallback.

export function canShareFiles(files) {
  try {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files }));
  } catch {
    return false;
  }
}

// Must be called directly from a tap (browsers require a fresh user gesture).
export async function shareFiles({ files, title, text }) {
  if (!canShareFiles(files)) throw new Error('share-unsupported');
  try {
    await navigator.share({ files, title, text });
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false; // user closed the menu
    throw err;
  }
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
