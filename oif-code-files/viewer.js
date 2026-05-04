// viewer.js
// Loads a PDF via PDF.js, renders each page, overlays highlighted spans for
// OIF phrases and plain-text URLs, and populates the sidebar with results.
// Local file:// PDFs are loaded via a file picker (Chrome blocks direct fetch).

(async () => {

  /* -------------------------------------------------------------- *
   * 0. Extract PDF URL from query string.
   * -------------------------------------------------------------- */
  const rawHref   = location.href;
  const pdfMarker = '?pdf=';
  const markerIdx = rawHref.indexOf(pdfMarker);
  const pdfUrl    = markerIdx !== -1 ? rawHref.slice(markerIdx + pdfMarker.length) : null;

  const statusEl  = document.getElementById('status');
  const resultsEl = document.getElementById('results');
  const pdfArea   = document.getElementById('pdf-area');

  if (!pdfUrl) {
    statusEl.textContent = 'No PDF URL provided.';
    return;
  }

  document.title = 'OIF – ' + decodeURIComponent(pdfUrl.split('/').pop().split('?')[0]);

  /* -------------------------------------------------------------- *
   * 1. PDF.js worker
   * -------------------------------------------------------------- */
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

  /* -------------------------------------------------------------- *
   * 2. OIF config
   * -------------------------------------------------------------- */
  const phrases = [
    // Formal section headers
    'Data Availability Statement',
    'Data Availability Statements',
    'Data availability statement',
    'Open Practices Statement',
    'Open practices statement',
    'Code availability',
    'Code Availability',
    // APA / Psychonomic Society open-science badge language
    'Open Data',
    'Open data',
    'Open Materials',
    'Open materials',
    'Open Science',
    'open science',
    // Generic sharing language
    'data sharing',
    'Data sharing',
    'data availability',
    'Data availability',
    'available online',
    'openly available',
    'publicly available',
    'freely available',
    'openly accessible',
    'publicly accessible',
    'supplementary',
    'associated data',
    'repository',
    'upon request',
    'upon reasonable request',
    // Pre-registration
    'preregistered',
    'pre-registered',
    'Preregistered',
    'registered report',
    'Registered Report',
  ];

  const urlRegex     = /\b(?:https?:\/\/|www\.)\S+/gi;
  const triggerRegex = /(https?:\/\/|www\.|osf\.io|zenodo|figshare|github\.com|dataverse|dryad)/i;

  const results = {
    statements:       [],
    links:            [],
    triggerSentences: [],
    repositoryTokens: [],
    pageTitle: decodeURIComponent(pdfUrl.split('/').pop().split('?')[0]) || pdfUrl
  };

  const seen       = new Set();
  let   matchCount = 0;

  function escRx(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* -------------------------------------------------------------- *
   * Helper: build a mapping from normalised-text positions back to
   * original pageText positions. Required because we match against
   * normText (single spaces) but spanMeta indices reference pageText.
   * -------------------------------------------------------------- */
  function buildNormToOrigMap(orig, norm) {
    const map = new Array(norm.length + 1);
    let o = 0, n = 0;
    while (n < norm.length && o < orig.length) {
      map[n] = o;
      const oIsSpace = /\s/.test(orig[o]);
      const nIsSpace = /\s/.test(norm[n]);

      if (oIsSpace && nIsSpace) {
        // Both whitespace: consume ALL consecutive whitespace in orig,
        // advance norm by exactly one space.
        while (o < orig.length && /\s/.test(orig[o])) o++;
        n++;
      } else if (oIsSpace) {
        // Extra whitespace in orig not present in norm — skip it.
        o++;
      } else if (orig[o] === norm[n]) {
        o++; n++;
      } else {
        o++; n++;
      }
    }
    map[norm.length] = o;
    return map;
  }

  /* -------------------------------------------------------------- *
   * 3. Load PDF
   *    file:// URLs: Chrome blocks direct fetch, so show a file picker.
   *    http/https URLs: fetch directly, with CORS error handling.
   * -------------------------------------------------------------- */
  if (pdfUrl.startsWith('file://')) {
    const suggestedName = decodeURIComponent(pdfUrl.split('/').pop()) || 'file.pdf';

    statusEl.innerHTML =
      `Local file: <strong>${suggestedName}</strong><br>` +
      'Select the file below to open it in the OIF Viewer.';

    const pickBtn       = document.createElement('button');
    pickBtn.textContent = 'Select PDF file…';
    pickBtn.style.cssText =
      'margin-top:8px;padding:5px 10px;font-size:11px;cursor:pointer;' +
      'border:1px solid #aaa;border-radius:4px;background:#f0f0f0;width:100%;';

    const fileInput  = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = '.pdf,application/pdf';
    fileInput.style.display = 'none';

    pickBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      pickBtn.remove();
      fileInput.remove();
      statusEl.textContent = 'Loading…';
      results.pageTitle    = file.name;
      document.title       = 'OIF – ' + file.name;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        await renderPdf(pdf);
      } catch (err) {
        const msg = err && (err.message || err.name || JSON.stringify(err)) || 'Unknown error';
        statusEl.textContent = 'Error loading PDF: ' + msg;
        console.error(err);
      }
    });

    const header = document.getElementById('sidebar-header');
    header.appendChild(pickBtn);
    header.appendChild(fileInput);
    return;
  }

  /* Remote PDF — three-stage approach:
   *  1. Direct fetch    works for open-access PDFs
   *  2. Proxy fetch     service worker, might bypass CORS
   *  3. Native download chrome.downloads uses full browser credentials
   *                     including SameSite cookies; works for any PDF
   *                     the user can open in their browser.
   * ---------------------------------------------------------------- */
  let pdf;

  /* Stage 1 — direct */
  try {
    pdf = await pdfjsLib.getDocument({ url: pdfUrl, withCredentials: true }).promise;
    await renderPdf(pdf);
    return;
  } catch (_) { /* fall through */ }

  /* Stage 2 — service-worker proxy (base64 transfer to avoid IPC issues) */
  statusEl.textContent = 'Trying proxy fetch…';
  try {
    pdf = await fetchViaProxy(pdfUrl);
    await renderPdf(pdf);
    return;
  } catch (proxyErr) {
    console.warn('Proxy failed:', proxyErr.message);
    // fall through to native download
  }

  /* Stage 3 — native browser download */
  await downloadAndLoad(pdfUrl);

  /* -------------------------------------------------------------- *
   * Helper: proxy fetch via background service worker.
   * Uses base64 to safely transfer large buffers over IPC.
   * -------------------------------------------------------------- */
  function fetchViaProxy(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'fetchPdf', url }, response => {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok)
          return reject(new Error(response?.error || 'Proxy error'));
        // base64 → ArrayBuffer
        try {
          const binary = atob(response.base64);
          const buffer = new ArrayBuffer(binary.length);
          const view   = new Uint8Array(buffer);
          for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
          pdfjsLib.getDocument({ data: buffer }).promise.then(resolve).catch(reject);
        } catch (e) { reject(e); }
      });
    });
  }

  /* -------------------------------------------------------------- *
   * Helper: ask background to download the PDF using the browser's
   * native download mechanism (full cookie context), then load it
   * via the file picker once the download completes.
   * -------------------------------------------------------------- */
  async function downloadAndLoad(url) {
    statusEl.textContent = 'Downloading PDF via browser… this may take a moment.';

    const downloadResult = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'downloadPdf', url }, resolve);
    });

    if (!downloadResult?.ok) {
      statusEl.innerHTML =
        'Could not load or download this PDF.<br><br>' +
        '<strong>Manual workaround:</strong> Download the PDF from your ' +
        'browser, then click the OIF popup and use ' +
        '<em>Open in OIF PDF Viewer</em> to open it locally.';
      return;
    }

    // Download succeeded — show file picker pointing user to the file.
    const filename = downloadResult.filename.split('/').pop().split('\\').pop();
    statusEl.innerHTML =
      `PDF saved as <strong>${filename}</strong>.<br>` +
      'Find it in your <strong>Downloads</strong> folder and select it below.';

    const pickBtn   = document.createElement('button');
    pickBtn.textContent = 'Select downloaded PDF…';
    pickBtn.style.cssText =
      'margin-top:8px;padding:5px 10px;font-size:11px;cursor:pointer;' +
      'border:1px solid #aaa;border-radius:4px;background:#d4edda;width:100%;';

    const fileInput  = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = '.pdf,application/pdf';
    fileInput.style.display = 'none';

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      pickBtn.remove();
      fileInput.remove();
      statusEl.textContent = 'Loading…';
      results.pageTitle    = file.name;
      document.title       = 'OIF – ' + file.name;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const p = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        await renderPdf(p);
      } catch (err) {
        statusEl.textContent = 'Error loading PDF: ' + (err.message || String(err));
      }
    });

    const header = document.getElementById('sidebar-header');
    header.appendChild(pickBtn);
    header.appendChild(fileInput);
  }

  /* -------------------------------------------------------------- *
   * 4. Render all pages + run OIF matching
   * -------------------------------------------------------------- */
  async function renderPdf(pdfDoc) {
    statusEl.textContent = `Scanning ${pdfDoc.numPages} page(s)…`;

    const SCALE      = 1.5;
    let   allPageText = '';

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page     = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: SCALE });

      const pageDiv        = document.createElement('div');
      pageDiv.className    = 'pdf-page';
      pageDiv.style.width  = viewport.width  + 'px';
      pageDiv.style.height = viewport.height + 'px';
      pdfArea.appendChild(pageDiv);

      const canvas    = document.createElement('canvas');
      canvas.width    = viewport.width;
      canvas.height   = viewport.height;
      pageDiv.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

      const textContent   = await page.getTextContent();
      const textLayerDiv  = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      pageDiv.appendChild(textLayerDiv);

      let   pageText  = '';
      const spanMeta  = [];

      for (const item of textContent.items) {
        if (!item.str) continue;
        const tx       = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.sqrt(tx[0] ** 2 + tx[1] ** 2);
        const angle    = Math.atan2(tx[1], tx[0]);

        const span          = document.createElement('span');
        span.textContent    = item.str;
        span.style.left     = tx[4] + 'px';
        span.style.top      = (tx[5] - fontSize) + 'px';
        span.style.fontSize = fontSize + 'px';
        if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;

        textLayerDiv.appendChild(span);
        spanMeta.push({ span, start: pageText.length, end: pageText.length + item.str.length });

        pageText += item.str;
        // Add separator only if item doesn't already end with whitespace.
        // Use newline for line-break items (improves sentence splitting),
        // otherwise a single space.
        if (!/\s$/.test(item.str)) {
          pageText += item.hasEOL ? '\n' : ' ';
        }
      }

      // Collapsed copy for matching — prevents double-spaces blocking phrases.
      const normText   = pageText.replace(/\s+/g, ' ');
      const normToOrig = buildNormToOrigMap(pageText, normText);

      /* ---- Highlight phrases ---- */
      phrases.forEach(phrase => {
        // Allow any whitespace between words
        const rx = new RegExp(
          phrase.split(/\s+/).map(escRx).join('\\s+'),
          'gi'
        );
        let m;
        while ((m = rx.exec(normText)) !== null) {
          const origStart = normToOrig[m.index]              ?? m.index;
          const origEnd   = normToOrig[m.index + m[0].length] ?? m.index + m[0].length;
          spanMeta.forEach(({ span, start, end }) => {
            if (start >= origEnd || end <= origStart) return;
            span.classList.add('hl-phrase');
            if (!span.id) span.id = `match-${matchCount++}`;
            const normalised = phrase.toLowerCase();
            if (!seen.has(`phrase:${normalised}`)) {
              seen.add(`phrase:${normalised}`);
              results.statements.push({ text: phrase, id: span.id });
            }
          });
        }
      });

      /* ---- Highlight URLs ---- */
      urlRegex.lastIndex = 0;
      let uMatch;
      while ((uMatch = urlRegex.exec(normText)) !== null) {
        const origStart  = normToOrig[uMatch.index]                    ?? uMatch.index;
        const origEnd    = normToOrig[uMatch.index + uMatch[0].length] ?? uMatch.index + uMatch[0].length;
        const normalised = uMatch[0].toLowerCase();
        if (seen.has(`link:${normalised}`)) continue;
        seen.add(`link:${normalised}`);
        const id = `link-${matchCount++}`;
        results.links.push({ text: uMatch[0], id });
        spanMeta.forEach(({ span, start, end }) => {
          if (start >= origEnd || end <= origStart) return;
          span.classList.add('hl-url');
          if (!span.id) span.id = id;
        });
      }

      /* ---- PDF link annotations ----
       * URLs stored as hyperlink annotations are NOT in textContent.items.
       * We convert each annotation's rect to viewport coordinates and create
       * a positioned highlight element so scroll-to works identically to
       * text-based links.                                                    */
      const annotations = await page.getAnnotations();
      for (const annot of annotations) {
        if (annot.subtype !== 'Link' || !annot.url) continue;
        const url        = annot.url.trim();
        const normalised = url.toLowerCase();
        if (seen.has(`link:${normalised}`)) continue;
        seen.add(`link:${normalised}`);

        // Convert PDF-space rect to viewport-space rect
        const vr   = viewport.convertToViewportRectangle(annot.rect);
        const left = Math.min(vr[0], vr[2]);
        const top  = Math.min(vr[1], vr[3]);
        const w    = Math.abs(vr[2] - vr[0]);
        const h    = Math.abs(vr[3] - vr[1]);

        const id      = `annot-link-${matchCount++}`;
        const marker  = document.createElement('span');
        marker.id     = id;
        marker.style.cssText =
          `position:absolute;left:${left}px;top:${top}px;` +
          `width:${w}px;height:${h}px;` +
          `background-color:rgba(80,180,255,0.45);border-radius:2px;`;
        textLayerDiv.appendChild(marker);

        results.links.push({ text: url, id });
      }

      allPageText += normText + '\n';
    }

    /* ---- Trigger sentences ---- */
    allPageText.split(/(?:\r?\n)+|(?<=[.!?])\s+/).forEach(sentence => {
      if (!triggerRegex.test(sentence)) return;
      // Must mention data, materials, code, or dataset
      if (!/\b(data|dataset|material|code|stimul)\b/i.test(sentence)) return;
      // Skip bare reference lines: 'Available from: http...'
      if (/^\s*Available from:/i.test(sentence)) return;
      const cleaned = sentence.trim().replace(/\s+/g, ' ');
      if (!cleaned) return;
      results.triggerSentences.push(cleaned);
    });

    /* ---- Repository tokens — extracted from ALL detected URLs, not
     *      just trigger sentences. Any URL matching a known repository
     *      domain is always a repository token regardless of context. ---- */
    const REPO_PATTERN = /osf\.io|zenodo\.org|figshare\.com|github\.com|dataverse|dryad\.org|psycharchives|openicpsr|openneuro|re3data|mendeley\.com\/datasets|data\.mendeley/i;
    results.links.forEach(({ text }) => {
      if (REPO_PATTERN.test(text) && !results.repositoryTokens.includes(text)) {
        results.repositoryTokens.push(text);
      }
    });

    localStorage.setItem('highlightResults', JSON.stringify(results));

    const TAB       = '\t';
    const pageLinks = results.links.map(l => l.text.trim()).filter(Boolean);
    chrome.storage.local.get({ allPageRows: [] }, ({ allPageRows }) => {
      const exists = allPageRows.some(r => r.url === pdfUrl && r.title === results.pageTitle);
      if (!exists && (pageLinks.length || results.triggerSentences.length || results.repositoryTokens.length)) {
        allPageRows.push({
          title:      results.pageTitle,
          url:        pdfUrl,
          text:       results.triggerSentences.join(TAB),
          repository: results.repositoryTokens.join(TAB),
          links:      pageLinks
        });
        chrome.storage.local.set({ allPageRows });
      }
    });

    statusEl.textContent =
      `${results.statements.length} phrase match(es) · ${results.links.length} URL(s)`;

    renderSidebar();
  }

  /* -------------------------------------------------------------- *
   * 5. Sidebar
   * -------------------------------------------------------------- */
  function renderSidebar() {
    function addHeading(text) {
      const h4 = document.createElement('h4');
      h4.textContent = text;
      resultsEl.appendChild(h4);
    }
    function scrollTo(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '3px solid red';
      setTimeout(() => el.style.outline = '', 2000);
    }

    if (results.triggerSentences.length) {
      addHeading('Sentences with data-sharing language + link:');
      results.triggerSentences.forEach(s => {
        const p = document.createElement('p');
        p.textContent = s;
        resultsEl.appendChild(p);
      });
    }
    if (results.repositoryTokens.length) {
      addHeading('Repository tokens:');
      const ul = document.createElement('ul');
      results.repositoryTokens.forEach(tok => {
        const li = document.createElement('li');
        li.textContent = tok;
        ul.appendChild(li);
      });
      resultsEl.appendChild(ul);
    }
    if (results.statements.length) {
      addHeading('Key Statements:');
      results.statements.forEach(({ text, id }) => {
        const a = document.createElement('a');
        a.textContent = text;
        a.href = '#';
        a.addEventListener('click', e => { e.preventDefault(); scrollTo(id); });
        resultsEl.appendChild(a);
      });
    }
    if (results.links.length) {
      addHeading('Plain-text URLs:');
      results.links.forEach(({ text, id }) => {
        const a = document.createElement('a');
        a.textContent = text;
        a.href = '#';
        a.addEventListener('click', e => { e.preventDefault(); scrollTo(id); });
        resultsEl.appendChild(a);
      });
    }
    if (!results.statements.length && !results.links.length && !results.triggerSentences.length) {
      const p = document.createElement('p');
      p.textContent = 'No matching phrases or links found.';
      resultsEl.appendChild(p);
    }
  }

  /* -------------------------------------------------------------- *
   * 6. CSV / clear buttons
   * -------------------------------------------------------------- */
  document.getElementById('download-btn').addEventListener('click', () => {
    chrome.storage.local.get({ allPageRows: [] }, ({ allPageRows }) => {
      if (!allPageRows.length) return alert('No URLs saved yet!');
      const esc  = s => `"${String(s).replace(/"/g, '""')}"`;
      const hdr  = ['Article title', 'Webpage URL', 'Text', 'Repository', 'Links'].map(esc).join(',');
      const rows = allPageRows.map(({ title, url, text = '', repository = '', links = [] }) =>
        [title, url, text, repository, ...links].map(esc).join(',')
      );
      const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent([hdr, ...rows].join('\n'));
      const a   = Object.assign(document.createElement('a'), { href: csv, download: 'all_links.csv' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    chrome.storage.local.set({ allPageRows: [] }, () => alert('Stored links cleared.'));
  });

})();
