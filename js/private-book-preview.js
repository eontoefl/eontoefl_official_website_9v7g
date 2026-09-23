/* View only. Auth/RLS is mandatory; no public adapter or progress/memo writes. */
(function (global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function bookFrom(search) {
    const p = new URLSearchParams(search);
    if (p.getAll('book').length !== 1 || !UUID.test(p.get('book') || '')) throw new Error('올바른 비공개 교재 UUID가 필요합니다');
    return p.get('book').toLowerCase();
  }
  function pageNumber(value, count) {
    const n = /^\d+$/.test(String(value)) ? Number(value) : 1;
    return Math.max(1, Math.min(count || 1, Number.isSafeInteger(n) ? n : 1));
  }
  function previewURL(base, book, page) {
    if (!UUID.test(book)) throw new Error('Invalid book');
    const u = new URL('admin-book-preview.html', base);
    u.search = new URLSearchParams({private:'1', book, p:String(page)}).toString(); return u;
  }
  function loginURL(base, book, page) {
    const next = previewURL(base, book, page), login = new URL('admin-private-books.html', base);
    // Construct an allowlisted destination; never forward a supplied next parameter.
    if (next.origin !== login.origin || !/\/admin-book-preview\.html$/.test(next.pathname)) throw new Error('Unsafe return URL');
    login.searchParams.set('next', next.pathname + next.search); return login;
  }
  function linkTarget(raw, base, book, count) {
    if (!raw) return null;
    if (raw.startsWith('#')) return {hash:raw.slice(1)};
    let u; try { u = new URL(raw, base); } catch (_) { return null; }
    if (u.username || u.password) return null;
    if (u.origin === new URL(base).origin && /\/admin-book-preview\.html$/.test(u.pathname)) {
      if (u.searchParams.get('book')?.toLowerCase() !== book || !/^\d+$/.test(u.searchParams.get('p') || '')) return null;
      return {page:pageNumber(u.searchParams.get('p'), count)};
    }
    if (u.protocol === 'https:' && u.origin !== new URL(base).origin) return {external:u.href};
    return null;
  }
  global.PrivateBookPreview = Object.freeze({bookFrom, pageNumber, previewURL, loginURL, linkTarget});
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id), base = location.href;
  let book, api, rows = [], current = 1, frame, content, generation = 0, stopped = false, refreshJob, timer;
  function clearPrivate(message) {
    stopped = true; generation++; clearInterval(timer); rows = []; content = null;
    $('pageHost').replaceChildren(); frame = null; $('toc').replaceChildren(); $('reader').hidden = true;
    $('bookTitle').textContent = '교재 미리보기'; $('editorLink').hidden = true; $('logout').hidden = true; $('status').textContent = message;
  }
  async function verify() {
    try { await api.ready(); }
    catch (error) {
      clearPrivate('관리자 인증을 확인할 수 없습니다. 교재 목록에서 다시 로그인해주세요');
      try {
        const r = await api.client.auth.getUser();
        if (!r.data?.user) location.replace(loginURL(base, book, current).href);
      } catch (_) {}
      throw error;
    }
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
    fragment.querySelectorAll('script,base,meta,link,iframe,object,embed,form').forEach(el => el.remove());
    fragment.querySelectorAll('[srcset]').forEach(el => el.removeAttribute('srcset'));
    fragment.querySelectorAll('img').forEach(img => {
      try { api.objectPath(img.getAttribute('src') || '', book); } catch (_) { img.removeAttribute('src'); }
      img.setAttribute('referrerpolicy','no-referrer');
    });
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
    const styles = ['css/book-design-system.css','css/book-design-viewer.css','css/private-book-preview.css'].map(p => new URL(p,base).href);
    const assetPrefix = new URL(SUPABASE_URL).origin + '/storage/v1/object/sign/book-private/' + book + '/';
    const policy = `default-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src ${assetPrefix}; style-src 'unsafe-inline' ${styles.join(' ')}; font-src 'self';`;
    const escape = s => s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    return '<!doctype html><html lang="ko" class="preview-page"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="' + escape(policy) + '"><meta name="viewport" content="width=device-width, initial-scale=1">' + styles.map(u => '<link rel="stylesheet" href="'+escape(u)+'">').join('') + '</head><body><article class="book-content" id="private-page-content"></article></body></html>';
  }
  async function show(number, headingIndex) {
    if (stopped || !rows.length) return;
    const ticket = ++generation; current = pageNumber(number, rows.length); updateControls();
    $('status').textContent = '비공개 페이지를 불러오는 중...';
    try {
      await verify();
      const row = await api.resolveAssets(rows[current - 1], book, true);
      if (stopped || ticket !== generation) return;
      const nextFrame = document.createElement('iframe'); nextFrame.title = '관리자 전용 교재 · 원본 페이지 ' + row.sort_order;
      nextFrame.setAttribute('sandbox','allow-same-origin'); nextFrame.setAttribute('referrerpolicy','no-referrer');
      nextFrame.addEventListener('load', () => {
        if (stopped || ticket !== generation) return;
        const doc = nextFrame.contentDocument; content = doc?.getElementById('private-page-content');
        if (!content) { clearPrivate('미리보기 보안 프레임을 열 수 없습니다'); return; }
        content.replaceChildren(prepareContent(row.html)); applyZoom();
        if (headingIndex !== undefined) headingsIn(content)[headingIndex]?.scrollIntoView();
        $('status').textContent = '서버 인증 완료 · 읽기 전용 · 학습 기록은 저장하지 않습니다';
      }, {once:true});
      nextFrame.srcdoc = frameShell(); frame = nextFrame; content = null; $('pageHost').replaceChildren(nextFrame);
      history.replaceState(null, '', previewURL(base, book, current).href);
    } catch (_) { if (!stopped) clearPrivate('비공개 페이지를 불러오지 못했습니다. 다시 로그인하거나 새로고침해주세요'); }
  }
  async function refresh() {
    if (stopped || !rows.length || refreshJob) return refreshJob;
    refreshJob = (async () => {
      const ticket = generation;
      try {
        await verify(); const row = await api.resolveAssets(rows[current - 1], book, true);
        if (stopped || ticket !== generation || !content) return;
        const sources = new Map();
        inert(row.html).querySelectorAll('img[src]').forEach(img => {
          try { sources.set(api.objectPath(img.getAttribute('src'),book), img.getAttribute('src')); } catch (_) {}
        });
        // Update only image URLs. Preserve the document, scroll, zoom and current page.
        content.querySelectorAll('img[src]').forEach(img => {
          try { const signed = sources.get(api.objectPath(img.getAttribute('src'),book)); if (signed) img.setAttribute('src',signed); else img.removeAttribute('src'); }
          catch (_) { img.removeAttribute('src'); }
        });
      } catch (_) { if (!stopped) clearPrivate('인증 또는 이미지 갱신에 실패했습니다. 새로고침해주세요'); }
    })();
    try { await refreshJob; } finally { refreshJob = null; }
  }
  async function start() {
    try {
      book = bookFrom(location.search); current = pageNumber(new URLSearchParams(location.search).get('p'), Number.MAX_SAFE_INTEGER);
      api = global.PrivateBook; if (!api) throw new Error('비공개 인증 클라이언트를 불러오지 못했습니다');
      await verify(); // Filename enables PrivateBook even without ?private=1.
      api.client.auth.onAuthStateChange((event, session) => {
        // Never make async Supabase calls under the auth callback lock.
        if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) clearPrivate('로그아웃되었습니다. 관리자 목록에서 다시 로그인해주세요');
      });
      const documents = await api.api.query('tr_book_documents', {id:'eq.' + book});
      if (stopped) return;
      if (documents.length !== 1 || documents[0].id?.toLowerCase() !== book) throw new Error('비공개 교재를 찾을 수 없습니다');
      const pages = await api.api.query('tr_book_pages', {book_id:'eq.' + book, order:'sort_order.asc'});
      if (stopped) return;
      if (!pages.length) throw new Error('저장된 페이지가 없습니다');
      if (pages.some(p => p.book_id?.toLowerCase() !== book)) throw new Error('교재 페이지 범위가 올바르지 않습니다');
      rows = api.canonicalizeAssets(pages, book); current = pageNumber(current, rows.length);
      $('bookTitle').textContent = documents[0].title || '비공개 교재';
      const editor = new URL('admin-book-editor.html',base); editor.search = new URLSearchParams({private:'1',book}).toString();
      $('editorLink').href = editor.href; $('editorLink').hidden = false; $('logout').hidden = false;
      buildTOC(); $('reader').hidden = false; await show(current);
      if (!stopped) timer = setInterval(refresh, api.refreshInterval || 600000);
    } catch (error) { if (!stopped) clearPrivate(error.message || '미리보기를 열 수 없습니다'); }
  }
  $('previous').addEventListener('click', () => show(current - 1));
  $('next').addEventListener('click', () => show(current + 1));
  $('jumpForm').addEventListener('submit', event => { event.preventDefault(); show($('pageNumber').value); });
  $('zoom').addEventListener('input', applyZoom);
  $('logout').addEventListener('click', async () => { clearPrivate('로그아웃 중...'); try { await api.logout(); $('status').textContent = '로그아웃되었습니다'; } catch (_) { $('status').textContent = '미리보기는 닫혔습니다. 관리자 목록에서 로그아웃을 다시 확인해주세요'; } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (frame) frame.hidden = true; }
    else if (!stopped) refresh().finally(() => { if (frame && !stopped) frame.hidden = false; });
  });
  global.addEventListener('pageshow', event => { if (event.persisted && !stopped) { if (frame) frame.hidden = true; refresh().finally(() => { if (frame && !stopped) frame.hidden = false; }); } });
  global.addEventListener('pagehide', () => { if (frame) frame.hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
  });
  start();
})(window);
