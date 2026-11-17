// =====================================================================
// 책 에디터 v2 (관리자)  2026-11-15 — 에디터 정본 화면 통일
//  - 모든 책 = HTML 쪽(<div class="twp">). 글자만 고친다. 구조 변경(쪽 추가·삭제 등)은 어시스턴트 도구로.
//  - 쪽은 BookPage(공통 모듈)로 그린다 = 학생 서재 v2·PDF 저장·미리보기·인쇄와 같은 그림.
//  - 글 칸을 넘치게 하는 입력·붙여넣기는 들어가지 않고 토스트로 알린다(이미 넘친 쪽은 더 길어질 때만).
//  - 저장 = 고친 쪽만 서버(tr_book_pages.html). 저장 직전 서버 updated_at이 연 뒤 바뀌었으면 멈춘다. 버전 기록.
//  - 기존 에디터(admin-book-editor.html)와 파일을 공유하지 않는다(supabase-config.js, 글꼴 css만 같이 씀).
// =====================================================================
(function () {
  'use strict';
  const BP = window.BookPage;
  const S = { book: null, pages: [], secs: new Map(), roots: new Map(), dirty: new Set(), loadedAt: new Map(), base: new Map(), good: new Map(), orig: new Map(), scale: 1, composing: false, current: null };
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEV = params.get('dev') === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const KEEP = ['white-space', 'overflow-wrap', 'word-break', 'line-break', '-webkit-line-break'];

  function checkAuth() {
    if (DEV) return true;
    let u = null; try { u = JSON.parse(localStorage.getItem('iontoefl_user') || 'null'); } catch (_) {}
    if (!u || u.role !== 'admin') { alert('⚠️ 관리자만 접근할 수 있습니다.'); location.href = 'index.html'; return false; }
    return true;
  }
  function userEmail() { try { const u = JSON.parse(localStorage.getItem('iontoefl_user') || 'null'); return u && u.email ? u.email : 'dev'; } catch (_) { return 'dev'; } }
  function link(page, extra) { const p = new URLSearchParams(extra || {}); if (DEV) p.set('dev', '1'); const s = p.toString(); return page + (s ? '?' + s : ''); }
  function status(t, cls) { const s = $('status'); s.textContent = t; s.className = 'be2-status' + (cls ? ' ' + cls : ''); }
  let toastT = null;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3400); }
  const MSG_FULL = '이 쪽은 종이(210×280)가 꽉 차서 더 쓸 수 없어요. 다른 글을 줄이면 더 쓸 수 있어요.';
  const MSG_ENTER = '줄바꿈(Enter)은 이 에디터에서 넣을 수 없어요. 글자만 고칠 수 있어요.';

  // ---------- 책 목록 ----------
  async function showList() {
    $('bookTitle').textContent = '책 에디터 v2 · 책 고르기';
    const docs = await supabaseAPI.query('tr_book_documents', { select: 'id,title,kind,is_active,total_pages,updated_at', deleted_at: 'is.null', kind: 'eq.pages', order: 'sort_order.asc' });
    const box = document.createElement('div'); box.className = 'be2-list';
    box.innerHTML = '<p style="margin:0 0 10px;color:#6b7280;font-size:13px">에디터로 만든 책만 보여요(PDF 파일 책은 제외).</p>';
    docs.forEach((d) => { const a = document.createElement('a'); a.href = link('admin-book-editor-v2.html', { book: d.id }); a.innerHTML = '<span>' + esc(d.title || '(제목 없음)') + '</span><span style="color:#9ca3af;font-size:12.5px">' + (d.total_pages || 0) + '쪽 · ' + (d.is_active ? '공개' : '숨김') + '</span>'; box.appendChild(a); });
    $('stack').appendChild(box); $('outline').hidden = true; status('');
  }

  // ---------- 책 열기 ----------
  async function openBook(id) {
    const docs = await supabaseAPI.query('tr_book_documents', { id: 'eq.' + id, select: 'id,title,total_pages,updated_at,is_active,kind' });
    S.book = docs && docs[0];
    if (!S.book) throw new Error('책을 찾지 못했어요.');
    $('bookTitle').textContent = S.book.title || '책';
    document.title = (S.book.title || '책') + ' - 책 에디터 v2';
    const pages = await supabaseAPI.query('tr_book_pages', { book_id: 'eq.' + id, deleted_at: 'is.null', select: 'id,sort_order,updated_at,html,blocks', order: 'sort_order.asc' });
    S.pages = pages || [];
    const pv = $('btnPreview'); pv.href = link('admin-book-preview-v2.html', { book: id }); pv.hidden = false;
    if (!BP.isHtmlBook(S.pages)) {
      const n = document.createElement('div'); n.className = 'be2-note';
      n.innerHTML = '<b>아직 HTML 쪽으로 옮기지 않은 책이에요.</b><br>이 에디터는 HTML 쪽(인쇄 쪽 그대로)만 고칠 수 있어요. 옮긴 뒤에 여기서 글자를 고칠 수 있어요.<br><span style="color:#6b7280">(' + S.pages.filter(BP.isHtmlPage).length + ' / ' + S.pages.length + '쪽이 HTML)</span>';
      $('stack').appendChild(n); $('outline').hidden = true; status('읽기 전용'); return;
    }
    S.pages.forEach((p, i) => { S.loadedAt.set(p.id, p.updated_at || null); buildPage(p, i); });
    $('btnSave').hidden = false;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 200));
    S.pages.forEach((p) => { const root = S.roots.get(p.id); const ov = BP.overflowOf(root); S.base.set(p.id, ov); showOver(p.id, ov); root.querySelectorAll('.twp > .page').forEach((r) => S.good.set(r, r.innerHTML)); });
    buildOutline(); applyScale();
    status('준비됨 · 보이는 그대로 글자만 고쳐요 (저장해야 반영)');
  }

  function buildPage(p, i) {
    const sec = document.createElement('section'); sec.className = 'be2-page'; sec.dataset.id = p.id;
    sec.innerHTML = '<div class="be2-label"><span>' + (i + 1) + '쪽</span><span class="ov"></span></div><div class="be2-paper"><div class="be2-host"></div></div>';
    const host = sec.querySelector('.be2-host');
    const root = BP.render(host, p.html, { edit: true });
    S.secs.set(p.id, sec); S.roots.set(p.id, root);
    $('stack').appendChild(sec);
    root.querySelectorAll('.twp > .page').forEach((r) => makeEditable(r, p, root));
    sec.addEventListener('mousedown', () => setCurrent(p.id));
  }

  // 편집을 켜도 줄바꿈 계산이 서재·인쇄와 같도록: 켜기 전의 계산값을 그대로 고정한다
  function makeEditable(r, p, root) {
    S.orig.set(r, r.hasAttribute('style') ? r.getAttribute('style') : null);
    const cs = getComputedStyle(r);
    const fixed = KEEP.map((k) => [k, cs.getPropertyValue(k)]).filter((x) => x[1]);
    // plaintext-only는 크롬이 white-space를 pre-wrap으로 바꿔 줄바꿈·빈칸이 서재와 달라짐(옛 에디터 W1 11쪽 10px 넘침의 원인) → true로 켜고 서식 입력은 직접 막는다
    r.setAttribute('contenteditable', 'true');
    fixed.forEach(([k, v]) => r.style.setProperty(k, v, 'important'));
    r.setAttribute('spellcheck', 'false');
    r.style.setProperty('outline', 'none');
    r.querySelectorAll('img').forEach((im) => { im.setAttribute('contenteditable', 'false'); im.setAttribute('draggable', 'false'); });
    // 위치가 고정된 장식(쪽 번호·머리글 띠 등)은 고치지 않는다: 글이 늘어도 쪽 높이가 안 변해 넘침을 못 잡고, 본문 위로 겹침
    r.querySelectorAll('*').forEach((el) => { const pos = getComputedStyle(el).position; if ((pos === 'absolute' || pos === 'fixed') && !el.closest('[contenteditable="false"]')) el.setAttribute('contenteditable', 'false'); });
    const remember = () => { S.pre = caretOffset(root, r); };
    r.addEventListener('compositionstart', () => { S.composing = true; remember(); });
    r.addEventListener('compositionend', () => { S.composing = false; setTimeout(() => check(p, root, r), 0); });
    r.addEventListener('input', (e) => { if (e.isComposing || S.composing) { setDirty(p.id, true); return; } check(p, root, r); });
    r.addEventListener('beforeinput', (e) => {
      const t = e.inputType || '';
      if (!S.composing) remember();
      if (t.indexOf('format') === 0 || t === 'insertParagraph' || t === 'insertLineBreak' || t === 'insertFromDrop' || t === 'historyRedo' && false) { e.preventDefault(); if (t === 'insertParagraph' || t === 'insertLineBreak') toast(MSG_ENTER); }
    });
    r.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); toast(MSG_ENTER); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ['b', 'i', 'u'].includes(String(e.key).toLowerCase())) e.preventDefault();
    });
    r.addEventListener('paste', (e) => { e.preventDefault(); remember(); const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; document.execCommand('insertText', false, t.replace(/\s*\r?\n\s*/g, ' ')); });
    r.addEventListener('drop', (e) => e.preventDefault());
    r.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // 넘침 검사: 연 순간(또는 줄어든 뒤)보다 더 넘치면 되돌리고 토스트
  function check(p, root, r) {
    const ov = BP.overflowOf(root);
    const base = S.base.has(p.id) ? S.base.get(p.id) : 0;
    if (ov > base + 0.5) {
      r.innerHTML = S.good.get(r);
      setCaret(root, r, S.pre);
      toast(MSG_FULL);
      showOver(p.id, BP.overflowOf(root));
      return;
    }
    S.good.set(r, r.innerHTML);
    if (ov < base) S.base.set(p.id, ov);
    showOver(p.id, ov);
    setDirty(p.id, htmlOf(p.id) !== p.html);
  }

  function selOf(root) { return root.getSelection ? root.getSelection() : document.getSelection(); }
  function caretOffset(root, r) {
    const sel = selOf(root); if (!sel || !sel.rangeCount) return null;
    const rg = document.createRange(); rg.setStart(r, 0);
    try { rg.setEnd(sel.focusNode, sel.focusOffset); } catch (_) { return null; }
    return rg.toString().length;
  }
  function setCaret(root, r, off) {
    if (off == null) return;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); let n, left = off, last = null;
    while ((n = w.nextNode())) { last = n; if (left <= n.data.length) break; left -= n.data.length; }
    if (!last) return;
    const rg = document.createRange(); const pos = Math.min(left, (n || last).data.length);
    rg.setStart(n || last, pos); rg.collapse(true);
    const sel = selOf(root); sel.removeAllRanges(); sel.addRange(rg);
  }

  function showOver(id, ov) {
    const sec = S.secs.get(id); if (!sec) return;
    sec.querySelector('.be2-label .ov').innerHTML = ov > 0.5 ? '<span class="over">종이(280mm)보다 ' + Math.round(ov / 3.7795 * 10) / 10 + 'mm 넘침</span>' : '';
    const paper = sec.querySelector('.be2-paper');
    let edge = paper.querySelector('.be2-edge');
    if (ov > 0.5) { if (!edge) { edge = document.createElement('div'); edge.className = 'be2-edge'; edge.innerHTML = '<span>종이 끝 (280mm)</span>'; paper.appendChild(edge); } edge.style.top = Math.round(BP.H * S.scale) + 'px'; sec.style.paddingBottom = Math.ceil(ov * S.scale) + 'px'; }
    else { if (edge) edge.remove(); sec.style.paddingBottom = ''; }
    const oi = document.querySelector('.be2-oi[data-page="' + id + '"]'); if (oi) oi.classList.toggle('over', ov > 0.5);
  }

  function setDirty(id, on) {
    if (on) S.dirty.add(id); else S.dirty.delete(id);
    const sec = S.secs.get(id); if (sec) sec.classList.toggle('is-dirty', on);
    status(S.dirty.size ? '고친 쪽 ' + S.dirty.size + '개 · 저장 안 함' : '변경 없음', S.dirty.size ? 'edit' : '');
  }
  function setCurrent(id) { if (S.current) { const o = S.secs.get(S.current); if (o) o.classList.remove('is-current'); } S.current = id; const s = S.secs.get(id); if (s) s.classList.add('is-current'); }

  // 저장할 html: 원래 모양 그대로, 편집용 속성·고정값만 뺀다
  function htmlOf(id) {
    const root = S.roots.get(id); const twp = root && root.querySelector('.bp-root > .twp'); if (!twp) return null;
    const live = [...twp.querySelectorAll(':scope > .page')];
    const c = twp.cloneNode(true);
    [...c.querySelectorAll(':scope > .page')].forEach((r, i) => { const o = S.orig.get(live[i]); if (o == null) r.removeAttribute('style'); else r.setAttribute('style', o); });
    c.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    c.querySelectorAll('[spellcheck]').forEach((el) => el.removeAttribute('spellcheck'));
    c.querySelectorAll('img[draggable]').forEach((el) => el.removeAttribute('draggable'));
    // 입력 중 브라우저가 넣는 줄바꿈 없는 빈칸(nbsp)을 보통 빈칸으로 (원래 쪽에 nbsp가 없을 때만)
    const p = S.pages.find((x) => x.id === id);
    if (p && !/&nbsp;|\u00a0/i.test(p.html)) { const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.data.indexOf('\u00a0') >= 0) n.data = n.data.replace(/\u00a0/g, ' '); }
    return c.outerHTML;
  }
  const countImgs = (h) => (String(h).match(/<img\b/g) || []).length;

  async function save() {
    const btn = $('btnSave');
    const targets = S.pages.filter((p) => S.dirty.has(p.id));
    if (!targets.length) { status('변경 없음'); return; }
    btn.disabled = true; status('저장 중…', 'edit');
    try {
      const outs = [];
      for (const p of targets) {
        const html = htmlOf(p.id);
        if (!html || html.indexOf(BP.PREFIX) !== 0) throw new Error('쪽 모양을 읽지 못했어요. 새로고침한 뒤 다시 고쳐 주세요.');
        if (countImgs(html) !== countImgs(p.html)) throw new Error('그림이 지워진 쪽이 있어요(' + (S.pages.indexOf(p) + 1) + '쪽). 새로고침한 뒤 글자만 다시 고쳐 주세요.');
        if (html === p.html) { setDirty(p.id, false); continue; }
        outs.push({ p, html });
      }
      if (!outs.length) { status('변경 없음'); return; }
      const rows = await supabaseAPI.query('tr_book_pages', { id: 'in.(' + outs.map((o) => o.p.id).join(',') + ')', select: 'id,updated_at,deleted_at' });
      const stale = outs.filter((o) => { const r = (rows || []).find((x) => x.id === o.p.id); return !r || r.deleted_at || Date.parse(r.updated_at || 0) !== Date.parse(S.loadedAt.get(o.p.id) || 0); });
      if (stale.length) { status('새 버전이 있어요 · 저장 안 함', 'err'); alert('새 버전이 있어요. 새로고침한 뒤 다시 고쳐 주세요.\n\n(에디터를 연 뒤 다른 곳에서 ' + stale.map((o) => (S.pages.indexOf(o.p) + 1) + '쪽').join(', ') + '이 저장됐어요. 지금 고친 내용은 저장하지 않았어요.)'); return; }
      for (const o of outs) {
        const res = await supabaseAPI.patch('tr_book_pages', o.p.id, { html: o.html, updated_at: new Date().toISOString() });
        const at = (res && res.updated_at) || (Array.isArray(res) && res[0] && res[0].updated_at) || new Date().toISOString();
        try { await supabaseAPI.post('tr_book_page_versions', { page_id: o.p.id, book_id: S.book.id, blocks: o.p.blocks || [], html: o.html, created_by: userEmail() }); } catch (e) { console.warn('버전 기록 실패(본문은 저장됨)', e); }
        o.p.html = o.html; o.p.updated_at = at; S.loadedAt.set(o.p.id, at); setDirty(o.p.id, false);
      }
      try { const now = new Date().toISOString(); await supabaseAPI.patch('tr_book_documents', S.book.id, { updated_at: now }); } catch (_) {}
      buildOutline();
      status(outs.length + '개 쪽 저장됨 (서버 반영)');
    } catch (e) { console.error(e); status('저장 실패', 'err'); alert('저장하지 못했어요: ' + e.message); }
    finally { btn.disabled = false; }
  }

  function buildOutline() {
    const list = $('outlineList'); list.innerHTML = ''; let n = 0;
    S.pages.forEach((p, i) => {
      const root = S.roots.get(p.id); if (!root) return;
      root.querySelectorAll('h1, h2').forEach((h) => {
        const t = (h.textContent || '').trim(); if (!t) return;
        const b = document.createElement('button'); b.className = 'be2-oi' + (h.tagName === 'H2' ? ' lv2' : ''); b.dataset.page = p.id;
        b.innerHTML = '<span class="pn">' + (i + 1) + '</span>' + esc(t);
        if ((S.base.get(p.id) || 0) > 0.5) b.classList.add('over');
        b.addEventListener('click', () => { setCurrent(p.id); S.secs.get(p.id).scrollIntoView({ block: 'start' }); });
        list.appendChild(b); n++;
      });
    });
    if (!n) list.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:6px 8px">목차가 없어요.</div>';
  }

  function applyScale() {
    S.scale = parseFloat($('zoomSel').value) || 1;
    S.pages.forEach((p) => { const sec = S.secs.get(p.id); if (!sec) return; BP.place(sec.querySelector('.be2-paper'), sec.querySelector('.be2-host'), S.scale); showOver(p.id, BP.overflowOf(S.roots.get(p.id))); });
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  async function start() {
    if (!checkAuth()) return;
    $('btnBack').href = link('admin-book-list-v2.html', params.get('book') ? { book: params.get('book') } : null);   // 2026-11-17 책 목록 = 입문서 관리 v2
    $('btnSave').addEventListener('click', save);
    $('zoomSel').addEventListener('change', applyScale);
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') { e.preventDefault(); save(); } });
    window.addEventListener('beforeunload', (e) => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
    const id = params.get('book');
    if (!id) { location.replace(link('admin-book-list-v2.html')); return; }   // 책 고르기는 입문서 관리 v2에서
    try { await openBook(id); startPresence(id); }
    catch (e) { console.error(e); status('불러오지 못했어요: ' + e.message, 'err'); }
  }
  // "편집 중" 신호: 책 목록 v2가 읽는다. tr_book_editing 테이블이 없으면 조용히 끈다(SQL: 기능구현\에디터정본_화면통일\sql\tr_book_editing.sql)
  function startPresence(id) {
    let on = true;
    const beat = async () => {
      if (!on || document.hidden) return;
      try {
        const r = await fetch(SUPABASE_URL + '/rest/v1/tr_book_editing', { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ book_id: id, editor: userEmail(), seen_at: new Date().toISOString() }) });
        if (r.status === 404 || r.status === 401 || r.status === 403) on = false;
      } catch (_) {}
    };
    beat(); setInterval(beat, 30000);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('pagehide', () => { if (!on) return; try { fetch(SUPABASE_URL + '/rest/v1/tr_book_editing?book_id=eq.' + id + '&editor=eq.' + encodeURIComponent(userEmail()), { method: 'DELETE', keepalive: true, headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } }); } catch (_) {} });
  }
  window.BookEditorV2 = { get state() { return S; }, htmlOf, save };
  document.addEventListener('DOMContentLoaded', start);
})();
