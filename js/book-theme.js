/* Book theme for the 이온토플 입문서 (DESIGN.md). Presentation only:
   never changes stored blocks/html text. Shared by the editor bundle
   (rules), the admin preview and the student viewer (decorateReader). */
(function (global) {
  'use strict';
  const THEMED = new Set(['e660266e-1b01-4d11-9254-81ea7e613344']);
  const CH_BY_NUM = { '06': 'r', '07': 'l', '08': 'w', '09': 's' };
  const LABEL = { n: 'TOEFL', r: 'READING', l: 'LISTENING', w: 'WRITING', s: 'SPEAKING' };
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const FOOTER = /^\s*-\s*\d{1,4}\s*-\s*$/;

  const rules = {
    kick: /^(\s*)(\d{1,2}(?:-\d{1,2})?)\.?(\s+)(?=\S)/,        // "2 시험 기본 정보"
    tocPage: /\s(\d{1,3})\s*$/,                                  // "토플 이해하기  28"
    step: /^(\s*)([①-⑳])(\s*)/,
    parenStep: /^(\s*)\((\d{1,2})\)(\s+)(?=\S)/,
    arrow: /^(\s*)(→|->)/,
    leadNum: /^(\s*)(\d{1,2})(\s+)(?=\S)/,
    circledNumber(ch) { return CIRCLED.indexOf(ch) + 1; },
    source: /(출처|공식\s*(발표|홈페이지|자료))/,
    memoKind(text) {
      const t = String(text || '').trim();
      if (!t) return 'memo';
      if (/^\([\s\S]*\)$/.test(t)) return 'aside';
      // An arrow-led line is the author's explanation, even if it contains a question.
      if (!/^(→|->|=>)/.test(t) && /\?(\s|$)/.test(t.replace(/\([^)]*\)/g, ''))) return 'q';
      if (t.length <= 22 && !t.includes('\n')) return 'short';
      return 'memo';
    },
    // Consecutive memos read as one note: short ones follow the explanation style.
    unifyRun(kinds) {
      return kinds.includes('memo') ? kinds.map(k => (k === 'short' ? 'memo' : k)) : kinds;
    },
    isEnglish(text) {
      const t = String(text || '').trim().replace(/^[①-⑳]\s*/, '');
      return t.length > 50 && /^[A-Za-z"“(]/.test(t) && /^[A-Za-z0-9\s,.'"“”’‘…;:!?()\-\/_%&$]+$/.test(t);
    },
  };

  function isThemed(bookId) { return THEMED.has(String(bookId || '')); }

  function parse(html) {
    const t = document.createElement('template'); t.innerHTML = html || ''; return t.content;
  }
  function blocksOf(frag) {
    return [...frag.children].filter(e => !(e.tagName === 'P' && (FOOTER.test(e.textContent) || !e.textContent.trim()) && !e.querySelector('img')));
  }
  function headingTexts(frag) {
    return [...frag.querySelectorAll('[data-book-kind="heading"], h1, h2, h3')].filter(h => !h.parentElement?.closest('[data-book-kind="heading"]')).map(h => { const x = h.cloneNode(true); x.querySelectorAll('br').forEach(b => b.replaceWith(' ')); return x.textContent.replace(/\s+/g, ' ').trim(); });
  }
  function isTocEntry(el) {
    const all = el.textContent.replace(/\s/g, ''); const linked = [...el.querySelectorAll('a')].map(a => a.textContent).join('').replace(/\s/g, '');
    return !!all && all === linked;
  }

  // A table-of-contents page: most blocks are entries whose whole text is a link.
  function isTocPage(frag, blocks) {
    const entries = [...frag.querySelectorAll('[data-book-kind="heading"], p')].filter(e => !e.closest('[data-book-kind="heading"] p') && isTocEntry(e));
    return entries.length >= 5 && entries.length >= blocks.length * 0.6;
  }

  /* pages: [{sort_order, html}] in reading order. Returns array of meta. */
  function classify(pages) {
    const metas = []; let ch = 'n'; let firstOpener = -1; let pendingTitle = null;
    pages.forEach((p, i) => {
      const frag = parse(p.html); const blocks = blocksOf(frag); const heads = headingTexts(frag);
      const meta = { index: i, ch, kind: 'body', band: true, num: '', label: '', title: '' };
      if (frag.querySelector('[data-book-kind="cover"]')) { meta.kind = 'cover'; meta.band = false; }
      else if (blocks.length === 1 && heads.length === 1 && /^\d{2}$/.test(heads[0])) {
        const num = heads[0]; ch = CH_BY_NUM[num] || 'n'; if (firstOpener < 0) firstOpener = i;
        Object.assign(meta, { kind: 'opener', ch, band: false, num, label: LABEL[ch] });
        pendingTitle = meta;
      } else if (pendingTitle && i === pendingTitle.index + 1) {
        Object.assign(meta, { kind: 'opener-title', ch, band: false, num: pendingTitle.num });
        pendingTitle.title = (heads[0] || '').replace(/\.\s*$/, '');
        meta.title = pendingTitle.title;
      } else if (!blocks.length) { meta.kind = 'empty'; meta.band = false; }
      else if (isTocPage(frag, blocks)) { meta.kind = 'toc'; meta.band = false; }
      metas.push(meta);
    });
    metas.forEach(m => { if (firstOpener >= 0 && m.index < firstOpener && m.kind === 'body') { m.kind = 'front'; m.band = false; } });
    if (metas.length && metas[metas.length - 1].kind === 'body') { const last = metas[metas.length - 1]; last.kind = 'last'; last.band = false; }
    return metas;
  }

  function pageClasses(meta) {
    return ['bt-eon', 'bt-ch-' + meta.ch, 'bt-kind-' + meta.kind].concat(meta.band ? ['bt-band'] : []);
  }
  function applyPage(el, meta) {
    if (!el) return;
    [...el.classList].filter(c => c === 'bt-eon' || c === 'bt-band' || c.startsWith('bt-ch-') || c.startsWith('bt-kind-')).forEach(c => el.classList.remove(c));
    if (!meta) { el.style.removeProperty('--bt-label'); el.style.removeProperty('--bt-title'); return; }
    el.classList.add(...pageClasses(meta));
    if (meta.kind === 'opener') { el.style.setProperty('--bt-label', JSON.stringify(meta.label)); el.style.setProperty('--bt-title', JSON.stringify(meta.title || '')); }
    else { el.style.removeProperty('--bt-label'); el.style.removeProperty('--bt-title'); }
  }

  /* ---- reader decoration (exported HTML). Idempotent. ---- */
  let D = typeof document !== 'undefined' ? document : null;
  function wrapLeading(el, re, make, eatGap) {
    const walker = D.createTreeWalker(el, 4);
    let node; while ((node = walker.nextNode())) { if (node.data.trim()) break; }
    if (!node || node.parentElement?.closest('.bt-deco')) return false;
    const m = node.data.match(re); if (!m) return false;
    const before = node.data.slice(0, m.index + m[1].length);
    const token = m[2]; const rest = node.data.slice(m.index + m[0].length);
    const frag = D.createDocumentFragment(); if (before) frag.append(before);
    frag.append(make(token)); frag.append((m[3] && m[3].length && !eatGap ? ' ' : '') + rest);
    node.replaceWith(frag); return true;
  }
  function span(cls, text, attrs = {}) { const s = D.createElement('span'); s.className = 'bt-deco ' + cls; s.textContent = text; for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v); return s; }
  function decorateArrows(el) {
    // "→" at the start of the element or right after a <br>.
    const walker = D.createTreeWalker(el, 5); const hits = [];
    let node, lineStart = true;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) { if (node.tagName === 'BR') lineStart = true; continue; }
      if (node.parentElement?.closest('.bt-deco')) { lineStart = false; continue; }
      if (lineStart && rules.arrow.test(node.data)) hits.push(node);
      if (node.data.trim()) lineStart = false;
    }
    hits.forEach(n => { const m = n.data.match(rules.arrow); const f = D.createDocumentFragment(); if (m[1]) f.append(m[1]); f.append(span('bt-arw', m[2])); f.append(n.data.slice(m[0].length)); n.replaceWith(f); });
    return hits.length;
  }
  function decorateReader(root, meta) {
    if (!root) return;
    D = root.ownerDocument || document;
    const fresh = el => { if (el.hasAttribute('data-bt')) return false; el.setAttribute('data-bt', '1'); return true; };
    root.querySelectorAll('[data-book-kind="heading"]').forEach(h => {
      const t = h.querySelector('.book-design-title'); if (!t || !fresh(h)) return;
      const level = h.getAttribute('data-book-level');
      if (level === '1' && !wrapLeading(t, rules.step, c => span('bt-num', c, { 'data-n': String(rules.circledNumber(c)) }))) wrapLeading(t, rules.kick, n => span('bt-kick', n), meta?.kind !== 'toc');
      else wrapLeading(t, rules.step, c => span('bt-num', c, { 'data-n': String(rules.circledNumber(c)) }));
      if (meta?.kind === 'toc') { const w = D.createTreeWalker(t, 4); let last = null, n; while ((n = w.nextNode())) if (n.data.trim()) last = n; const m = last?.data.match(rules.tocPage); if (m) { last.data = last.data.slice(0, m.index); last.after(span('bt-tpage', m[1])); } const k = t.querySelector('.bt-kick'); if (k) h.setAttribute('data-bt-ch', CH_BY_NUM[k.textContent.padStart(2, '0')] || 'n'); }
    });
    [...root.querySelectorAll('p')].forEach(p => {
      if (p.closest('table, .book-design:not(.book-callout), li') || !fresh(p)) return;
      const text = p.textContent;
      if (FOOTER.test(text)) return;
      const eng = rules.isEnglish(text);
      if (rules.step.test(text) && wrapLeading(p, rules.step, c => span('bt-num', c, { 'data-n': String(rules.circledNumber(c)) })) && !eng) p.classList.add('bt-step');
      else if (rules.parenStep.test(text) && wrapLeading(p, rules.parenStep, n => span('bt-pnum', '(' + n + ')'))) p.classList.add('bt-pstep');
      if (decorateArrows(p) && rules.arrow.test(text.trimStart())) p.classList.add('bt-arrp');
      if (meta?.kind === 'opener-title' && wrapLeading(p, rules.leadNum, n => span('bt-lnum', n))) p.classList.add('bt-li');
      if (meta?.kind === 'toc') { const w = D.createTreeWalker(p, 4); let last = null, n; while ((n = w.nextNode())) if (n.data.trim()) last = n; const m = last?.data.match(rules.tocPage); if (m && isTocEntry(p)) { last.data = last.data.slice(0, m.index); last.after(span('bt-tpage', m[1])); } }
      if (eng) p.classList.add('bt-eng');
    });
    const asides = [...root.querySelectorAll('aside.book-callout')].filter(fresh);
    const kindOf = a => {
      const body = a.querySelector('.book-design-body') || a;
      const prev = a.previousElementSibling;
      const afterMedia = prev && (prev.matches('img, figure, table, .tableWrapper, [data-book-kind="media"]') || prev.querySelector?.(':scope > img'));
      return afterMedia && rules.source.test(body.textContent) ? 'src' : rules.memoKind(body.textContent);
    };
    let run = [];
    const flush = () => { const kinds = rules.unifyRun(run.map(kindOf)); run.forEach((a, i) => a.classList.add(kinds[i] === 'src' ? 'bt-src' : 'bt-memo-' + kinds[i])); run = []; };
    asides.forEach(a => {
      if (run.length && run[run.length - 1].nextElementSibling !== a) flush();
      run.push(a);
      decorateArrows(a.querySelector('.book-design-body') || a);
    });
    flush();
  }

  global.BookTheme = Object.freeze({ isThemed, classify, pageClasses, applyPage, decorateReader, rules, LABEL, CH_BY_NUM });
})(typeof window !== 'undefined' ? window : globalThis);
