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
  const MSG_ENTER = '줄바꿈(Enter)은 화살표(→) 줄에서만 할 수 있어요. 누르면 아래에 새 화살표 줄이 생겨요.';

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
    buildOutline(); applyScale(); if (S.pages.some((p) => /<style data-v2/.test(p.html))) ensureFloat();
    status('준비됨 · 글자를 드래그하면 형광펜, 서브텍스트, 밑줄 · 오른쪽 버튼으로 줄 넣기 (저장해야 반영)');
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
    r.addEventListener('compositionstart', () => { typingSnap(p, root, r, 'insertText'); S.composing = true; remember(); });
    r.addEventListener('compositionend', () => { S.composing = false; setTimeout(() => check(p, root, r), 0); });
    r.addEventListener('input', (e) => { S.hlUndo = null; hideBubble(); if (e.isComposing || S.composing) { setDirty(p.id, true); return; } if (e.inputType === 'insertText' && e.data === '>') arrowFix(p, root, r); check(p, root, r); });
    r.addEventListener('beforeinput', (e) => {
      const t = e.inputType || '';
      if (t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); if (t === 'historyUndo') undo(p, root, r); else redo(p, root, r); return; }
      if (!S.composing) remember();
      if (t.indexOf('format') !== 0 && t !== 'insertParagraph' && t !== 'insertLineBreak' && t !== 'insertFromDrop') typingSnap(p, root, r, t);
      if (t === 'insertParagraph' || t === 'insertLineBreak') { e.preventDefault(); S.imeAt = Date.now(); enterAfterIme(p, root, r); return; }
      if (t.indexOf('format') === 0 || t === 'insertFromDrop') e.preventDefault();
    });
    r.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); if (Date.now() - (S.imeSplitAt || 0) < 400) return; if (!splitArrow(p, root, r)) toast(MSG_ENTER); return; }
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && joinArrow(p, root, r, e.key === 'Delete')) { e.preventDefault(); return; }
      const k = String(e.key).toLowerCase();
      if (mod && k === 'b') { e.preventDefault(); hlToggle(); return; }
      if (mod && !e.shiftKey && k === 'z') { e.preventDefault(); undo(p, root, r); return; }
      if (mod && ((e.shiftKey && k === 'z') || k === 'y')) { e.preventDefault(); redo(p, root, r); return; }
      if (mod && ['i', 'u'].includes(k)) e.preventDefault();
    });
    r.addEventListener('mouseup', () => setTimeout(showBubble, 0));
    r.addEventListener('keyup', (e) => { if (e.shiftKey || e.key.indexOf('Arrow') === 0) showBubble(); });
    r.addEventListener('paste', (e) => { e.preventDefault(); remember(); const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || ''; pushUndo(p, root, r); S.noSnap = true; try { document.execCommand('insertText', false, t.replace(/\s*\r?\n\s*/g, ' ').replace(/->/g, '→')); } finally { S.noSnap = false; } });
    r.addEventListener('drop', (e) => e.preventDefault());
    r.addEventListener('dragstart', (e) => e.preventDefault());
  }

  // 넘침 검사: 연 순간(또는 줄어든 뒤)보다 더 넘치면 되돌리고 토스트
  function check(p, root, r) {
    const ov = BP.overflowOf(root);
    const base = S.base.has(p.id) ? S.base.get(p.id) : 0;
    if (ov > base + 0.5) {
      r.innerHTML = S.good.get(r);
      dropSame(r);
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
  // 화살표 줄(p.bt-arrp)에서 Enter: 커서 뒤 글을 아래 새 화살표 줄로 내린다 (2026-11-25 대표 요청)
  //  - 새 줄은 윗줄과 같은 class(들여쓰기 v2-in3 등)와 맨 앞 화살표 장식을 갖는다. 종이가 넘치면 check가 되돌리고 안내한다
  //  - 화살표 줄이 아닌 곳의 Enter는 지금처럼 막는다
  //  - 화살표 줄 맨 앞 Backspace / 맨 끝 Delete: 윗줄(아랫줄)이 화살표 줄이면 한 줄로 합치고 아랫줄 화살표는 없앤다. 화살표 줄이 아니면 합치지 않는다
  function arrowLineAt(root, r) {
    const sel = selOf(root); if (!sel || !sel.rangeCount) return null;
    const n = sel.focusNode; const el = n && (n.nodeType === 3 ? n.parentElement : n);
    const line = el && el.closest && el.closest('p.bt-arrp');
    return line && r.contains(line) ? line : null;
  }
  const leadOf = (line) => line.querySelector(':scope > .bt-arw-lead');
  function caretAt(root, node, off) { const rg = document.createRange(); rg.setStart(node, off); rg.collapse(true); const sel = selOf(root); sel.removeAllRanges(); sel.addRange(rg); }
  function firstTextIn(line) { const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (!n.parentElement.closest('[data-be2-mark]')) return n; return null; }
  function splitArrow(p, root, r) {
    const line = arrowLineAt(root, r); if (!line) return false;
    const sel = selOf(root); S.pre = caretOffset(root, r); pushUndo(p, root, r);
    const rg0 = sel.getRangeAt(0); if (!rg0.collapsed) rg0.deleteContents();
    const rg = document.createRange(); rg.setStart(sel.focusNode, sel.focusOffset); rg.setEnd(line, line.childNodes.length);
    const frag = rg.extractContents();
    const nl = line.cloneNode(false); nl.removeAttribute('id');
    const lead = leadOf(line); if (lead) nl.appendChild(lead.cloneNode(true));
    nl.appendChild(frag);
    const t0 = firstTextIn(nl); if (t0) t0.data = t0.data.replace(/^[ \u00a0]+/, '');
    if (!nl.textContent.trim()) nl.appendChild(document.createElement('br'));
    if (!line.textContent.trim() && !line.querySelector('br')) line.appendChild(document.createElement('br'));
    line.after(nl); S.lastSplit = Date.now();
    const t1 = firstTextIn(nl);
    if (t1 && t1.data.length) caretAt(root, t1, 0); else caretAt(root, nl, [...nl.childNodes].findIndex((c) => c.nodeName === 'BR'));
    check(p, root, r);
    return true;
  }
  function joinArrow(p, root, r, forward) {
    const sel = selOf(root); if (!sel || !sel.isCollapsed) return false;
    const line = arrowLineAt(root, r); if (!line) return false;
    const rg = document.createRange();
    if (forward) { rg.setStart(sel.focusNode, sel.focusOffset); rg.setEnd(line, line.childNodes.length); } else { rg.setStart(line, 0); rg.setEnd(sel.focusNode, sel.focusOffset); }
    if (rg.toString() !== '') return false;
    const other = forward ? line.nextElementSibling : line.previousElementSibling;
    if (!other || !other.matches('p.bt-arrp')) return true; // 화살표 줄이 아닌 곧과는 합치지 않음(키만 먹음)
    const upper = forward ? line : other, lower = forward ? other : line;
    S.pre = caretOffset(root, r); pushUndo(p, root, r);
    [...upper.childNodes].filter((c) => c.nodeName === 'BR' && !c.nextSibling).forEach((c) => c.remove());
    const at = upper.childNodes.length;
    const lead = leadOf(lower);
    [...lower.childNodes].forEach((c) => { if (c !== lead && !(c.nodeName === 'BR' && !lower.textContent.trim())) upper.appendChild(c); });
    lower.remove();
    caretAt(root, upper, at);
    check(p, root, r);
    return true;
  }
  // 한글 조합 중 Enter: 조합이 끝난 뒤에 나눈다.
  // 크롬은 조합 중 Enter에 keydown을 두 번(조합 중, 조합 끝) 보내기도 해서, 그 사이 keydown이 이미 나눴으면 다시 나누지 않는다
  function enterAfterIme(p, root, r, n = 0) {
    if (S.composing) { if (n < 60) setTimeout(() => enterAfterIme(p, root, r, n + 1), 15); return; }
    const at = S.imeAt;
    setTimeout(() => {
      if ((S.lastSplit || 0) >= at) return;          // 그사이 두 번째 keydown이 이미 나눴음
      if (splitArrow(p, root, r)) S.imeSplitAt = Date.now(); else toast(MSG_ENTER);
    }, 40);
  }

  function arrowFix(p, root, r) {
    const sel = selOf(root); if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    const n = sel.focusNode, o = sel.focusOffset;
    if (!n || n.nodeType !== 3 || o < 2 || n.data.slice(o - 2, o) !== '->') return;
    pushUndo(p, root, r);   // Ctrl+Z 한 번이면 -> 로 돌아감
    const rg = document.createRange(); rg.setStart(n, o - 2); rg.setEnd(n, o);
    sel.removeAllRanges(); sel.addRange(rg);
    S.noSnap = true; try { document.execCommand('insertText', false, '→'); } finally { S.noSnap = false; }
  }

  // ---------- 되돌리기 / 다시하기 (2026-11-27 대표 요청) ----------
  // 크롬 기본 되돌리기는 편집기가 쪽 내용을 직접 바꾸면(줄 나누기, 버튼 넣기, 형광펜 등) 끊긴다. 그래서 쪽마다 직접 기록한다.
  //  - 바뀌기 직전의 쪽 모습(편집 화면 그대로)과 커서 위치를 쌓는다. 쪽마다 100단계
  //  - 글자 입력은 1초 안에 이어 친 것을 한 묶음(치기와 지우기는 따로). 편집기가 바꾸는 일은 하나씩
  //  - Ctrl+Z 뒤로, Ctrl+Shift+Z / Ctrl+Y 앞으로. 저장해도 기록은 남고, 새로고침하면 없어진다
  const UNDO_MAX = 100;
  function hist(r) { if (!S.hist) S.hist = new Map(); let h = S.hist.get(r); if (!h) { h = { undo: [], redo: [], at: 0, kind: '' }; S.hist.set(r, h); } return h; }
  function pushUndo(p, root, r) {
    const h = hist(r); const html = r.innerHTML;
    if (!h.undo.length || h.undo[h.undo.length - 1].html !== html) { h.undo.push({ html, caret: caretOffset(root, r) }); if (h.undo.length > UNDO_MAX) h.undo.shift(); }
    h.redo = []; h.kind = 'op'; h.at = Date.now(); S.lastEdit = { p, root, r };
  }
  function typingSnap(p, root, r, type) {
    if (S.noSnap) return;
    const h = hist(r); const kind = String(type).indexOf('delete') === 0 ? 'del' : 'ins'; const now = Date.now();
    if (now - h.at > 1000 || h.kind !== kind) { pushUndo(p, root, r); }
    h.kind = kind; h.at = now; S.lastEdit = { p, root, r };
  }
  function dropSame(r) { const h = hist(r); const t = h.undo[h.undo.length - 1]; if (t && t.html === r.innerHTML) h.undo.pop(); }
  function restoreSnap(p, root, r, s) { r.innerHTML = s.html; S.good.set(r, s.html); hideBubble(); try { r.focus({ preventScroll: true }); } catch (_) {} setCaret(root, r, s.caret); check(p, root, r); S.lastEdit = { p, root, r }; }
  function undo(p, root, r) {
    const h = hist(r); if (!h.undo.length) { toast('더 되돌릴 게 없어요.'); return; }
    const s = h.undo.pop(); h.redo.push({ html: r.innerHTML, caret: caretOffset(root, r) }); h.kind = 'undo'; h.at = 0;
    restoreSnap(p, root, r, s);
  }
  function redo(p, root, r) {
    const h = hist(r); if (!h.redo.length) { toast('다시 할 게 없어요.'); return; }
    const s = h.redo.pop(); h.undo.push({ html: r.innerHTML, caret: caretOffset(root, r) }); h.kind = 'redo'; h.at = 0;
    restoreSnap(p, root, r, s);
  }
  function undoFromButton(isRedo) {
    const c = caretCtx() || S.lastEdit; if (!c) { toast('먼저 고친 쪽에 커서를 두세요.'); return; }
    if (isRedo) redo(c.p, c.root, c.r); else undo(c.p, c.root, c.r);
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
    const targets = S.pages.filter((p) => S.dirty.has(p.id)); targets.forEach((p) => { const root = S.roots.get(p.id); root && root.querySelectorAll('.twp > .page').forEach((r) => alignComments(r)); });
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
    sub: { sel: 'span.bp-sub', make: () => { const s = document.createElement('span'); s.className = 'bp-sub'; s.setAttribute('style', SUB_STYLE); return s; }, name: '서브텍스트' },
    // 밑줄 = 이온암 코멘트가 다는 핑크 손 밑줄(입문서 v2 정본 CSS .v2-cm). 2026-11-27
    ul: { sel: 'span.v2-cm', make: () => { const s = document.createElement('span'); s.className = 'v2-cm'; return s; }, name: '밑줄' }
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
    { const h = hist(c.r); const snap = { html: before, caret: S.pre }; if (!h.undo.length || h.undo[h.undo.length - 1].html !== before) h.undo.push(snap); if (h.undo.length > UNDO_MAX) h.undo.shift(); h.redo = []; h.kind = 'op'; h.at = Date.now(); S.lastEdit = { p: c.p, root: c.root, r: c.r }; }
    segs.forEach((t) => {
      if (on) { if (fmtOf(t, c.r, f.sel)) return; const el = f.make(); t.parentNode.insertBefore(el, t); el.appendChild(t); mergePrev(el); }
      else { let h; let guard = 0; while ((h = fmtOf(t, c.r, f.sel)) && guard++ < 6) liftOut(h, t); }
    });
    c.r.querySelectorAll(f.sel).forEach((el) => { if (!el.textContent) el.remove(); });
    const first = segs[0], last = segs[segs.length - 1];
    if (k === 'ul') alignComments(c.r);
    check(c.p, c.root, c.r);
    if (c.r.innerHTML === before) { dropSame(c.r); hideBubble(); return; }
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
      + '<span class="sep"></span><button type="button" data-k="sub" data-on="1" title="고른 글자를 작고 연하게"><span class="sw sub">가</span>서브텍스트</button><button type="button" data-k="sub" data-on="0" title="서브텍스트 빼기">빼기</button>'
      + '<span class="sep"></span><button type="button" data-k="ul" data-on="1" title="고른 글자에 이온암 코멘트용 핑크 손 밑줄"><span class="sw ul"></span>밑줄</button><button type="button" data-k="ul" data-on="0" title="밑줄 빼기">빼기</button>';
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
    ['hl', 'sub', 'ul'].forEach((k) => { const all = allFmt(c, k); b.querySelector('[data-k="' + k + '"][data-on="1"]').classList.toggle('dim', all); b.querySelector('[data-k="' + k + '"][data-on="0"]').classList.toggle('dim', !anyFmt(c, k)); });
    b.hidden = false; const bw = b.offsetWidth, bh = b.offsetHeight;
    b.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, (left + right) / 2 - bw / 2)) + 'px';
    b.style.top = Math.max(64, top - bh - 8) + 'px';
  }

  // ---------- 오른쪽 버튼 모음: 커서가 있는 줄 바로 아래에 요소를 넣는다 (2026-11-27 대표 요청) ----------
  //  화살표 줄 / 이온암 코멘트 / 단독 소제목. 입문서 v2 새 디자인 쪽(.bt-book-intro)에서만. 넣은 칸의 임시 글을 골라 두어 바로 고쳐 쓸 수 있다.
  //  종이가 넘치면 check가 되돌린다. 넣은 직후 Ctrl+Z 한 번이면 빠진다.
  const CMT_SEL = 'aside.book-callout[data-body-font="ongleip"], .v2-tn';
  let floatEl = null;
  function caretCtx() {
    for (const [id, root] of S.roots) {
      const sel = selOf(root); if (!sel || !sel.rangeCount) continue;
      const n = sel.focusNode; const el = n && (n.nodeType === 3 ? n.parentElement : n);
      const r = el && el.closest && el.closest('[contenteditable="true"]');
      if (!r || r.getRootNode() !== root) continue;
      const p = S.pages.find((x) => x.id === id); if (!p) continue;
      return { p, root, r, el };
    }
    return null;
  }
  function newBlock(kind, blk) {
    const indent = blk && (blk.classList.contains('v2-in3') || blk.classList.contains('bt-step-solo')) ? ' v2-in3' : '';
    let el, text;
    if (kind === 'arrow') {
      el = document.createElement('p'); el.setAttribute('data-bt', '1'); el.className = 'bt-arrp' + indent;
      const lead = document.createElement('span'); lead.className = 'bt-deco bt-arw bt-arw-lead'; lead.setAttribute('contenteditable', 'false'); lead.setAttribute('data-be2-mark', '→ ');
      text = document.createTextNode('새 줄을 쓰세요'); el.append(lead, text);
    } else if (kind === 'comment') {
      el = document.createElement('aside'); el.className = 'book-design book-callout bt-memo-memo';
      [['data-book-kind', 'callout'], ['data-book-theme', 'writing'], ['data-book-tone', 'info'], ['data-theme', 'writing'], ['data-title', ''], ['data-body-font', 'ongleip'], ['data-bt', '1']].forEach(([k, v]) => el.setAttribute(k, v));
      const h = document.createElement('h3'); h.className = 'book-design-title';
      const b = document.createElement('div'); b.className = 'bn-inline-content book-design-body'; b.setAttribute('data-book-font', 'ongleip');
      text = document.createTextNode('코멘트를 쓰세요'); b.appendChild(text); el.append(h, b);
    } else {
      el = document.createElement('p'); el.setAttribute('data-bt', '1'); el.className = 'bt-step bt-step-solo';
      const t = document.createElement('span'); t.className = 't'; text = document.createTextNode('소제목을 쓰세요'); t.appendChild(text); el.appendChild(t);
    }
    return { el, text };
  }
  function insertBlock(kind) {
    const c = caretCtx(); if (!c) { toast('넣을 자리에 먼저 커서를 두세요.'); return; }
    const art = c.r.querySelector('article.bt-book-intro');
    if (!art || !art.contains(c.el) || !c.root.querySelector('style[data-v2]')) { toast('이 버튼은 입문서 새 디자인 쪽에서만 쓸 수 있어요.'); return; }
    let blk = c.el; while (blk && blk.parentElement !== art) blk = blk.parentElement;
    if (!blk) { toast('넣을 자리를 찾지 못했어요. 본문 줄 안에 커서를 두세요.'); return; }
    const before = c.r.innerHTML; S.pre = caretOffset(c.root, c.r); pushUndo(c.p, c.root, c.r);
    const { el, text } = newBlock(kind, blk);
    if (blk.classList.contains('book-page-number')) blk.before(el); else blk.after(el);
    if (kind === 'comment') alignComments(c.r);
    check(c.p, c.root, c.r);
    if (!c.r.contains(el)) return;   // 넘쳐서 되돌려짐(안내는 check가 띄움)
    S.hlUndo = { r: c.r, html: before, p: c.p, root: c.root };
    const rg = document.createRange(); rg.selectNodeContents(text); const sel = selOf(c.root); sel.removeAllRanges(); sel.addRange(rg);
  }
  // 이온암 코멘트 화살표를 바로 윗줄 핑크 밑줄(마지막 줄 조각)의 시작점 아래로 (DESIGN 0-4, 정본 CSS --cm-x)
  //  오른쪽 여백을 넘지 않게 코멘트 글 폭은 최소 260px. 윗줄에 밑줄이 없으면 기본 자리(108px)
  function alignComments(r) {
    const art = r.querySelector('article.bt-book-intro'); if (!art) return;
    const k = art.getBoundingClientRect().width / (art.offsetWidth || 1) || 1;
    art.querySelectorAll(':scope > ' + CMT_SEL.split(', ').join(', :scope > ')).forEach((c) => {
      const had = c.style.getPropertyValue('--cm-x');
      c.style.removeProperty('--cm-x');
      const prev = c.previousElementSibling; const ul = prev ? [...prev.querySelectorAll('.v2-cm')].pop() : null;
      if (!ul) { if (!c.getAttribute('style')) c.removeAttribute('style'); return; }
      const rects = [...ul.getClientRects()].filter((x) => x.width > 1); if (!rects.length) { if (had) c.style.setProperty('--cm-x', had); return; }
      const aR = art.getBoundingClientRect(), cR = c.getBoundingClientRect(), last = rects[rects.length - 1];
      const ml0 = parseFloat(getComputedStyle(c).marginLeft) || 108;
      const delta = ((last.left - aR.left) + 2 * k - (cR.left - aR.left) - 4.5 * k) / k;
      const ml = Math.min(ml0 + delta, art.offsetWidth - 36 - 260);
      if (ml - ml0 > 4) c.style.setProperty('--cm-x', Math.round(ml) + 'px'); else if (!c.getAttribute('style')) c.removeAttribute('style');
    });
  }
  function ensureFloat() {
    if (floatEl) return floatEl;
    floatEl = document.createElement('div'); floatEl.className = 'be2-float';
    floatEl.innerHTML = '<div class="undo"><button type="button" data-undo="0" title="되돌리기 (Ctrl+Z)"><span class="ic">↶</span>되돌리기</button><button type="button" data-undo="1" title="다시하기 (Ctrl+Shift+Z, Ctrl+Y)"><span class="ic">↷</span>다시</button></div><div class="lab">커서 자리 아래에 넣기</div>'
      + '<button type="button" data-ins="arrow" title="커서가 있는 줄 아래에 화살표 줄"><span class="ic arw">→</span>화살표 줄</button>'
      + '<button type="button" data-ins="comment" title="커서가 있는 줄 아래에 이온암 코멘트. 윗줄에 밑줄이 있으면 화살표가 밑줄 아래로 가요"><span class="ic cmt">↳</span>이온암 코멘트</button>'
      + '<button type="button" data-ins="solo" title="커서가 있는 줄 아래에 단독 소제목(한 중제목 안에 소제목이 하나뿐일 때)"><span class="ic solo">→</span>단독 소제목</button>';
    floatEl.addEventListener('mousedown', (e) => e.preventDefault());
    floatEl.addEventListener('click', (e) => { const u = e.target.closest('button[data-undo]'); if (u) { undoFromButton(u.dataset.undo === '1'); return; } const b = e.target.closest('button[data-ins]'); if (b) insertBlock(b.dataset.ins); });
    document.body.appendChild(floatEl);
    return floatEl;
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
