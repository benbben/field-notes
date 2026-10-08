// iOS-safe file export.
//
// `a.download` with a blob URL is unreliable inside an iOS home-screen web app,
// so prefer the Web Share API with a File. Safari requires navigator.share()
// to be called synchronously inside the tap handler, so callers must pass a
// ready string (no awaiting IndexedDB in between).

export function canShareFile(file) {
  return typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [file] });
}

// Returns { method: 'share' | 'download', done: Promise }.
export function exportJsonFile(text, name, title) {
  const file = new File([text], name, { type: 'application/json' });
  if (canShareFile(file)) {
    return { method: 'share', done: navigator.share({ files: [file], title }) };
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { method: 'download', done: Promise.resolve() };
}
