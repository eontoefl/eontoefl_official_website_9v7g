// =====================================================================
// 책 에디터 v2 (관리자)  2026-11-15 — 에디터 정본 화면 통일
//  - 모든 책 = HTML 쪽(<div class="twp">). 글자만 고친다. 구조 변경(쪽 추가·삭제 등)은 어시스턴트 도구로.
//  - 예외 하나: 형광펜(2026-11-20). 글자를 드래그하면 뜨는 [형광펜]/[빼기] 또는 Ctrl+B. 책의 강조 태그(<strong>)로 감싸거나 푼다.
//    입문서 v2는 <strong>이 노랑 형광펜(POINT 안은 연분홍)으로 보인다. 글자 자체는 바뀌지 않는다.
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
  const MARK_CSS = '[data-be2-mark]{pointer-events:none}[data-be2-mark]::before{content:attr(data-be2-mark)}';
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
    // 2026-11-17 미리보기 대신: 학생 화면으로 보기(학생 서재 그대로) + PDF 저장(이름 없는 원본). 둘 다 "저장한 내용" 기준
    const unsavedOk = () => !S.dirty.size || confirm('저장하지 않은 고침 ' + S.dirty.size + '쪽은 아직 반영되지 않아요.\n저장한 내용으로 보여 드릴까요?');
    const sv = $('btnStudent'); sv.href = link('admin-book-student-view.html', { book: id }); sv.hidden = false;
    sv.addEventListener('click', (e) => { if (!unsavedOk()) e.preventDefault(); });
    const pd = $('btnPdf'); pd.hidden = false;
    pd.addEventListener('click', () => { if (!unsavedOk() || !window.AdminBookPdf) return; AdminBookPdf.save(id, { dev: DEV, onState: (m, err) => { if (m) status(m, err ? 'err' : ''); else status(S.dirty.size ? '고친 쪽 ' + S.dirty.size + '개 · 저장 안 함' : '준비됨', S.dirty.size ? 'edit' : ''); } }); });
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
    status('준비됨 · 보이는 그대로 글자만 고쳐요 · 글자를 드래그하면 형광펜 (저장해야 반영)');
  }

  function buildPage(p, i) {
    const sec = document.createElement('section'); sec.className = 'be2-page'; sec.dataset.id = p.id;
    sec.innerHTML = '<div class="be2-label"><span>' + (i + 1) + '쪽</span><span class="ov"></span></div><div class="be2-paper"><div class="be2-host"></div></div>';
    const host = sec.querySelector('.be2-host');
    const root = BP.render(host, p.html, { edit: true });
    const mk = document.createElement('style'); mk.textContent = MARK_CSS; root.appendChild(mk);   // 저장되는 .bp-root 밖이라 쪽 html에는 안 들어감
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
    // 위치가 고정된 요소는 생김새로 나눈다 (2026-11-24 정리. 예전: 위치 고정이면 전부 잠금)
    //  - 글 줄 안의 표식(그 줄에 다른 글자가 있음: → ① 2-1 EX): 장식. 잠그고 클릭은 그 줄 글자로 넘긴다(잠긴 칸에 커서가 빠지지 않게).
    //    표식 글자는 편집하는 동안 글자가 아니라 그림으로 보인다(data-be2-mark에 옮겨 MARK_CSS의 ::before로 그림, 저장할 때 htmlOf가 되돌림).
    //    줄 안에 잠긴 글자가 남아 있으면, 그 바로 뒤에서 한글을 조합할 때 크롬이 커서를 잠긴 글자 안으로 옮겨 두 번째 글자부터 사라진다(2026-11-24 재현).
    //    inert는 그림을 눌렀을 때 커서를 쪽 맨 앞으로 보내서 쓰지 않는다
    //  - 글자 없는 모양(분홍 테두리·띠): 잠근다
    //  - 글자가 있는 따로 선 상자(사진 손글씨·머리글·쪽 번호): 다른 글처럼 고친다. 늘어나 종이 아래로 나가면 넘침 검사가 잡는다
    const ownText = (el) => !!el && [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    r.querySelectorAll('*').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if ((pos !== 'absolute' && pos !== 'fixed') || el.closest('[contenteditable="false"]')) return;
      if (ownText(el.parentElement)) { el.setAttribute('contenteditable', 'false'); const t = el.children.length ? '' : el.textContent; el.setAttribute('data-be2-mark', t); if (t) el.textContent = ''; }
      else if (!el.textContent.trim()) el.setAttribute('contenteditable', 'false');
    });
    const remember = () => { S.pre = caretOffset(root, r); };
    r.addEventListener('compositionstart', () => { S.composing = true; remember(); });
    r.addEventListener('compositionend', () => { S.composing = false; setTimeout(() => check(p, root, r), 0); });
    r.addEventListener('input', (e) => { S.hlUndo = null; hideBubble(); if (e.isComposing || S.composing) { setDirty(p.id, true); return; } if (e.inputType === 'insertText' && e.data === '>') arrowFix(root); check(p, root, r); });
    r.addEventListener('beforeinput', (e) => {
      const t = e.inputType || '';
      if (!S.composing) remember();
      if (t.indexOf('format') === 0 || t === 'insertParagraph' || t === 'insertLineBreak' || t === 'insertFromDrop' || t === 'historyRedo' && false) { e.preventDefault(); if (t === 'insertParagraph' || t === 'insertLineBreak') toast(MSG_ENTER); }
    });
    r.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); toast(MSG_ENTER); return; }
      const mod = e.ctrlKey || e.metaKey;
      const k = String(e.key).toLowerCase();
      if (mod && k === 'b') { e.preventDefault(); hlToggle(); return; }
      if (mod && !e.shiftKey && k === 'z' && S.hlUndo && S.hlUndo.r === r) { e.preventDefault(); hlUndo(); return; }
      if (mod && ['i', 'u'].includes(k)) e.preventDefault();
    });
    r.addEventListener('mouseup', () => setTimeout(showBubble, 0));
    r.addEventListener('keyup', (e) => { if (e.shiftKey || e.key.indexOf('Arrow') === 0) showBubble(); });
    r.addEventListener('paste', (e) => { e.preventDefault(); remember(); const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; document.execCommand('insertText', false, t.replace(/\s*\r?\n\s*/g, ' ').replace(/->/g, '→')); });
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

  // -> 를 치면 바로 → 로 바꾼다 (2026-11-25 대표 요청). 붙여넣은 글의 -> 도 바꾼다(paste).
  // insertText로 바꿔서 Ctrl+Z 한 번이면 -> 로 돌아간다(자동 고침과 같은 동작)
  function arrowFix(root) {
    const sel = selOf(root); if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const n = sel.focusNode, o = sel.focusOffset;
    if (!n || n.nodeType !== 3 || o < 2 || n.data.slice(o - 2, o) !== '->') return;
    const rg = document.createRange(); rg.setStart(n, o - 2); rg.setEnd(n, o);
    sel.removeAllRanges(); sel.addRange(rg);
    document.execCommand('insertText', false, '→');
  }
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
    c.querySelectorAll('[data-be2-mark]').forEach((el) => { const t = el.getAttribute('data-be2-mark'); if (t && !el.children.length) el.textContent = t; el.removeAttribute('data-be2-mark'); });
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

  // ---------- 형광펜·서브텍스트 (2026-11-20) ----------
  // 고른 글자만 감싸거나(칠하기) 그 태그 밖으로 꺼낸다(빼기). 글자·다른 태그는 그대로 둔다.
  //  - 형광펜 = <strong> (입문서 v2는 노랑 형광펜, POINT 안은 연분홍)
  //  - 서브텍스트 = <span class="bp-sub" style="..."> 글자 22% 작게, 색 35% 연하게(흰색 35% 섞음). 2026-11-23 더 작고 연하게 바꿈.
  //    모양을 태그 안에 직접 적어서 학생 서재·PDF·인쇄 어디서나 같게 보인다(따로 CSS를 안 올려도 됨).
  const SUB_STYLE = 'font-size:0.78em;color:color-mix(in srgb, currentColor 65%, #fff)';
  const FMT = {
    hl: { sel: 'strong,b,mark', make: () => document.createElement('strong'), name: '형광펜' },
    sub: { sel: 'span.bp-sub', make: () => { const s = document.createElement('span'); s.className = 'bp-sub'; s.setAttribute('style', SUB_STYLE); return s; }, name: '서브텍스트' }
  };
  const HL = FMT.hl.sel;
  let bubble = null;
  function selCtx() {
    for (const [id, root] of S.roots) {
      const sel = selOf(root); if (!sel || !sel.rangeCount || sel.isCollapsed) continue;
      const rg = sel.getRangeAt(0); let n = rg.commonAncestorContainer; if (n.nodeType !== 1) n = n.parentElement;
      const r = n && n.closest('[contenteditable="true"]');
      if (!r || r.getRootNode() !== root) continue;
      const p = S.pages.find((x) => x.id === id); if (!p) continue;
      return { p, root, r, rg };
    }
    return null;
  }
  function editableText(n, r) { const e = n.parentElement; return e && r.contains(e) && !e.closest('[contenteditable="false"]'); }
  function fmtOf(n, r, sel) { let e = n.parentElement; while (e && e !== r) { if (e.matches(sel)) return e; e = e.parentElement; } return null; }
  function hlOf(n, r) { return fmtOf(n, r, HL); }
  // 고른 범위 안 글자 조각들을 각자 따로 떼어 낸다 (앞뒤 빈칸은 뺀다)
  function pieces(c) {
    const { rg, r } = c; const sc = rg.startContainer, so = rg.startOffset, ec = rg.endContainer, eo = rg.endOffset;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT); const list = []; let n;
    while ((n = w.nextNode())) if (n.data.length && rg.intersectsNode(n) && editableText(n, r)) list.push(n);
    const out = [];
    list.forEach((t) => {
      let s = t === sc ? so : 0, e = t === ec ? eo : t.data.length;
      const seg = t.data.slice(s, e); if (!seg.trim()) return;
      s += seg.length - seg.replace(/^\s+/, '').length; e -= seg.length - seg.replace(/\s+$/, '').length;
      let mid = t; if (s > 0) mid = t.splitText(s); if (e - s < mid.data.length) mid.splitText(e - s);
      out.push(mid);
    });
    return out;
  }
  function textsIn(c) { const w = document.createTreeWalker(c.r, NodeFilter.SHOW_TEXT); const a = []; let n; while ((n = w.nextNode())) if (c.rg.intersectsNode(n) && editableText(n, c.r) && n.data.trim()) a.push(n); return a; }
  function allFmt(c, k) { const a = textsIn(c); return a.length > 0 && a.every((n) => fmtOf(n, c.r, FMT[k].sel)); }
  function anyFmt(c, k) { return textsIn(c).some((n) => fmtOf(n, c.r, FMT[k].sel)); }
  function liftOut(anc, mid) {
    const after = document.createRange(); after.setStartAfter(mid); after.setEnd(anc, anc.childNodes.length);
    const afterFrag = after.extractContents();
    const mr = document.createRange(); mr.setStartBefore(mid); mr.setEnd(anc, anc.childNodes.length);
    const midFrag = mr.extractContents();
    const par = anc.parentNode, next = anc.nextSibling;
    par.insertBefore(midFrag, next);
    if (afterFrag.textContent) { const a2 = anc.cloneNode(false); a2.appendChild(afterFrag); par.insertBefore(a2, next); }
    if (!anc.textContent) anc.remove();
  }
  // 바로 앞(빈칸 하나 사이 포함)에 같은 모양 태그가 있으면 하나로 합친다
  function mergePrev(el) {
    let pv = el.previousSibling; const gap = pv && pv.nodeType === 3 && !pv.data.trim() ? pv : null; if (gap) pv = gap.previousSibling;
    if (pv && pv.nodeType === 1 && pv.cloneNode(false).isEqualNode(el.cloneNode(false))) { if (gap) pv.appendChild(gap); while (el.firstChild) pv.appendChild(el.firstChild); el.remove(); }
  }
  function fmtApply(k, on) {
    const f = FMT[k]; const c = selCtx(); if (!c) { toast(f.name + '을(를) 넣을 글자를 먼저 드래그해 주세요.'); return; }
    const before = c.r.innerHTML; S.pre = caretOffset(c.root, c.r);
    const segs = pieces(c); if (!segs.length) return;
    segs.forEach((t) => {
      if (on) { if (fmtOf(t, c.r, f.sel)) return; const el = f.make(); t.parentNode.insertBefore(el, t); el.appendChild(t); mergePrev(el); }
      else { let h; let guard = 0; while ((h = fmtOf(t, c.r, f.sel)) && guard++ < 6) liftOut(h, t); }
    });
    c.r.querySelectorAll(f.sel).forEach((el) => { if (!el.textContent) el.remove(); });
    const first = segs[0], last = segs[segs.length - 1];
    check(c.p, c.root, c.r);
    if (c.r.innerHTML === before) { hideBubble(); return; }
    if (!c.r.contains(first)) { S.hlUndo = null; hideBubble(); return; }   // 넘쳐서 되돌려짐(토스트는 check가 띄움)
    S.hlUndo = { r: c.r, html: before, p: c.p, root: c.root };
    try { const sel = selOf(c.root); const rg = document.createRange(); rg.setStart(first, 0); rg.setEnd(last, last.data.length); sel.removeAllRanges(); sel.addRange(rg); } catch (_) {}
    showBubble();
  }
  function hlApply(on) { fmtApply('hl', on); }
  function hlToggle() { const c = selCtx(); if (!c) { toast('형광펜을 칠할 글자를 먼저 드래그해 주세요.'); return; } fmtApply('hl', !allFmt(c, 'hl')); }
  function hlUndo() { const u = S.hlUndo; if (!u) return; S.hlUndo = null; u.r.innerHTML = u.html; check(u.p, u.root, u.r); hideBubble(); }
  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement('div'); bubble.className = 'be2-hl'; bubble.hidden = true;
    bubble.innerHTML = '<button type="button" data-k="hl" data-on="1" title="고른 글자에 형광펜 (Ctrl+B)"><span class="sw"></span>형광펜</button><button type="button" data-k="hl" data-on="0" title="고른 글자의 형광펜 빼기 (Ctrl+B)">빼기</button>'
      + '<span class="sep"></span><button type="button" data-k="sub" data-on="1" title="고른 글자를 작고 연하게"><span class="sw sub">가</span>서브텍스트</button><button type="button" data-k="sub" data-on="0" title="서브텍스트 빼기">빼기</button>';
    bubble.addEventListener('mousedown', (e) => e.preventDefault());
    bubble.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) fmtApply(b.dataset.k, b.dataset.on === '1'); });
    document.body.appendChild(bubble);
    $('canvas').addEventListener('scroll', hideBubble, { passive: true });
    document.addEventListener('mousedown', (e) => { if (!bubble.contains(e.target)) hideBubble(); });
    return bubble;
  }
  function hideBubble() { if (bubble) bubble.hidden = true; }
  function showBubble() {
    const c = selCtx(); const b = ensureBubble(); if (!c) { b.hidden = true; return; }
    const rects = [...c.rg.getClientRects()].filter((x) => x.width > 0); if (!rects.length) { b.hidden = true; return; }
    const top = Math.min(...rects.map((x) => x.top)), left = Math.min(...rects.map((x) => x.left)), right = Math.max(...rects.map((x) => x.right));
    ['hl', 'sub'].forEach((k) => { const all = allFmt(c, k); b.querySelector('[data-k="' + k + '"][data-on="1"]').classList.toggle('dim', all); b.querySelector('[data-k="' + k + '"][data-on="0"]').classList.toggle('dim', !anyFmt(c, k)); });
    b.hidden = false; const bw = b.offsetWidth, bh = b.offsetHeight;
    b.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, (left + right) / 2 - bw / 2)) + 'px';
    b.style.top = Math.max(64, top - bh - 8) + 'px';
  }

  function buildOutline() {
    const list = $('outlineList'); list.innerHTML = ''; let n = 0;
    S.pages.forEach((p, i) => {
      if (!S.roots.get(p.id)) return;
      const tpl = document.createElement('template'); tpl.innerHTML = p.html;   // 저장된 쪽 기준(편집 화면은 표식 글자를 그림으로 바꿔 두어 제목 번호가 빠짐)
      tpl.content.querySelectorAll('h1, h2').forEach((h) => {
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
  window.BookEditorV2 = { get state() { return S; }, htmlOf, save, hlApply };
  document.addEventListener('DOMContentLoaded', start);
})();
