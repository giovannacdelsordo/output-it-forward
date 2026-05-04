// background.js
// Acts as a fetch proxy for viewer.js: extension pages cannot fetch
// cross-origin PDFs (CORS), but the service worker can because it runs
// in the privileged extension context with host_permissions for <all_urls>.

/* -------------------------------------------------------------- *
 * proxy fetch
 * -------------------------------------------------------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'fetchPdf') {
    fetch(msg.url, {
      credentials: 'include',
      headers: { 'Accept': 'application/pdf,*/*' }
    })
      .then(r => {
        const ct = r.headers.get('content-type') || '';
        if (!r.ok)                    throw new Error(`HTTP ${r.status} ${r.statusText}`);
        if (ct.includes('text/html')) throw new Error('GOT_HTML');
        return r.arrayBuffer();
      })
      .then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary  = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
        }
        sendResponse({ ok: true, base64: btoa(binary) });
      })
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  /* ---- browser-native download ---- */
  if (msg.action === 'downloadPdf') {
    const filename = 'oif_' + Date.now() + '.pdf';
    chrome.downloads.download(
      { url: msg.url, filename, saveAs: false, conflictAction: 'uniquify' },
      downloadId => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Download failed' });
          return;
        }
        const interval = setInterval(() => {
          chrome.downloads.search({ id: downloadId }, ([item]) => {
            if (!item) return;
            if (item.state === 'complete') {
              clearInterval(interval);
              sendResponse({ ok: true, filename: item.filename });
            } else if (item.state === 'interrupted') {
              clearInterval(interval);
              sendResponse({ ok: false, error: 'Download interrupted: ' + (item.error || 'unknown') });
            }
          });
        }, 500);
      }
    );
    return true;
  }

  return false;
});
