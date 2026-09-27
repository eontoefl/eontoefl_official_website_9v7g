/* Read only. Matches legacy client-side admin UI gating, NOT server authorization. */
(function (global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function bookFrom(search) {
    const p = new URLSearchParams(search);
    if (p.getAll('book').length !== 1 || !UUID.test(p.get('book') || '')) throw new Error('올바른 교재 UUID가 필요합니다');
    return p.get('book').toLowerCase();
  }
  function pageNumber(value, count) {
    const n = /^\d+$/.test(String(value)) ? Number(value) : 1;
    return Math.max(1, Math.min(count || 1, Number.isSafeInteger(n) ? n : 1));
  }
  function previewURL(base, book, page) {
    if (!UUID.test(book)) throw new Error('Invalid book');
    const u = new URL('admin-book-preview.html', base);
    u.search = new URLSearchParams({book, p:String(page)}).toString();
    if (localDev(base)) u.searchParams.set('dev', '1');
    return u;
  }
  function localDev(base) {
    const u = new URL(base);
    return ['http:', 'https:'].includes(u.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && u.searchParams.get('dev') === '1';
  }
  function hasAdmin(base, storage) {
    if (localDev(base)) return true;
    try { return JSON.parse(storage.getItem('iontoefl_user') || 'null')?.role === 'admin'; }
    catch (_) { return false; }
  }
  const IMAGE_ROOT = 'https://qpqjevecjejvbeuogtbx.supabase.co/storage/v1/object/public/guide-images/';
  function assetPrefixes(book) {
    if (!UUID.test(book)) throw new Error('Invalid book');
    return [IMAGE_ROOT + 'book-migrations/' + book + '/', IMAGE_ROOT + 'book/'];
  }
  function assetURL(raw, book) {
    try {
      if (!raw || /[\\\s]/.test(raw)) return null;
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
      const decoded = decodeURIComponent(u.pathname);
      if (/%|\\|[\x00-\x1f\x7f]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return null;
      return assetPrefixes(book).some(prefix => u.href.startsWith(prefix) && u.href.length > prefix.length) ? u.href : null;
    } catch (_) { return null; }
  }
  function linkTarget(raw, base, book, count) {
    if (!raw) return null;
    if (raw.startsWith('#')) return {hash:raw.slice(1)};
    let u; try { u = new URL(raw, base); } catch (_) { return null; }
    if (u.username || u.password) return null;
    if (u.origin === new URL(base).origin && /\/admin-book-preview\.html$/.test(u.pathname)) {
      if (u.searchParams.getAll('book').length !== 1 || u.searchParams.getAll('p').length !== 1 || u.searchParams.get('book')?.toLowerCase() !== book || !/^\d+$/.test(u.searchParams.get('p') || '')) return null;
      return {page:pageNumber(u.searchParams.get('p'), count)};
    }
    if (u.protocol === 'https:' && u.origin !== new URL(base).origin) return {external:u.href};
    return null;
  }
  global.BookAdminPreview = Object.freeze({bookFrom, pageNumber, previewURL, linkTarget, localDev, hasAdmin, assetURL, assetPrefixes});
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id), base = location.href;
  let book, api, rows = [], current = 1, frame, content, generation = 0, stopped = false, timer;
  function clearPreview(message) {
    stopped = true; generation++; clearInterval(timer); rows = []; content = null;
    $('pageHost').replaceChildren(); frame = null; $('toc').replaceChildren(); $('reader').hidden = true;
    $('bookTitle').textContent = '교재 미리보기'; $('editorLink').hidden = true; $('status').textContent = message;
  }
  function verify() {
    let allowed = false;
    try { allowed = hasAdmin(location.href, global.localStorage); } catch (_) {}
    if (allowed) return;
    clearPreview('기존 관리자 로그인이 필요합니다. 사이트에서 로그인한 뒤 다시 열어주세요');
    throw new Error('관리자만 접근할 수 있습니다');
  }
  function inert(html) { const t = document.createElement('template'); t.innerHTML = html || ''; return t.content; }
  function headingsIn(root) {
    return [...root.querySelectorAll('h1,h2,h3,[data-book-kind="heading"]')].filter(h => !h.parentElement?.closest('h1,h2,h3,[data-book-kind="heading"]'));
  }
  function buildTOC() {
    const list = $('toc'); list.replaceChildren();
    rows.forEach((row, index) => {
      for (const [headingIndex, h] of headingsIn(inert(row.html)).entries()) {
        const text = h.textContent.trim(); if (!text) continue;
        const button = document.createElement('button'); button.type = 'button'; button.dataset.page = String(index + 1);
        button.textContent = `${index + 1} · ${text}`; if (h.matches('h2,h3')) button.className = 'subheading';
        button.addEventListener('click', () => show(index + 1, headingIndex)); list.append(button);
      }
    });
    if (!list.childElementCount) list.textContent = '제목 목차가 없습니다. 페이지 이동을 이용하세요';
  }
  function updateControls() {
    $('pageNumber').value = String(current); $('pageNumber').max = String(rows.length); $('totalPages').textContent = '/ ' + rows.length;
    $('sourcePage').textContent = '원본 페이지 ' + String(rows[current - 1].sort_order ?? '미지정');
    $('previous').disabled = current <= 1; $('next').disabled = current >= rows.length;
    for (const button of $('toc').querySelectorAll('button')) {
      if (Number(button.dataset.page) === current) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
    }
  }
  function applyZoom() {
    const zoom = Math.max(80, Math.min(150, Number($('zoom').value) || 100));
    $('zoomValue').textContent = zoom + '%';
    if (content) content.style.setProperty('--preview-zoom', String(zoom / 100));
  }
  function navigateLink(target) {
    if (target.page) show(target.page);
    else if (target.external) global.open(target.external, '_blank', 'noopener,noreferrer');
    else if (target.hash && content) {
      let id; try { id = decodeURIComponent(target.hash); } catch (_) { return; }
      [...content.querySelectorAll('[id]')].find(el => el.id === id)?.scrollIntoView();
    }
  }
  function prepareContent(html) {
    const fragment = inert(html);
    // No DOMPurify vendor exists in this release. Script-disabled sandbox + CSP
    // is the security boundary, not these defense-in-depth resource restrictions.
    // NEVER add allow-scripts, allow-forms, allow-popups or top-navigation.
    fragment.querySelectorAll('script,base,meta,link,iframe,object,embed,form,animate,set,animateMotion,animateTransform').forEach(el => el.remove());
    fragment.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || ['srcset','srcdoc','action','formaction','ping','xlink:href'].includes(name)) el.removeAttribute(attr.name);
        else if (['src','poster','background'].includes(name)) {
          const safe = assetURL(attr.value, book);
          if (safe) el.setAttribute(attr.name, safe); else el.removeAttribute(attr.name);
        } else if (name === 'href' && !el.matches('a,area')) el.removeAttribute(attr.name);
      }
    });
    fragment.querySelectorAll('img').forEach(img => img.setAttribute('referrerpolicy','no-referrer'));
    fragment.querySelectorAll('a,area').forEach(anchor => {
      const target = linkTarget(anchor.getAttribute('href'), base, book, rows.length);
      for (const attr of ['href','target','download','ping']) anchor.removeAttribute(attr);
      if (!target) return;
      anchor.setAttribute('role','link'); anchor.setAttribute('tabindex','0');
      anchor.addEventListener('click', event => { event.preventDefault(); navigateLink(target); });
      anchor.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); navigateLink(target); } });
    });
    return fragment;
  }
  function frameShell() {
    const styles = ['css/book-design-system.css','css/book-design-viewer.css','css/private-book-preview.css','css/book-page-footer.css'].map(p => new URL(p,base).href);
    const assetPrefix = assetPrefixes(book).join(' ');
    const policy = `default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src ${assetPrefix}; style-src 'unsafe-inline' ${styles.join(' ')}; font-src 'self';`;
    const escape = s => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    return '<!doctype html><html lang="ko" class="preview-page"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '"><meta name="viewport" content="width=device-width, initial-scale=1">' + styles.map(u => '<link rel="stylesheet" href="'+escape(u)+'">').join('') + '</head><body><article class="book-content bookv2-content" id="admin-page-content"></article></body></html>';
  }
  async function show(number, headingIndex) {
    if (stopped || !rows.length) return;
    const ticket = ++generation; current = pageNumber(number, rows.length); updateControls();
    $('status').textContent = '교재 페이지를 불러오는 중...';
    try {
      verify();
      const row = rows[current - 1];
      if (stopped || ticket !== generation) return;
      const nextFrame = document.createElement('iframe'); nextFrame.title = '관리자 전용 교재 · 원본 페이지 ' + row.sort_order;
      nextFrame.hidden = document.visibilityState === 'hidden';
      nextFrame.setAttribute('sandbox','allow-same-origin'); nextFrame.setAttribute('referrerpolicy','no-referrer');
      nextFrame.addEventListener('load', () => {
        if (stopped || ticket !== generation) return;
        try { verify(); } catch (_) { return; }
        const doc = nextFrame.contentDocument; content = doc?.getElementById('admin-page-content');
        if (!content) { clearPreview('미리보기 보안 프레임을 열 수 없습니다'); return; }
        content.replaceChildren(prepareContent(row.html)); global.BookPageFooter?.decorateReader(content); applyZoom();
        if (headingIndex !== undefined) headingsIn(content)[headingIndex]?.scrollIntoView();
        $('status').textContent = '기존 관리자 역할 확인 · 읽기 전용 · 학습 기록은 저장하지 않습니다';
      }, {once:true});
      nextFrame.srcdoc = frameShell(); frame = nextFrame; content = null; $('pageHost').replaceChildren(nextFrame);
      history.replaceState(null, '', previewURL(base, book, current).href);
    } catch (_) { if (!stopped) clearPreview('교재 페이지를 불러오지 못했습니다. 새로고침해주세요'); }
  }
  function recheck() {
    if (stopped) return;
    try { verify(); if (frame && document.visibilityState !== 'hidden') frame.hidden = false; }
    catch (_) { /* verify already clears the reader */ }
  }
  async function start() {
    try {
      book = bookFrom(location.search); current = pageNumber(new URLSearchParams(location.search).get('p'), Number.MAX_SAFE_INTEGER);
      verify();
      api = typeof supabaseAPI !== 'undefined' ? supabaseAPI : null;
      if (!api) throw new Error('교재 데이터 API를 불러오지 못했습니다');
      const documents = await api.query('tr_book_documents', {id:'eq.' + book});
      if (stopped) return;
      verify();
      if (documents.length !== 1 || documents[0].id?.toLowerCase() !== book) throw new Error('교재를 찾을 수 없습니다');
      const pages = await api.query('tr_book_pages', {book_id:'eq.' + book, order:'sort_order.asc'});
      if (stopped) return;
      verify();
      if (!pages.length) throw new Error('저장된 페이지가 없습니다');
      if (pages.some(p => p.book_id?.toLowerCase() !== book)) throw new Error('교재 페이지 범위가 올바르지 않습니다');
      rows = pages; current = pageNumber(current, rows.length);
      $('bookTitle').textContent = documents[0].title || '교재';
      const editor = new URL('admin-book-editor.html',base); editor.search = new URLSearchParams({book}).toString();
      if (localDev(base)) editor.searchParams.set('dev', '1');
      $('editorLink').href = editor.href; $('editorLink').hidden = false;
      buildTOC(); $('reader').hidden = false; await show(current);
      if (!stopped) timer = setInterval(recheck, 30000);
    } catch (error) { if (!stopped) clearPreview(error.message || '미리보기를 열 수 없습니다'); }
  }
  $('previous').addEventListener('click', () => show(current - 1));
  $('next').addEventListener('click', () => show(current + 1));
  $('jumpForm').addEventListener('submit', event => { event.preventDefault(); show($('pageNumber').value); });
  $('zoom').addEventListener('input', applyZoom);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (frame) frame.hidden = true; }
    else recheck();
  });
  global.addEventListener('pageshow', event => { if (event.persisted && !stopped) { if (frame) frame.hidden = true; recheck(); } });
  global.addEventListener('storage', event => { if (event.key === 'iontoefl_user' || event.key === null) recheck(); });
  global.addEventListener('focus', recheck);
  global.addEventListener('pagehide', () => { if (frame) frame.hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
  });
  start();
})(window);
