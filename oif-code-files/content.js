(() => {
  console.log("OIF content script running...");

  /* ------------------------------------------------------------------ *
   * 1.  ORIGINAL PHRASE-HIGHLIGHTER (unchanged)
   * ------------------------------------------------------------------ */
  const phrases = [
    // Formal section headers
    "Data Availability Statement",
    "Data Availability Statements",
    "Data availability statement",
    "Open Practices Statement",
    "Open practices statement",
    "Code availability",
    "Code Availability",
    // APA / Psychonomic Society open-science badge language
    "Open Data",
    "Open data",
    "Open Materials",
    "Open materials",
    "Open Science",
    "open science",
    // Generic sharing language
    "data sharing",
    "Data sharing",
    "data availability",
    "Data availability",
    "available online",
    "openly available",
    "publicly available",
    "freely available",
    "openly accessible",
    "publicly accessible",
    "supplementary",
    "associated data",
    "repository",
    "upon request",
    "upon reasonable request",
    // Pre-registration
    "preregistered",
    "pre-registered",
    "Preregistered",
    "registered report",
    "Registered Report",
  ];

  const results = {
    statements: [],
    links: []
  };

  let matchCount = 0;
  const seen = new Set();

  const SKIP_TAGS = new Set([
    'script', 'style', 'meta', 'noscript', 'template',
    'head', 'title', 'svg', 'link', 'iframe'
  ]);

  function walk(node) {
    if (node.nodeType === Node.ELEMENT_NODE &&
        SKIP_TAGS.has(node.tagName.toLowerCase())) return;
    if (node.nodeType === Node.TEXT_NODE) {
      highlightPhrasesInTextNode(node);
    } else {
      let child = node.firstChild;
      while (child) {
        const next = child.nextSibling;
        walk(child);
        child = next;
      }
    }
  }

  function highlightPhrasesInTextNode(textNode) {
    const parent = textNode.parentNode;
    let text = textNode.textContent;
    let replaced = false;
    const phraseMap = new Map();

    phrases.forEach(phrase => {
      const regex = new RegExp(`\\b(${phrase})\\b`, "gi");
      const matches = [...text.matchAll(regex)];

      matches.forEach(match => {
        const normalized = match[0].toLowerCase();
        if (seen.has(`phrase:${normalized}`)) return;

        const id = `phrase-match-${matchCount++}`;
        phraseMap.set(match[0], { id, text: match[0] });
        seen.add(`phrase:${normalized}`);
        replaced = true;
      });
    });

    if (replaced) {
      phraseMap.forEach(({ id, text: phraseText }) => {
        const mark = `<mark id="${id}" style="background-color: yellow; border-radius: 2px; padding: 1px;">${phraseText}</mark>`;
        text = text.replace(new RegExp(`\\b${phraseText}\\b`, "i"), mark);
        results.statements.push({ text: phraseText, id });
      });
      const span = document.createElement("span");
      span.innerHTML = text;
      parent.replaceChild(span, textNode);
    }
  }

  /* --- helpers used by raw-link highlighting --- */
  function isVisible(node) {
    if (!node.parentElement) return false;
    const style = window.getComputedStyle(node.parentElement);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      node.parentElement.offsetParent === null
    ) return false;

    const tag = node.parentElement.tagName.toLowerCase();
    if (["script", "style", "meta", "noscript", "template", "head", "title", "svg"].includes(tag)) {
      return false;
    }
    return true;
  }

  function highlightRawTextLinks() {
    const regex = /\b(?:https?:\/\/|www\.)\S+/gi;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodesToProcess = [];

    while (walker.nextNode()) {
      if (isVisible(walker.currentNode)) nodesToProcess.push(walker.currentNode);
    }

    for (const node of nodesToProcess) {
      let text = node.textContent;
      let match;
      let lastIndex = 0;
      const parent = node.parentNode;
      let hasMatch = false;
      regex.lastIndex = 0;

      const fragment = document.createDocumentFragment();

      while ((match = regex.exec(text)) !== null) {
        hasMatch = true;
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const linkText = match[0];
        const normalized = linkText.toLowerCase();
        if (!seen.has(`link:${normalized}`)) {
          const id = `link-match-${matchCount++}`;
          seen.add(`link:${normalized}`);
          results.links.push({ text: linkText, id });

          const mark = document.createElement("mark");
          mark.textContent = linkText;
          mark.id = id;
          mark.style.backgroundColor = "yellow";
          mark.style.borderRadius = "2px";
          mark.style.padding = "1px";
          fragment.appendChild(mark);
        } else {
          fragment.appendChild(document.createTextNode(linkText));
        }
        lastIndex = match.index + linkText.length;
      }
      if (hasMatch && lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      if (hasMatch) parent.replaceChild(fragment, node);
    }
  }

  /* ------------------------------------------------------------------ *
   * 2.  ORIGINAL WORK: run highlighters
   * ------------------------------------------------------------------ */
  walk(document.body);
  highlightRawTextLinks();

  /* ------------------------------------------------------------------ *
  /* ------------------------------------------------------------------ *
   * 3. TRIGGER SENTENCE DETECTION
   * ------------------------------------------------------------------ */
  (() => {
    const triggerRegex = /(https?:\/\/|www\.|osf\.io|zenodo|figshare|github\.com|dataverse|dryad)/i;
    const bodyText     = document.body.innerText || "";

    const sentences = bodyText.split(/(?:\r?\n)+|(?<=[.!?])\s+/);

    const triggerSentences = [];

    sentences.forEach(sentence => {
      if (!triggerRegex.test(sentence)) return;
      // Must mention data, materials, code, or dataset
      if (!/\b(data|dataset|material|code|stimul)\b/i.test(sentence)) return;
      // Skip bare reference lines: 'Available from: http...'
      if (/^\s*Available from:/i.test(sentence)) return;

      const cleaned = sentence.trim().replace(/\s+/g, " ");
      if (!cleaned) return;
      triggerSentences.push(cleaned);
    });

    /* Repository tokens — extracted from ALL detected URLs, not just
     * trigger sentences. Any URL matching a known repository domain is
     * always a repository token regardless of surrounding context.     */
    const REPO_PATTERN = /osf\.io|zenodo\.org|figshare\.com|github\.com|dataverse|dryad\.org|psycharchives|openicpsr|openneuro|re3data|mendeley\.com\/datasets|data\.mendeley/i;
    const repoTokens = results.links
      .map(l => l.text.trim())
      .filter(url => REPO_PATTERN.test(url));

    results.triggerSentences  = triggerSentences;
    results.repositoryTokens  = [...new Set(repoTokens)];
  })();

  /* ------------------------------------------------------------------ *
   * 4.  ORIGINAL – store everything for popup.js
   * ------------------------------------------------------------------ */
  let pageTitle = "";
  const h1 = document.querySelector("h1");
  if (h1 && h1.innerText.trim().length > 10) {
    pageTitle = h1.innerText.trim();
  } else if (document.title && document.title.length > 10) {
    pageTitle = document.title.trim();
  } else {
    pageTitle = window.location.href;
  }

  localStorage.setItem("highlightResults", JSON.stringify({
    ...results,
    pageTitle
  }));

  console.log("OIF highlights + sentences + repository tokens stored.");
})();
