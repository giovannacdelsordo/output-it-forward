// popup.js
// Drives the extension popup: injects content.js on HTML pages (or reads
// viewer.js results directly on the PDF viewer page), displays highlights,
// and manages storage + CSV export.

document.addEventListener('DOMContentLoaded', () => {
  const resultsContainer = document.getElementById('results');
  const downloadBtn       = document.getElementById('download-btn');
  const clearBtn          = document.getElementById('clear-btn');

  /* helper: append a heading without clobbering existing event listeners */
  function addHeading(tag, text) {
    const el       = document.createElement(tag);
    el.textContent = text;
    resultsContainer.appendChild(el);
  }

  /* -------------------------------------------------------------- *
   * 1.  Detect active tab; handle HTML pages and PDF viewer page
   * -------------------------------------------------------------- */
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) {
      resultsContainer.textContent = 'Error: no active tab.';
      return;
    }

    const { id: tabId, url: pageUrl = '' } = tabs[0];
    const viewerBase   = chrome.runtime.getURL('viewer.html');
    const isViewerPage = pageUrl.startsWith(viewerBase);
    const isNativePdf  = /\.pdf(\?[^#]*)?$/i.test(pageUrl) && !isViewerPage;

    /* ---- PDF open in native viewer: offer redirect ---- */
    if (isNativePdf) {
      resultsContainer.innerHTML = '<h3>OIF Results</h3>';

      const isLocalFile = pageUrl.startsWith('file://');

      if (isLocalFile) {
        const note = document.createElement('p');
        note.style.fontSize   = '11px';
        note.style.lineHeight = '1.5';
        note.style.marginBottom = '8px';
        note.innerHTML =
          'Local PDF detected.<br>' +
          'To scan it, first enable <strong>Allow access to file URLs</strong>:<br>' +
          '<em>chrome://extensions → OIF Highlighter → Details</em>';
        resultsContainer.appendChild(note);
      } else {
        const note       = document.createElement('p');
        note.textContent = 'PDF detected in native viewer.';
        note.style.marginBottom = '8px';
        resultsContainer.appendChild(note);
      }

      const openBtn       = document.createElement('button');
      openBtn.textContent = 'Open in OIF PDF Viewer';
      openBtn.style.cssText = 'padding:6px 10px;font-size:11px;cursor:pointer;border:1px solid #999;border-radius:4px;background:#f0f0f0;width:100%;';
      openBtn.addEventListener('click', () => {
        const viewerUrl = viewerBase + '?pdf=' + pageUrl;
        chrome.tabs.update(tabId, { url: viewerUrl });
        window.close();
      });
      resultsContainer.appendChild(openBtn);
      return;
    }

    if (isViewerPage) {
      /* PDF viewer page: viewer.js already stored results in localStorage.
       * Just read them directly — do NOT inject content.js.              */
      chrome.scripting.executeScript(
        { target: { tabId }, func: () => localStorage.getItem('highlightResults') },
        ([{ result }]) => {
          let data;
          try { data = JSON.parse(result || '{}'); }
          catch (e) {
            resultsContainer.textContent = 'Error parsing results.';
            return;
          }
          renderResults(data, pageUrl, tabId, /* isViewer */ true);
        }
      );
    } else {
      /* HTML page: inject content.js then read its localStorage output. */
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content.js'] },
        () => chrome.scripting.executeScript(
          { target: { tabId }, func: () => localStorage.getItem('highlightResults') },
          ([{ result }]) => {
            let data;
            try { data = JSON.parse(result || '{}'); }
            catch (e) {
              console.error('Error parsing highlightResults:', e);
              resultsContainer.textContent = 'Error parsing results.';
              return;
            }
            renderResults(data, pageUrl, tabId, /* isViewer */ false);
          }
        )
      );
    }
  });

  /* -------------------------------------------------------------- *
   * 2.  Render results + persist to chrome.storage.local
   * -------------------------------------------------------------- */
  function renderResults(
    {
      statements       = [],
      links            = [],
      triggerSentences = [],
      repositoryTokens = [],
      pageTitle        = ''
    },
    pageUrl,
    tabId,
    isViewer
  ) {
    resultsContainer.innerHTML = '<h3>OIF Results</h3>';

    if (isViewer) {
      const note       = document.createElement('p');
      note.textContent = '(PDF — results also shown in viewer sidebar)';
      note.style.fontSize   = '10px';
      note.style.color      = '#888';
      note.style.marginBottom = '4px';
      resultsContainer.appendChild(note);
    }

    const pageLinks  = links.map(l => l.text.trim()).filter(Boolean);
    const pageRepos  = repositoryTokens.map(t => t.trim()).filter(Boolean);

    const TAB        = '\t';
    const textForCsv = triggerSentences.join(TAB);
    const repoForCsv = pageRepos.join(TAB);

    chrome.storage.local.get({ allPageRows: [] }, ({ allPageRows }) => {
      const exists = allPageRows.some(r =>
        r.title              === pageTitle &&
        r.url                === pageUrl  &&
        (r.text || '')       === textForCsv &&
        (r.repository || '') === repoForCsv &&
        r.links.length       === pageLinks.length &&
        r.links.every((v, i) => v === pageLinks[i])
      );

      if (!exists && (pageLinks.length || triggerSentences.length || pageRepos.length)) {
        allPageRows.push({
          title:      pageTitle,
          url:        pageUrl,
          text:       textForCsv,
          repository: repoForCsv,
          links:      pageLinks
        });
        chrome.storage.local.set({ allPageRows });
      }

      /* ---- sentences ---- */
      if (triggerSentences.length) {
        addHeading('h4', 'Sentences with "data" + link:');
        triggerSentences.forEach(s => {
          const p       = document.createElement('p');
          p.textContent = s;
          p.style.margin = '4px 0';
          resultsContainer.appendChild(p);
        });
      }

      /* ---- repository tokens ---- */
      if (pageRepos.length) {
        addHeading('h4', 'Repository tokens:');
        const ul = document.createElement('ul');
        ul.style.marginLeft = '18px';
        pageRepos.forEach(tok => {
          const li       = document.createElement('li');
          li.textContent = tok;
          ul.appendChild(li);
        });
        resultsContainer.appendChild(ul);
      }

      /* ---- key statements ---- */
      if (statements.length) {
        addHeading('h4', 'Key Statements:');
        statements.forEach(({ text, id }) => {
          const a       = document.createElement('a');
          a.textContent = text;
          a.href        = '#';
          a.style.display = 'block';
          a.style.margin  = '4px 0';
          a.addEventListener('click', e => {
            e.preventDefault();
            chrome.scripting.executeScript({
              target: { tabId },
              func:   scrollToMark,
              args:   [id]
            });
          });
          resultsContainer.appendChild(a);
        });
      }

      /* ---- plain-text URLs ---- */
      if (pageLinks.length) {
        addHeading('h4', 'Plain-text URLs:');
        links.forEach(({ text, id }) => {
          const a       = document.createElement('a');
          a.textContent = text;
          a.href        = '#';
          a.style.display = 'block';
          a.style.margin  = '4px 0';
          a.addEventListener('click', e => {
            e.preventDefault();
            chrome.scripting.executeScript({
              target: { tabId },
              func:   scrollToMark,
              args:   [id]
            });
          });
          resultsContainer.appendChild(a);
        });
      }

      if (!statements.length && !pageLinks.length && !triggerSentences.length) {
        const p       = document.createElement('p');
        p.textContent = 'No matching phrases or links found.';
        resultsContainer.appendChild(p);
      }
    });
  }

  /* helper: scroll to highlighted element in page */
  function scrollToMark(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.outline = '3px solid red';
    setTimeout(() => el.style.outline = '', 2000);
  }

  /* -------------------------------------------------------------- *
   * 3.  Download CSV
   * -------------------------------------------------------------- */
  downloadBtn.addEventListener('click', () => {
    chrome.storage.local.get({ allPageRows: [] }, ({ allPageRows }) => {
      if (!allPageRows.length) return alert('No URLs saved yet!');
      const esc = s => `"${String(s).replace(/"/g, '""')}"`;

      const header = ['Article title', 'Webpage URL', 'Text', 'Repository', 'Links']
        .map(esc).join(',');

      const dataLines = allPageRows.map(
        ({ title, url, text = '', repository = '', links = [] }) =>
          [title, url, text, repository, ...links].map(esc).join(',')
      );

      const csv = 'data:text/csv;charset=utf-8,' + encodeURIComponent([header, ...dataLines].join('\n'));
      const a   = document.createElement('a');
      a.href    = csv;
      a.download = 'all_links.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  });

  /* -------------------------------------------------------------- *
   * 4.  Clear stored rows
   * -------------------------------------------------------------- */
  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({ allPageRows: [] }, () => alert('Stored links cleared.'));
  });
});
