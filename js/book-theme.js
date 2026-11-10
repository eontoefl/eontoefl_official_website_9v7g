/* Book theme for the 이온토플 입문서 (DESIGN.md). Presentation only:
   never changes stored blocks/html text. Shared by the editor bundle
   (rules), the admin preview and the student viewer (decorateReader). */
(function (global) {
  'use strict';
  // Books that use this theme. book: extra page class (bt-book-<book>).
  // front: leading pages without the top band (used when a book has no chapter openers).
  const THEMED = new Map([
    ['e660266e-1b01-4d11-9254-81ea7e613344', { book: 'intro' }],          // 입문서
    // 단어장: 1쪽 표지, 2~4쪽 경고문·안내. jump: 왼쪽 목차에 넣는 쪽 바로가기.
    ['07f6cd4e-c737-40a1-b537-6e07af3d1aa5', { book: 'voca', front: 4, jump: [10, 20, 30, 40, 50, 60] }],
    // 단어장 v2 (인쇄 v2와 같은 내용·모양). ed: 쪽에 bt-ed-<ed> 클래스와 v2 읽기 꾸밈(decorateVocaV2).
    ['47282479-f8f6-4062-aa33-6c027d488d1a', { book: 'voca', ed: 'v2', front: 4, closing: 3, jump: [10, 20, 30, 40, 50, 60] }],
    ['f2800a43-0fd0-4bd7-81c9-6d9a14407a79', { book: 'trainw1' }],   // 문장 배열 표현장(W1 암기자료). 모양은 book-theme-eon.css 끝 .bt-book-trainw1
  ]);
  const CH_BY_NUM = { '06': 'r', '07': 'l', '08': 'w', '09': 's' };
  const LABEL = { n: 'TOEFL', r: 'READING', l: 'LISTENING', w: 'WRITING', s: 'SPEAKING' };
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const FOOTER = /^\s*-\s*\d{1,4}\s*-\s*$/;

  const rules = {
    kick: /^(\s*)(\d{1,2}(?:-\d{1,2})?)\.?(\s+)(?=\S)/,        // "2 시험 기본 정보"
    tocPage: /\s(\d{1,3})\s*$/,                                  // "토플 이해하기  28"
    step: /^(\s*)([①-⑳])(\s*)/,
    parenStep: /^(\s*)\((\d{1,2})\)(\s+)(?=\S)/,
    arrow: /^(\s*)(→|->)(\s*)/,
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
    // Passages, scripts and sample answers are English by nature: card without the "영어 예시" label.
    engPlain(text) {
      const t = String(text || '').trim().replace(/^[①-⑳]\s*/, '');
      return t.length > 300 || /^(Woman|Man|Interviewer|Professor|Student)\s*:/i.test(t) || /Sample Answer/i.test(t);
    },
    isEnglish(text) {
      const t = String(text || '').trim().replace(/^[①-⑳]\s*/, '');
      return t.length > 50 && /^[A-Za-z"“(]/.test(t) && /^[A-Za-z0-9\s,.'"“”’‘…;:!?()\-\/_%&$①-⑳]+$/.test(t);
    },
  };

  function isThemed(bookId) { return THEMED.has(String(bookId || '')); }
  // 왼쪽 목차에 넣을 쪽 바로가기 번호 (1부터 세는 쪽 번호). 없으면 빈 배열.
  function jumpPages(bookId, total) {
    const cfg = THEMED.get(String(bookId || '')) || {};
    return (cfg.jump || []).filter(n => !total || n <= total);
  }

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
  function classify(pages, bookId) {
    const cfg = THEMED.get(String(bookId || '')) || {};
    const metas = []; let ch = 'n'; let firstOpener = -1; let pendingTitle = null;
    pages.forEach((p, i) => {
      const frag = parse(p.html); const blocks = blocksOf(frag); const heads = headingTexts(frag);
      const meta = { index: i, ch, kind: 'body', band: true, num: '', label: '', title: '', book: cfg.book || '', ed: cfg.ed || '' };
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
    const frontEnd = firstOpener >= 0 ? firstOpener : (cfg.front || 0);
    metas.forEach(m => { if (m.index < frontEnd && m.kind === 'body') { m.kind = 'front'; m.band = false; } });
    if (metas.length && metas[metas.length - 1].kind === 'body') { const last = metas[metas.length - 1]; last.kind = 'last'; last.band = false; }
    // closing: 뒤표지 바로 앞 N쪽(편지·기록·메모)은 띠 없이 맺음 쪽으로
    if (cfg.closing) { let i = metas.length - 1; while (i >= 0 && metas[i].kind === 'cover') i--; for (let k = 0; k < cfg.closing && i >= 0; k++, i--) if (metas[i].kind === 'body' || metas[i].kind === 'last') { metas[i].kind = 'closing'; metas[i].band = false; } }
    return metas;
  }

  function pageClasses(meta) {
    return ['bt-eon', 'bt-ch-' + meta.ch, 'bt-kind-' + meta.kind].concat(meta.band ? ['bt-band'] : [], meta.book ? ['bt-book-' + meta.book] : [], meta.ed ? ['bt-ed-' + meta.ed] : []);
  }
  function applyPage(el, meta) {
    if (!el) return;
    [...el.classList].filter(c => c === 'bt-eon' || c === 'bt-band' || c.startsWith('bt-ch-') || c.startsWith('bt-kind-') || c.startsWith('bt-book-') || c.startsWith('bt-ed-')).forEach(c => el.classList.remove(c));
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
    let node, lineStart = true, seen = false;
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) { if (node.tagName === 'BR') lineStart = true; continue; }
      if (node.parentElement?.closest('.bt-deco')) { lineStart = false; seen = true; continue; }
      if (lineStart && rules.arrow.test(node.data)) hits.push({ n: node, lead: !seen });
      if (node.data.trim()) { lineStart = false; seen = true; }
    }
    hits.forEach(({ n, lead }) => { const m = n.data.match(rules.arrow); const f = D.createDocumentFragment(); if (m[1]) f.append(m[1]); f.append(span(lead ? 'bt-arw bt-arw-lead' : 'bt-arw', lead ? m[2] + m[3] : m[2])); f.append((lead ? '' : m[3]) + n.data.slice(m[0].length)); n.replaceWith(f); });
    return hits.length;
  }
  /* ---- 단어장 v2 읽기 꾸밈 (인쇄 v2 만들기 스크립트와 같은 규칙). 글자는 바꾸지 않고 감싸기만 한다. ---- */
  const V2_POS = /\((adv|adj|v|n|conj|prep|phrase|phrasal verb|v\/adj|n\/v)\)\s*/g;
  const V2_POS_SPECIAL = [['(v: 동사구)', ['phrase', 'etc', '']], ['(v: 과거/과거분사)', ['v', 'v', 'p.p.']], ['(v:현재분사/동명사)', ['v', 'v', '-ing']]];
  const posCls = p => ({ n: 'n', v: 'v', adj: 'adj', adv: 'adv' })[p] || 'etc';
  function chip(label, cls, extra) { const f = D.createDocumentFragment(); f.append(span('bt-pos ' + cls, label)); if (extra) f.append(span('bt-posx', extra)); f.append(' '); return f; }
  function textNodes(el) { const w = D.createTreeWalker(el, 4); const out = []; let n; while ((n = w.nextNode())) out.push(n); return out; }
  function decorateVocaV2(root) {
    if (root.hasAttribute('data-bt-v2')) return; root.setAttribute('data-bt-v2', '1');
    const rows = [...root.querySelectorAll('table tr')].filter(tr => tr.children.length === 3 && tr.children[0].tagName === 'TD');
    rows.forEach(tr => {
      tr.children[0].classList.add('bt-hw');
      // 동의어: 한 줄에 하나씩, ①② 묶음은 번호를 첫 줄에
      const td = tr.children[1]; td.classList.add('bt-syn');
      const c = td.cloneNode(true); c.querySelectorAll('br').forEach(b => b.replaceWith(',')); c.querySelectorAll('p').forEach((pp, i) => { if (i > 0) pp.prepend(','); });
      const raw = c.textContent.replace(/\s+/g, ' ').trim();
      if (raw) {
        const groups = raw.split(/(?=[\u2460-\u2469])/).map(s => s.trim()).filter(Boolean).map(g => { const m = g.match(/^([\u2460-\u2469])\s*(.*)$/); return { num: m ? m[1] : '', items: (m ? m[2] : g).split(/\s*,\s*/).map(s => s.trim()).filter(Boolean) }; });
        const p = td.querySelector('p') || td; td.querySelectorAll('p').forEach((pp, i) => { if (i > 0) pp.remove(); });
        p.replaceChildren(...groups.flatMap(g => g.items.map((it, k) => { const s = span('bt-sa', ''); if (k === 0 && g.num) s.append(span('bt-sgn', g.num)); s.append(it); return s; })));
      }
      // 품사 칩, EX 표시
      const def = tr.children[2]; def.classList.add('bt-def');
      textNodes(def).forEach(t => {
        for (const [a, [label, cls, extra]] of V2_POS_SPECIAL) { const i = t.data.indexOf(a); if (i < 0) continue; const f = D.createDocumentFragment(); f.append(t.data.slice(0, i), chip(label, cls, extra), t.data.slice(i + a.length).replace(/^\s+/, '')); t.replaceWith(f); return; }
        if (!V2_POS.test(t.data)) return; V2_POS.lastIndex = 0;
        const f = D.createDocumentFragment(); let last = 0; let m;
        while ((m = V2_POS.exec(t.data))) { f.append(t.data.slice(last, m.index), chip(m[1], posCls(m[1]))); last = m.index + m[0].length; }
        f.append(t.data.slice(last)); t.replaceWith(f);
      });
      def.querySelectorAll('p').forEach(p => {
        p.innerHTML = p.innerHTML.replace(/ex\)\s*((?:(?!<br).)*?(?:<br>\s*\d+\.(?:(?!<br).)*)*)(?=<br|$)/g, (m, body) => '<span class="bt-deco bt-exs"><span class="bt-exl">EX</span>' + body + '</span>');
      });
    });
    // 한글 설명(* 줄, 한 칸짜리 설명 줄, 표 밖 메모)은 손글씨
    const table = root.querySelector('table');
    if (table) textNodes(root).forEach(n => {
      const t = n.data.trim(); if (!/[가-힣]/.test(t) || n.parentElement.closest('th, .bt-deco')) return;
      const tr = n.parentElement.closest('tr');
      if (t.startsWith('*') || (tr && tr.children.length === 1) || !n.parentElement.closest('table')) { const s = span('bt-kn', n.data); n.replaceWith(s); }
    });
    // 쪽 위 단어 범위 (첫 단어 ~ 마지막 단어)
    if (rows.length && !root.querySelector(':scope > .bt-range')) {
      const f = rows[0].children[0].textContent.trim(), l = rows[rows.length - 1].children[0].textContent.trim();
      const r = D.createElement('div'); r.className = 'bt-range'; const b1 = D.createElement('b'); b1.textContent = f; const b2 = D.createElement('b'); b2.textContent = l; r.append(b1, ' ~ ', b2); root.prepend(r);
    }
  }

  // v2 앞·맺음 쪽: 인쇄 v2처럼 큰 번호 제목, 분홍 번호, 공부방법 점 줄, 경고문·편지 가운데 배치. 쪽 번호는 '내벨업보카 | 03'.
  function decorateVocaV2Page(root, meta) {
    if (root.hasAttribute('data-bt-v2p')) return; root.setAttribute('data-bt-v2p', '1');
    root.querySelectorAll('p.book-page-number').forEach(p => {
      const m = p.textContent.match(/\d+/); if (!m) return;
      p.classList.add('bt-v2ft'); p.replaceChildren(span('bt-ftt', '내벨업보카'), span('bt-ftbar', ''), span('bt-ftn', m[0].padStart(2, '0')));
    });
    if (meta.kind !== 'front' && meta.kind !== 'closing') return;
    const kids = [...root.children];
    const h1 = kids.find(k => k.matches('[data-book-kind="heading"]'));
    const title = h1 ? h1.textContent.replace(/\s+/g, ' ').trim() : '';
    if (title === '경고문') root.classList.add('bt-v2-warn');
    else if (meta.kind === 'closing' && kids.some(k => k.matches('p:not(.book-page-number)') && k.style.textAlign === 'center') && !root.querySelector('img')) root.classList.add('bt-v2-letter');
    else if (meta.kind === 'front') root.classList.add('bt-v2-guide');
    let sec = '';
    kids.forEach(k => {
      if (k.matches('[data-book-kind="heading"]')) { sec = ((k.textContent.trim().match(/^(\d{2})\s/) || [])[1] || ''); k.classList.add('bt-v2h'); return; }
      k.setAttribute('data-bt-sec', sec);
      if (!k.matches('p') || k.classList.contains('book-page-number')) return;
      const w = D.createTreeWalker(k, 4); const first = w.nextNode(); const m = first && first.data.match(/^\s*(\d+)\.\s+/);
      if (!m) return;
      first.data = first.data.slice(m[0].length);
      k.prepend(span(sec === '03' ? 'bt-v2dot' : 'bt-v2n', m[1]));
      k.classList.add(sec === '03' ? 'bt-v2ts' : 'bt-v2li');
    });
    if (root.classList.contains('bt-v2-letter')) {
      const ps = kids.filter(k => k.matches('p:not(.book-page-number)'));
      if (ps[0]) { ps[0].classList.add('bt-v2-sub'); const bar = D.createElement('div'); bar.className = 'bt-deco bt-v2-bar'; ps[0].after(bar); }
      if (ps.length > 1) ps[ps.length - 1].classList.add('bt-v2-sign');
    }
    if (root.classList.contains('bt-v2-warn') && h1) { const ic = span('bt-v2-ic', '!'); h1.before(ic); const bar = D.createElement('div'); bar.className = 'bt-deco bt-v2-bar'; h1.after(bar); }
  }

  function decorateReader(root, meta) {
    if (!root) return;
    D = root.ownerDocument || document;
    if (meta && meta.ed === 'v2' && meta.kind === 'body') decorateVocaV2(root);
    if (meta && meta.ed === 'v2' && meta.kind !== 'cover') decorateVocaV2Page(root, meta);
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
      if (eng) { p.classList.add('bt-eng'); if (rules.engPlain(text)) p.classList.add('bt-eng-plain'); }
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

  global.BookTheme = Object.freeze({ isThemed, jumpPages, classify, pageClasses, applyPage, decorateReader, rules, LABEL, CH_BY_NUM });
})(typeof window !== 'undefined' ? window : globalThis);
