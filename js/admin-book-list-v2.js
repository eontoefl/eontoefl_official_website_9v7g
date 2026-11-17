// =====================================================================
// 입문서 관리 v2 (관리자 책 목록)  2026-11-17 — 대표 확정 (나) 두 번째 버전
//  - 왼쪽: 학생에게 보이는 책(서재 순서, 끌어서 바꾸기) / 숨긴 책(최근 고친 순) / 작업용(분류 = 작업용)
//  - 오른쪽: 고른 책 하나의 상세. "지금 학생에게 어떻게 보이는지"를 학생 서재와 같은 규칙으로 계산해 보여 준다
//    (공개 여부 + 공개 대상 + 단어장 v1/v2 규칙 tr_app_settings.vocab_version)
//  - 실수 막기: 공개 켤 때 확인 창 / 숨기기·순서 바꾸기는 바로 되고 8초 동안 되돌리기 / 작업용 책은 공개 잠금 / 휴지통 확인
//  - 기존 admin-book-list.html은 고치지 않는다(교체 때 링크만 바꿈). DB 쓰는 방법은 기존 목록과 같다(버전 협업 책 포함).
//  - "편집 중" 표시는 tr_book_editing 테이블이 있을 때만 켜진다(없으면 조용히 끔). SQL: C:\기능구현\에디터정본_화면통일\sql\
// =====================================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const DEV = params.get('dev') === '1' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const ROLE = { regular: '일반', australia: '호주', etc: '기타', work: '작업용' };
  const VOCA_V1 = '07f6cd4e-c737-40a1-b537-6e07af3d1aa5', VOCA_V2 = '47282479-f8f6-4062-aa33-6c027d488d1a';
  const TRASH_DAYS = 30, UNDO_MS = 8000, EDIT_FRESH_MS = 2 * 60 * 1000;
  const S = { books: [], collab: null, sel: params.get('book') || null, view: 'books', q: '', vocab: undefined, accessN: {}, editing: {}, presence: false, first: {}, covers: {}, undo: null, aud: { rows: null, timer: null } };

  function checkAuth() {
    if (DEV) return true;
    let u = null; try { u = JSON.parse(localStorage.getItem('iontoefl_user') || 'null'); } catch (_) {}
    if (!u || u.role !== 'admin') { alert('관리자만 접근할 수 있습니다.'); location.href = 'index.html'; return false; }
    return true;
  }
  function link(page, extra) { const p = new URLSearchParams(extra || {}); if (DEV) p.set('dev', '1'); const s = p.toString(); return page + (s ? '?' + s : ''); }
  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function fmtD(s) { try { const d = new Date(s); return (d.getMonth() + 1) + '. ' + d.getDate() + '.'; } catch (_) { return '-'; } }
  function fmtDT(s) { try { const d = new Date(s); return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '. ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (_) { return '-'; } }
  const isWork = (b) => b.role === 'work';
  const live = () => S.books.filter((b) => !b.deleted_at);
  const byId = (id) => S.books.find((b) => b.id === id);

  // ---------- 불러오기 ----------
  async function load() {
    const books = await supabaseAPI.query('tr_book_documents', { kind: 'eq.pages', order: 'sort_order.asc', select: '*' });
    S.books = books || [];
    S.collab = await loadCollab();
    if (!DEV) await purgeExpired();   // 로컬 시험(dev)에서는 휴지통 자동 영구삭제를 하지 않는다
    await Promise.all([loadVocab(), loadAccessCounts(), loadPresence(), loadFirstPages()]);
  }
  async function loadCollab() {
    if (!window.BookRevisionClient || !S.books.length) return {};
    try { return await window.BookRevisionClient.status(S.books.map((b) => b.id)); } catch (e) { console.warn('협업 상태 확인 실패', e); return null; }
  }
  const isCollab = (b) => !!(S.collab && S.collab[b.id]);
  async function purgeExpired() {
    if (S.collab === null) return;
    const cutoff = Date.now() - TRASH_DAYS * 864e5;
    const exp = S.books.filter((b) => b.deleted_at && new Date(b.deleted_at).getTime() < cutoff && !isCollab(b));
    for (const b of exp) { try { await supabaseAPI.hardDelete('tr_book_documents', b.id); S.books = S.books.filter((x) => x !== b); } catch (e) { console.warn('휴지통 정리 실패', b.id, e); } }
  }
  async function loadVocab() {
    try { const r = await supabaseAPI.query('tr_app_settings', { key: 'eq.vocab_version', select: 'value' }); S.vocab = r && r[0] ? (r[0].value || {}) : {}; }
    catch (e) { S.vocab = null; }
  }
  async function loadAccessCounts() {
    const ids = live().filter((b) => b.audience_mode === 'selected').map((b) => b.id);
    S.accessN = {};
    if (!ids.length) return;
    try { const rows = await supabaseAPI.query('tr_book_access', { book_id: 'in.(' + ids.join(',') + ')', select: 'book_id' }); ids.forEach((id) => { S.accessN[id] = 0; }); (rows || []).forEach((r) => { S.accessN[r.book_id] = (S.accessN[r.book_id] || 0) + 1; }); }
    catch (_) {}
  }
  async function loadPresence() {
    try {
      const rows = await supabaseAPI.query('tr_book_editing', { select: 'book_id,editor,seen_at' });
      S.presence = true; S.editing = {};
      (rows || []).forEach((r) => { if (Date.now() - new Date(r.seen_at).getTime() < EDIT_FRESH_MS) S.editing[r.book_id] = r.editor || ''; });
    } catch (_) { S.presence = false; S.editing = {}; }
  }
  // 표지 작은 그림: 표지 파일(book-covers) → 1쪽이 표지인 책(내벨업보카 원본) → 없음. 새 형식이 아닌 책도 여기서 가려낸다.
  async function loadFirstPages() {
    await Promise.all(live().map(async (b) => {
      try { const r = await fetch(SUPABASE_URL + '/storage/v1/object/public/guide-images/book/covers/' + b.id + '.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (j && j.front) S.covers[b.id] = j.front; } } catch (_) {}
      try {
        const rows = await supabaseAPI.query('tr_book_pages', { book_id: 'eq.' + b.id, deleted_at: 'is.null', select: 'html', order: 'sort_order.asc', limit: '1' });
        S.first[b.id] = rows && rows[0] ? rows[0].html || '' : null;
      } catch (_) { S.first[b.id] = null; }
    }));
  }
  function coverHtml(b) {
    if (S.covers[b.id]) return S.covers[b.id];
    const f = S.first[b.id];
    if (f && window.BookPage && BookPage.isHtmlPage({ html: f }) && /data-book-kind="cover"|class="page[^"]*\b(cover|cvp)\b/.test(f)) return f;
    return null;
  }
  const isHtmlBook = (b) => { const f = S.first[b.id]; return !!(f && window.BookPage && BookPage.isHtmlPage({ html: f })); };

  // ---------- 지금 학생에게 어떻게 보이나 (학생 서재 mylibrary.js + vocab-version.js 규칙) ----------
  function seenBy(b) {
    if (b.deleted_at) return { tone: 'off', icon: 'fa-trash-can', text: '휴지통에 있어요' };
    if (isWork(b)) return b.is_active ? { tone: 'warn', icon: 'fa-triangle-exclamation', text: '작업용 책인데 공개돼 있어요', sub: '숨기기를 권해요' } : { tone: 'off', icon: 'fa-flask', text: '작업용 책이라 학생에게 보이지 않아요' };
    if (!b.is_active) return { tone: 'off', icon: 'fa-eye-slash', text: '학생에게 보이지 않아요' };
    const sel = b.audience_mode === 'selected';
    const who = sel ? '지정한 학생 ' + (S.accessN[b.id] == null ? '' : S.accessN[b.id] + '명') : '결제한 학생 전원';
    if (sel && S.accessN[b.id] === 0) return { tone: 'warn', icon: 'fa-user-slash', text: '공개 중이지만 지정한 학생이 없어 아무에게도 안 보여요' };
    const v = S.vocab;
    if (b.id === VOCA_V2 || b.id === VOCA_V1) {
      if (v === null) return { tone: 'on', icon: 'fa-eye', text: who + '에게 보여요', sub: '(단어장 버전 설정을 읽지 못했어요)' };
      const date = v && v.new_book_date, closed = !!(v && v.v1_closed), f2 = (v && v.force_v2 || []).length, f1 = (v && v.force_v1 || []).length;
      if (b.id === VOCA_V2) {
        if (closed) return { tone: 'on', icon: 'fa-eye', text: who + '에게 보여요', sub: '(단어장 v1 마감, 모두 v2)' };
        if (!date && !f2) return { tone: 'warn', icon: 'fa-hourglass-half', text: '공개 중이지만 아직 아무에게도 안 보여요', sub: '(새 책 도착일이 비어 있어 모두 단어장 v1을 봐요)' };
        return { tone: 'on', icon: 'fa-eye', text: '단어장 v2 학생에게만 보여요', sub: date ? '(' + date + ' 이후 단어장을 받은 ' + (sel ? '지정 ' : '') + '학생' + (f2 ? ', 예외 ' + f2 + '명' : '') + ')' : '(예외로 지정한 ' + f2 + '명)' };
      }
      if (closed) return { tone: 'warn', icon: 'fa-hourglass-end', text: '공개 중이지만 아무에게도 안 보여요', sub: '(단어장 v1 마감, 모두 v2)' };
      if (!date && !f2) return { tone: 'on', icon: 'fa-eye', text: who + '에게 보여요', sub: '(지금은 모두 단어장 v1)' };
      return { tone: 'on', icon: 'fa-eye', text: '단어장 v1 학생에게만 보여요', sub: date ? '(' + date + ' 전에 받은 학생' + (f1 ? ', 예외 ' + f1 + '명' : '') + ')' : '' };
    }
    return { tone: 'on', icon: 'fa-eye', text: who + '에게 보이고 있어요' };
  }
  function rowSub(b) {
    if (isWork(b) || !b.is_active) return (b.total_pages || 0) + '쪽 · ' + fmtD(b.updated_at);
    const s = seenBy(b);
    const short = s.tone === 'warn' ? '아무에게도 안 보임' : (b.id === VOCA_V2 && s.text.indexOf('v2 학생') === 0) ? '단어장 v2 학생만' : (b.id === VOCA_V1 && s.text.indexOf('v1 학생') === 0) ? '단어장 v1 학생만' : b.audience_mode === 'selected' ? '지정 학생 ' + (S.accessN[b.id] || 0) + '명' : '결제한 학생 전원';
    return '<span' + (s.tone === 'warn' ? ' class="warn"' : '') + '>' + esc(short) + ' · ' + fmtD(b.updated_at) + '</span>';
  }

  // ---------- 그룹 ----------
  function groups() {
    const q = S.q.trim().toLowerCase();
    const m = (b) => !q || (b.title || '').toLowerCase().indexOf(q) !== -1;
    const undoId = S.undo && S.undo.keepPub;
    const L = live();
    const pub = L.filter((b) => (b.is_active || b.id === undoId) && !isWork(b)).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const hid = L.filter((b) => !b.is_active && b.id !== undoId && !isWork(b)).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    const work = L.filter(isWork).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return { pub: pub.filter(m), hid: hid.filter(m), work: work.filter(m), all: { pub, hid, work } };
  }

  // ---------- 표지 작은 그림 ----------
  function thumb(b, w) {
    const h = Math.round(w * 4 / 3), html = coverHtml(b);
    const box = document.createElement('span');
    box.className = 'bl2-th'; box.style.width = w + 'px'; box.style.height = h + 'px';
    if (!html) { box.classList.add('none'); box.style.fontSize = Math.max(7, Math.round(w / 7)) + 'px'; box.innerHTML = '표지<br>없음'; return box; }
    const host = document.createElement('span'); host.className = 'bl2-th-host'; box.appendChild(host);
    BookPage.render(host, html);
    host.style.transformOrigin = '0 0'; host.style.transform = 'scale(' + (w / BookPage.W) + ')';
    return box;
  }

  // ---------- 왼쪽 ----------
  function renderSide() {
    const G = groups(), wrap = $('groups');
    wrap.innerHTML = '';
    const head = (t, sub) => { const d = document.createElement('div'); d.className = 'bl2-gh'; d.innerHTML = '<b>' + esc(t) + '</b><span>' + esc(sub) + '</span>'; wrap.appendChild(d); };
    const canDrag = !S.q.trim();
    head('학생에게 보이는 책 ' + G.all.pub.length, canDrag ? '서재 순서 · 끌어서 바꾸기' : '서재 순서');
    G.pub.forEach((b) => wrap.appendChild(row(b, { drag: canDrag })));
    head('숨긴 책 ' + G.all.hid.length, '최근 고친 순');
    G.hid.forEach((b) => wrap.appendChild(row(b, {})));
    const sep = document.createElement('div'); sep.className = 'bl2-sep'; wrap.appendChild(sep);
    head('작업용 ' + G.all.work.length, '분류 = 작업용 · 학생에게 안 보임');
    G.work.forEach((b) => wrap.appendChild(row(b, { work: true })));
    if (S.q.trim() && !G.pub.length && !G.hid.length && !G.work.length) { const e = document.createElement('div'); e.className = 'bl2-hint'; e.textContent = '"' + S.q.trim() + '"이 들어간 책이 없어요.'; wrap.appendChild(e); }
    const trash = S.books.filter((b) => b.deleted_at);
    $('trashN').textContent = trash.length || '';
    $('btnTrash').classList.toggle('on', S.view === 'trash');
  }
  function row(b, o) {
    const r = document.createElement('div');
    r.className = 'bl2-row' + (S.view === 'books' && S.sel === b.id ? ' sel' : '') + (o.work ? ' work' : '');
    r.dataset.id = b.id;
    if (o.drag) r.dataset.pub = '1';
    const grip = document.createElement('i'); grip.className = 'fas fa-grip-vertical bl2-grip' + (o.drag ? '' : ' none'); if (!o.drag) grip.style.visibility = 'hidden';
    r.appendChild(grip);
    r.appendChild(thumb(b, 24));
    const t = document.createElement('div'); t.className = 'bl2-rt';
    t.innerHTML = '<b>' + esc(b.title || '(제목 없음)') + '</b>' + (/^<span/.test(rowSub(b)) ? rowSub(b) : '<span>' + esc(rowSub(b)) + '</span>');
    r.appendChild(t);
    if (S.editing[b.id] !== undefined) { const e = document.createElement('span'); e.className = 'bl2-editing'; e.textContent = '편집 중'; e.title = (S.editing[b.id] || '누군가') + ' 님이 에디터를 열어 두었어요'; r.appendChild(e); }
    if (isHtmlBook(b)) { const a = document.createElement('a'); a.className = 'bl2-quick'; a.href = link('admin-book-editor-v2.html', { book: b.id }); a.target = '_blank'; a.rel = 'noopener'; a.title = '바로 편집 (새 탭)'; a.innerHTML = '<i class="fas fa-pen"></i>'; a.addEventListener('click', (e) => e.stopPropagation()); r.appendChild(a); }
    r.addEventListener('click', () => select(b.id));
    if (o.drag) setupDrag(r, grip);
    return r;
  }

  // ---------- 서재 순서 끌어서 바꾸기 ----------
  // 손잡이(⠿)를 누른 채 위아래로 옮기면 놓을 자리에 노란 줄이 보이고, 놓으면 순서가 바뀐다 (포인터 방식: 브라우저 끌어놓기보다 안정적)
  function setupDrag(r, grip) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const id = r.dataset.id; let target = null, after = false, moved = false;
      r.classList.add('dragging'); document.body.style.cursor = 'grabbing';
      const rows = () => Array.from(document.querySelectorAll('#groups .bl2-row[data-pub="1"]'));
      const clear = () => rows().forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      const onMove = (ev) => {
        moved = true; clear(); target = null;
        for (const x of rows()) { const rc = x.getBoundingClientRect(); if (ev.clientY >= rc.top && ev.clientY <= rc.bottom) { if (x.dataset.id === id) break; target = x.dataset.id; after = ev.clientY > rc.top + rc.height / 2; x.classList.add(after ? 'drop-after' : 'drop-before'); break; } }
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
        r.classList.remove('dragging'); document.body.style.cursor = ''; clear();
        if (moved && target) moveBook(id, target, after);
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    });
    grip.addEventListener('click', (e) => e.stopPropagation());
  }
  async function moveBook(id, targetId, after) {
    const pub = groups().all.pub.slice();
    const from = pub.findIndex((b) => b.id === id); if (from < 0) return;
    const [m] = pub.splice(from, 1);
    let to = pub.findIndex((b) => b.id === targetId); if (to < 0) return; if (after) to++;
    pub.splice(to, 0, m);
    await applyOrder(pub.map((b) => b.id), '서재 순서를 바꿨어요');
  }
  // 학생에게 보이는 책끼리 원래 쓰던 순서 숫자만 서로 바꾼다(PDF 입문서 등 다른 책 순서는 건드리지 않음)
  async function applyOrder(ids, msg, noUndo) {
    const books = ids.map(byId);
    const before = books.map((b) => [b.id, b.sort_order]);
    let vals = books.map((b) => b.sort_order || 0).sort((a, b) => a - b);
    if (new Set(vals).size < vals.length) vals = vals.map((v, i) => vals[0] + i);
    try {
      for (let i = 0; i < books.length; i++) if (books[i].sort_order !== vals[i]) await updateBook(books[i], { sort_order: vals[i] });
    } catch (e) { toast('순서를 바꾸지 못했어요: ' + e.message, { err: true }); await reload(); return; }
    render();
    if (!noUndo) toast(msg, { icon: 'fa-arrow-down-short-wide', undo: async () => { const orig = before.slice().sort((a, b) => a[1] - b[1]).map((x) => x[0]); for (const [bid, so] of before) { const b = byId(bid); if (b && b.sort_order !== so) await updateBook(b, { sort_order: so }); } render(); toast('원래 순서로 되돌렸어요'); } });
  }

  // ---------- 오른쪽 ----------
  function select(id) {
    S.view = 'books'; S.sel = id; S.aud.rows = null; closeMenu();
    const u = new URL(location.href); u.searchParams.set('book', id); history.replaceState(null, '', u);
    render();
    if (byId(id) && byId(id).audience_mode === 'selected') loadAudRows(id);
  }
  function render() { renderSide(); if (S.view === 'trash') renderTrash(); else renderMain(); }
  function renderMain() {
    const main = $('main'), b = byId(S.sel);
    if (!b || b.deleted_at) { main.innerHTML = '<div class="bl2-empty">왼쪽에서 책을 골라 주세요.</div>'; return; }
    const st = seenBy(b), work = isWork(b), html = isHtmlBook(b), empty = !(b.total_pages > 0) && S.first[b.id] == null;
    main.innerHTML = '';
    const head = document.createElement('div'); head.className = 'bl2-head';
    head.appendChild(thumb(b, 150));
    const info = document.createElement('div'); info.className = 'bl2-hinfo';
    info.innerHTML =
      '<button class="bl2-cat" id="btnCat" type="button" title="분류 바꾸기">' + esc(ROLE[b.role] || '기타') + ' <i class="fas fa-chevron-down" style="font-size:10px"></i></button>' +
      '<div class="bl2-h1">' + esc(b.title || '(제목 없음)') + '</div>' +
      '<div class="bl2-meta">' + (b.total_pages || 0) + '쪽 · 마지막 저장 ' + fmtDT(b.updated_at) + (isCollab(b) ? ' · 버전 협업' : '') + '</div>' +
      '<div class="bl2-now ' + st.tone + '"><i class="fas ' + st.icon + '"></i><span>지금: ' + esc(st.text) + (st.sub ? ' <small>' + esc(st.sub) + '</small>' : '') + '</span></div>' +
      (S.editing[b.id] !== undefined ? '<div class="bl2-note"><i class="fas fa-pen"></i> ' + esc(S.editing[b.id] || '누군가') + ' 님이 지금 이 책 에디터를 열어 두었어요. 같이 고치면 한쪽 저장이 막혀요.</div>' : '') +
      '<div class="bl2-acts">' +
        '<a class="bl2-btn pri" id="btnEdit" target="_blank" rel="noopener" href="' + link('admin-book-editor-v2.html', { book: b.id }) + '"' + (html ? '' : ' aria-disabled="true"') + '><i class="fas fa-pen-to-square"></i>에디터로 편집</a>' +
        '<a class="bl2-btn sec" id="btnStudent" href="' + link('admin-book-student-view.html', { book: b.id }) + '" target="_blank"' + (html ? '' : ' aria-disabled="true"') + '><i class="fas fa-eye"></i>학생 화면으로 보기</a>' +
        '<button class="bl2-btn sec" id="btnPdf" type="button"' + (html ? '' : ' aria-disabled="true"') + ' title="이름 없는 원본 PDF (인쇄소·보관용)"><i class="fas fa-file-arrow-down"></i>PDF 저장</button>' +
        '<button class="bl2-btn sec icon" id="btnMore" type="button" title="더 보기"><i class="fas fa-ellipsis"></i></button>' +
      '</div>' +
      (!html ? '<div class="bl2-note">' + (empty ? '쪽이 아직 없어요. 쪽을 만들어 넣은 뒤에 에디터로 고칠 수 있어요.' : '아직 새 형식(210×280 쪽)이 아닌 책이라 새 에디터로 열 수 없어요. <a href="admin-book-editor.html?book=' + b.id + '">옛 에디터로 열기</a>') + '</div>' : '');
    head.appendChild(info);
    main.appendChild(head);
    const sets = document.createElement('div'); sets.className = 'bl2-sets';
    let s = '<div class="bl2-sh">학생에게 보이기</div>';
    if (work && !b.is_active) s += setRow('공개', '작업용 책은 공개할 수 없어요. 분류를 작업용에서 바꾼 뒤에 켤 수 있어요', '<span class="bl2-lock"><i class="fas fa-lock"></i><button class="bl2-sw" disabled aria-label="공개 잠김"></button></span>');
    else s += setRow('공개', b.is_active ? '끄면 학생 서재에서 바로 사라져요' : '켜면 확인 창이 한 번 더 떠요', '<button class="bl2-sw' + (b.is_active ? ' on' : '') + '" data-k="is_active" aria-label="공개"></button>');
    if (!work) {
      const sel = b.audience_mode === 'selected';
      s += setRow('공개 대상', sel ? '아래에서 지정한 학생만 봐요' + (S.accessN[b.id] != null ? ' · 지금 ' + S.accessN[b.id] + '명' : '') : '결제한 학생 전원' + (b.is_active ? '' : ' · 공개를 켜면 적용돼요'),
        '<span class="bl2-seg" id="audSeg"><button data-m="all" class="' + (sel ? '' : 'on') + '">전체공개</button><button data-m="selected" class="' + (sel ? 'on' : '') + '">특정 학생</button></span>', 'audRow');
      if (sel) s += '<div class="bl2-aud" id="audBox"><label class="bl2-aud-s"><i class="fas fa-magnifying-glass"></i><input id="audQ" placeholder="학생 이름으로 찾기 (결제 완료 학생만)" autocomplete="off"></label><div class="bl2-aud-l" id="audRes"></div><div class="bl2-aud-h">지정한 학생</div><div class="bl2-aud-l" id="audAdded"><div class="bl2-mini">불러오는 중…</div></div></div>';
    }
    s += '<div class="bl2-sh">학생 화면 설정</div>';
    s += setRow('처음 열 때 확인', '책을 처음 열면 안내 확인 창을 보여요', '<button class="bl2-sw' + (b.view_confirm ? ' on' : '') + '" data-k="view_confirm" aria-label="처음 열 때 확인"></button>');
    s += setRow('PDF 저장·인쇄', '쪽마다 학생 이름·이메일이 찍혀요', '<button class="bl2-sw' + (b.allow_print ? ' on' : '') + '" data-k="allow_print" aria-label="PDF 저장·인쇄"></button>');
    sets.innerHTML = s;
    main.appendChild(sets);
    // 동작
    $('btnMore').addEventListener('click', (e) => openMenu(b, e.currentTarget));
    $('btnPdf').addEventListener('click', () => { if (window.AdminBookPdf) AdminBookPdf.save(b.id, { dev: DEV, onState: (m, err) => { if (m) toast(m, err ? { err: true } : { icon: 'fa-spinner fa-spin', ms: 120000 }); else { clearTimeout(toastT); $('toast').hidden = true; } } }); });
    $('btnCat').addEventListener('click', (e) => openCatMenu(b, e.currentTarget));
    sets.querySelectorAll('.bl2-sw[data-k]').forEach((sw) => sw.addEventListener('click', () => onSwitch(b, sw.dataset.k)));
    const seg = $('audSeg'); if (seg) seg.querySelectorAll('button').forEach((x) => x.addEventListener('click', () => setAudMode(b, x.dataset.m)));
    if ($('audBox')) { $('audQ').addEventListener('input', (e) => onAudSearch(b, e.target.value)); renderAudAdded(b); if (S.aud.rows === null) loadAudRows(b.id); }
  }
  function setRow(t, sub, right, id) { return '<div class="bl2-set"' + (id ? ' id="' + id + '"' : '') + '><div class="bl2-set-t"><b>' + esc(t) + '</b><span>' + esc(sub) + '</span></div>' + right + '</div>'; }

  // ---------- 스위치 ----------
  async function onSwitch(b, k) {
    if (k === 'is_active') {
      if (!b.is_active) return confirmPublish(b);
      return hideBook(b);
    }
    const val = !b[k];
    try { await updateBook(b, { [k]: val }); render(); toast((k === 'view_confirm' ? '처음 열 때 확인' : 'PDF 저장·인쇄') + '을 ' + (val ? '켰어요' : '껐어요'), { undo: async () => { await updateBook(b, { [k]: !val }); render(); toast('되돌렸어요'); } }); }
    catch (e) { toast('바꾸지 못했어요: ' + e.message, { err: true }); render(); }
  }
  function confirmPublish(b) {
    if (isWork(b)) return;
    const sel = b.audience_mode === 'selected', n = S.accessN[b.id];
    let who = sel ? '지정한 학생 ' + (n == null ? '' : n + '명') + '의 서재에' : '결제한 학생 전원의 서재에';
    let extra = '';
    if (b.id === VOCA_V2 || b.id === VOCA_V1) { const t = seenBy(Object.assign({}, b, { is_active: true })); extra = '<br>단어장 규칙: ' + esc(t.text) + (t.sub ? ' ' + esc(t.sub) : ''); }
    modal({
      icon: 'fa-eye', title: "'" + (b.title || '') + "'를 공개할까요?",
      body: who + ' <b>바로</b> 보여요.<br>공개 대상: ' + (sel ? '특정 학생' : '전체공개') + ' · 처음 열 때 확인 ' + (b.view_confirm ? '켜짐' : '꺼짐') + ' · PDF 저장 ' + (b.allow_print ? '켜짐' : '꺼짐') + extra,
      go: '공개하기', onGo: async () => { try { await updateBook(b, { is_active: true }); render(); toast("'" + b.title + "'를 공개했어요. 학생 서재에 보여요.", { icon: 'fa-eye', undo: async () => { await updateBook(b, { is_active: false }); render(); toast('다시 숨겼어요'); } }); } catch (e) { toast('공개하지 못했어요: ' + e.message, { err: true }); render(); } }
    });
  }
  async function hideBook(b) {
    try {
      await updateBook(b, { is_active: false });
      S.undo = { keepPub: b.id };
      render();
      toast("'" + b.title + "'을 숨겼어요. 학생 서재에서 사라졌어요.", { icon: 'fa-eye-slash', undo: async () => { S.undo = null; await updateBook(b, { is_active: true }); render(); toast('다시 공개했어요'); }, onEnd: () => { if (S.undo && S.undo.keepPub === b.id) { S.undo = null; render(); } } });
    } catch (e) { toast('숨기지 못했어요: ' + e.message, { err: true }); render(); }
  }

  // ---------- 공개 대상 ----------
  async function setAudMode(b, m) {
    if ((b.audience_mode === 'selected' ? 'selected' : 'all') === m) return;
    const prev = b.audience_mode || 'all';
    try { await updateBook(b, { audience_mode: m }); if (m === 'selected') { await loadAccessCounts(); S.aud.rows = null; } render(); toast(m === 'selected' ? '특정 학생만 보게 바꿨어요' : '결제한 학생 전원이 보게 바꿨어요', { undo: async () => { await updateBook(b, { audience_mode: prev }); render(); toast('되돌렸어요'); } }); }
    catch (e) { toast('바꾸지 못했어요: ' + e.message, { err: true }); }
  }
  async function loadAudRows(id) {
    try { const rows = await supabaseAPI.query('tr_book_access', { book_id: 'eq.' + id, order: 'created_at.desc' }); if (S.sel !== id) return; S.aud.rows = rows || []; S.accessN[id] = S.aud.rows.length; }
    catch (_) { S.aud.rows = []; }
    const b = byId(id); if (b && $('audAdded')) { renderAudAdded(b); renderSide(); }
  }
  function renderAudAdded(b) {
    const box = $('audAdded'); if (!box) return;
    if (S.aud.rows === null) { box.innerHTML = '<div class="bl2-mini">불러오는 중…</div>'; return; }
    if (!S.aud.rows.length) { box.innerHTML = '<div class="bl2-mini">아직 지정한 학생이 없어요. 위에서 이름으로 찾아 추가해 주세요.</div>'; return; }
    box.innerHTML = '';
    S.aud.rows.forEach((a) => { const r = document.createElement('div'); r.className = 'bl2-person'; r.innerHTML = '<div><b>' + esc(a.student_name || '-') + '</b><span>' + esc(a.student_email || '') + '</span></div><button class="rm" type="button">빼기</button>'; r.querySelector('button').addEventListener('click', () => removeAccess(b, a)); box.appendChild(r); });
  }
  function onAudSearch(b, term) {
    clearTimeout(S.aud.timer); const q = (term || '').trim(); const box = $('audRes');
    if (!q) { box.innerHTML = ''; return; }
    S.aud.timer = setTimeout(async () => {
      box.innerHTML = '<div class="bl2-mini">찾는 중…</div>';
      try {
        const apps = await supabaseAPI.query('applications', { deposit_confirmed_by_admin: 'eq.true', application_type: 'neq.book_only', name: 'ilike.*' + q + '*', select: 'id,name,email', order: 'name.asc', limit: '20' });
        const added = new Set((S.aud.rows || []).map((a) => (a.student_email || '').toLowerCase())); const seen = new Set();
        const list = (apps || []).filter((a) => a.email && !added.has(a.email.toLowerCase()) && !seen.has(a.email.toLowerCase()) && seen.add(a.email.toLowerCase()));
        if (!list.length) { box.innerHTML = '<div class="bl2-mini">결제 완료된 학생 중에 없어요.</div>'; return; }
        box.innerHTML = '';
        list.forEach((a) => { const r = document.createElement('div'); r.className = 'bl2-person'; r.innerHTML = '<div><b>' + esc(a.name || '-') + '</b><span>' + esc(a.email) + '</span></div><button type="button"><i class="fas fa-plus"></i> 추가</button>'; r.querySelector('button').addEventListener('click', () => addAccess(b, a, r)); box.appendChild(r); });
      } catch (e) { box.innerHTML = '<div class="bl2-mini">찾지 못했어요: ' + esc(e.message) + '</div>'; }
    }, 250);
  }
  async function addAccess(b, app, rowEl) {
    try {
      const users = await supabaseAPI.query('users', { email: 'eq.' + app.email, select: 'id,name', limit: '1' });
      if (!users || !users.length) { toast('이 학생은 아직 학습 사이트 계정이 없어요(로그인한 적이 있어야 지정할 수 있어요)', { err: true }); return; }
      const row = await supabaseAPI.post('tr_book_access', { book_id: b.id, user_id: users[0].id, student_name: app.name || users[0].name || null, student_email: app.email, created_by: 'admin' });
      S.aud.rows = [row].concat(S.aud.rows || []); S.accessN[b.id] = S.aud.rows.length;
      if (rowEl) rowEl.remove(); renderAudAdded(b); renderSide(); refreshNow(b);
      toast((app.name || app.email) + ' 학생을 추가했어요');
    } catch (e) { toast('추가하지 못했어요(이미 추가됐을 수 있어요): ' + e.message, { err: true }); }
  }
  async function removeAccess(b, a) {
    try { await supabaseAPI.hardDelete('tr_book_access', a.id); S.aud.rows = (S.aud.rows || []).filter((x) => x.id !== a.id); S.accessN[b.id] = S.aud.rows.length; renderAudAdded(b); renderSide(); refreshNow(b); toast((a.student_name || a.student_email) + ' 학생을 뺐어요'); }
    catch (e) { toast('빼지 못했어요: ' + e.message, { err: true }); }
  }
  function refreshAudSub(b) { const sp = document.querySelector('#audRow .bl2-set-t span'); if (sp && b.audience_mode === 'selected') sp.textContent = '아래에서 지정한 학생만 봐요 · 지금 ' + (S.accessN[b.id] || 0) + '명'; }
  function refreshNow(b) { refreshAudSub(b); const el = document.querySelector('.bl2-now'); if (!el) return; const st = seenBy(b); el.className = 'bl2-now ' + st.tone; el.innerHTML = '<i class="fas ' + st.icon + '"></i><span>지금: ' + esc(st.text) + (st.sub ? ' <small>' + esc(st.sub) + '</small>' : '') + '</span>'; }

  // ---------- 메뉴 ----------
  function openMenu(b, anchor) {
    const items = [['fa-pen', '이름 바꾸기', () => renameBook(b)]];
    if (!isWork(b)) items.push(['fa-user-group', '공개 대상', () => { const r = $('audRow'); if (r) { r.scrollIntoView({ block: 'center', behavior: 'smooth' }); r.style.background = '#FBF8FF'; setTimeout(() => { r.style.background = ''; }, 1200); } }]);
    items.push(['fa-file-arrow-down', '텍스트 다운로드', () => downloadBook(b)]);
    items.push(null);
    items.push(['fa-trash-can', '휴지통으로', () => trashBook(b), 'danger']);
    showMenu(anchor, items);
  }
  function openCatMenu(b, anchor) {
    showMenu(anchor, ['regular', 'australia', 'etc', 'work'].map((r) => [r === (b.role || 'etc') ? 'fa-check' : 'fa-tag', ROLE[r], () => setRole(b, r)]));
  }
  function showMenu(anchor, items) {
    const m = $('menu'); m.innerHTML = '';
    items.forEach((it) => { if (!it) { m.appendChild(document.createElement('hr')); return; } const bt = document.createElement('button'); bt.type = 'button'; if (it[3]) bt.className = it[3]; bt.innerHTML = '<i class="fas ' + it[0] + '"></i>' + esc(it[1]); bt.addEventListener('click', () => { closeMenu(); it[2](); }); m.appendChild(bt); });
    m.hidden = false;
    const rc = anchor.getBoundingClientRect(); const w = 212;
    m.style.left = Math.min(window.innerWidth - w - 12, rc.left) + 'px'; m.style.top = (rc.bottom + 6) + 'px';
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
  }
  function onDocClick(e) { if (!$('menu').contains(e.target)) closeMenu(); }
  function closeMenu() { $('menu').hidden = true; document.removeEventListener('click', onDocClick); }
  async function setRole(b, r) {
    if ((b.role || 'etc') === r) return;
    if (r === 'work' && b.is_active) { toast('공개 중인 책은 작업용으로 바꿀 수 없어요. 먼저 숨겨 주세요.', { err: true }); return; }
    const prev = b.role || 'etc';
    try { await updateBook(b, { role: r }); render(); toast("분류를 '" + ROLE[r] + "'(으)로 바꿨어요", { undo: async () => { await updateBook(b, { role: prev }); render(); toast('되돌렸어요'); } }); }
    catch (e) { toast('분류를 바꾸지 못했어요: ' + e.message, { err: true }); }
  }
  async function renameBook(b) {
    const name = prompt('책 이름 바꾸기:', b.title || '');
    if (!name || !name.trim() || name.trim() === b.title) return;
    const prev = b.title;
    try { await updateBook(b, { title: name.trim() }); render(); toast('이름을 바꿨어요', { undo: async () => { await updateBook(b, { title: prev }); render(); toast('되돌렸어요'); } }); }
    catch (e) { toast('이름을 바꾸지 못했어요: ' + e.message, { err: true }); }
  }
  function trashBook(b) {
    modal({
      icon: 'fa-trash-can', danger: true, title: "'" + (b.title || '') + "'를 휴지통으로 보낼까요?",
      body: (b.is_active ? '<b>지금 학생에게 보이는 책이에요.</b> 휴지통으로 보내면 학생 서재에서 바로 사라져요.<br>' : '') + (isCollab(b) ? '버전 협업 책이라 자동 영구삭제되지 않고 이력이 남아요.' : TRASH_DAYS + '일 동안 휴지통에 있다가 자동으로 영구삭제돼요. 그 전에는 되살릴 수 있어요.'),
      go: '휴지통으로', onGo: async () => {
        try { await updateBook(b, { deleted_at: new Date().toISOString(), is_active: false }, { trash: true }); const next = groups().all; S.sel = (next.pub[0] || next.hid[0] || next.work[0] || {}).id || null; render(); toast("'" + b.title + "'를 휴지통으로 보냈어요", { icon: 'fa-trash-can', undo: async () => { await updateBook(b, { deleted_at: null }, { trash: false }); select(b.id); toast('되살렸어요. 공개는 꺼진 상태예요.'); } }); }
        catch (e) { toast('휴지통으로 보내지 못했어요: ' + e.message, { err: true }); }
      }
    });
  }
  async function downloadBook(b) {
    toast('텍스트를 만드는 중이에요…');
    try {
      const pages = await supabaseAPI.query('tr_book_pages', { book_id: 'eq.' + b.id, deleted_at: 'is.null', select: 'sort_order,html,blocks', order: 'sort_order.asc' });
      if (!pages || !pages.length) { toast('이 책엔 아직 쪽이 없어요', { err: true }); return; }
      let md;
      if (pages.every((p) => BookPage.isHtmlPage(p))) {
        // 새 형식 책: 화면에 보이는 글자 그대로(숨은 목차 제목 빼고) 쪽마다
        const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px'; document.body.appendChild(host);
        const out = ['# ' + (b.title || '')];
        pages.forEach((p, i) => { const root = BookPage.render(host, p.html); root.querySelectorAll('h1,h2,h3').forEach((h) => { const rc = h.getBoundingClientRect(); if (rc.width * rc.height <= 4) h.remove(); }); const t = (root.querySelector('.bp-root').innerText || '').replace(/\n{3,}/g, '\n\n').trim(); out.push('\n## ' + (i + 1) + '쪽\n\n' + t); });
        host.remove(); md = out.join('\n') + '\n';
      } else if (window.BookMarkdown) md = window.BookMarkdown.buildBookMarkdown(b.title, pages);
      else throw new Error('변환기를 불러오지 못했어요');
      const fn = window.BookMarkdown ? window.BookMarkdown.filenameFor(b.title) : (b.title || 'book') + '.md';
      if (window.BookMarkdown) window.BookMarkdown.downloadMarkdown(fn, md);
      S.lastDownload = { name: fn, md: md };
      toast('텍스트 파일을 받았어요 (' + pages.length + '쪽)');
    } catch (e) { toast('다운로드하지 못했어요: ' + e.message, { err: true }); }
  }

  // ---------- 휴지통 ----------
  function renderTrash() {
    const main = $('main'); const trash = S.books.filter((b) => b.deleted_at).sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
    main.innerHTML = '<div class="bl2-h1" style="margin-top:0">휴지통</div><div class="bl2-meta" style="margin-bottom:18px">지운 책은 ' + TRASH_DAYS + '일 동안 여기 있다가 자동으로 영구삭제돼요. 되살린 책은 숨긴 상태로 돌아와요.</div>';
    if (!trash.length) { main.insertAdjacentHTML('beforeend', '<div class="bl2-empty">휴지통이 비어 있어요.</div>'); return; }
    trash.forEach((b) => {
      const left = TRASH_DAYS - Math.floor((Date.now() - new Date(b.deleted_at).getTime()) / 864e5);
      const r = document.createElement('div'); r.className = 'bl2-trow';
      r.appendChild(thumb(b, 30));
      const d = document.createElement('div'); d.innerHTML = '<b>' + esc(b.title || '(제목 없음)') + '</b><span>' + (b.total_pages || 0) + '쪽 · 지운 날 ' + fmtD(b.deleted_at) + ' · ' + (isCollab(b) ? '협업 이력 보관 중, 자동 영구삭제 안 함' : Math.max(0, left) + '일 뒤 영구삭제') + '</span>';
      r.appendChild(d);
      const bt = document.createElement('button'); bt.className = 'bl2-btn sec'; bt.type = 'button'; bt.innerHTML = '<i class="fas fa-rotate-left"></i>되살리기';
      bt.addEventListener('click', async () => { try { await updateBook(b, { deleted_at: null }, { trash: false }); select(b.id); toast('되살렸어요. 공개는 꺼진 상태예요.'); } catch (e) { toast('되살리지 못했어요: ' + e.message, { err: true }); } });
      r.appendChild(bt); main.appendChild(r);
    });
  }

  // ---------- 새 책 ----------
  async function createBook() {
    const name = prompt('새 책 이름:', '새 책');
    if (!name || !name.trim()) return;
    const maxOrder = S.books.reduce((m, b) => Math.max(m, b.sort_order || 0), 0);
    try { const b = await supabaseAPI.post('tr_book_documents', { title: name.trim(), kind: 'pages', is_active: false, total_pages: 0, sort_order: maxOrder + 1, role: 'etc' }); S.books.push(b); S.first[b.id] = null; select(b.id); toast('새 책을 만들었어요. 숨긴 상태예요.'); }
    catch (e) { toast('새 책을 만들지 못했어요: ' + e.message, { err: true }); }
  }

  // ---------- DB 쓰기 (기존 목록과 같은 방법: 버전 협업 책은 서버 함수) ----------
  async function updateBook(b, patch, collabPatch) {
    if (isCollab(b)) {
      const C = window.BookRevisionClient; const requestId = C.uuid(); let res;
      try { res = await C.updateMetadata(b.id, requestId, collabPatch || patch); }
      catch (e) {
        if (e.code === 'UNKNOWN_RESULT') res = await C.updateMetadata(b.id, requestId, collabPatch || patch);
        else if (e.code === 'AUTH_REQUIRED' || e.code === 'FORBIDDEN') { if (confirm('버전 협업 책은 관리자 확인이 필요해요.\n관리자 로그인으로 다시 로그인할까요?')) location.href = 'login.html?reauth=1&redirect=' + encodeURIComponent('admin-book-list-v2.html'); throw new Error('관리자 확인 필요'); }
        else throw e;
      }
      Object.assign(b, res.book); return;
    }
    await supabaseAPI.patch('tr_book_documents', b.id, patch);
    Object.assign(b, patch);
  }

  // ---------- 확인 창 / 알림 ----------
  function modal(o) {
    const m = $('modal');
    m.innerHTML = '<div class="bl2-mbox" role="dialog" aria-modal="true"><div class="bl2-mico' + (o.danger ? ' danger' : '') + '"><i class="fas ' + o.icon + '"></i></div><div class="bl2-mt">' + esc(o.title) + '</div><div class="bl2-mb">' + o.body + '</div><div class="bl2-mbtns"><button type="button" data-a="no">취소</button><button type="button" class="go' + (o.danger ? ' danger' : '') + '" data-a="go">' + esc(o.go) + '</button></div></div>';
    m.hidden = false;
    const close = () => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    m.querySelector('[data-a="no"]').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); }, { once: true });
    m.querySelector('[data-a="go"]').addEventListener('click', async (e) => { e.currentTarget.disabled = true; close(); await o.onGo(); });
    m.querySelector('[data-a="no"]').focus();
  }
  let toastT = null, toastTick = null, toastEnd = null;
  function toast(text, o) {
    o = o || {};
    const el = $('toast'); clearTimeout(toastT); clearInterval(toastTick);
    if (toastEnd) { const f = toastEnd; toastEnd = null; f(); }
    el.className = 'bl2-toast' + (o.err ? ' err' : '');
    el.innerHTML = '<i class="fas ' + (o.icon || (o.err ? 'fa-circle-exclamation' : 'fa-check')) + '"></i><span>' + esc(text) + '</span>' + (o.undo ? '<button type="button">되돌리기</button><small></small>' : '');
    el.hidden = false;
    const ms = o.ms || (o.undo ? UNDO_MS : (o.err ? 5000 : 2600));
    toastEnd = o.onEnd || null;
    const done = () => { el.hidden = true; clearInterval(toastTick); if (toastEnd) { const f = toastEnd; toastEnd = null; f(); } };
    if (o.undo) {
      let left = Math.round(ms / 1000); const sm = el.querySelector('small'); sm.textContent = left + '초';
      toastTick = setInterval(() => { left--; if (left >= 0) sm.textContent = left + '초'; }, 1000);
      el.querySelector('button').addEventListener('click', async () => { clearTimeout(toastT); clearInterval(toastTick); toastEnd = null; el.hidden = true; try { await o.undo(); } catch (e) { toast('되돌리지 못했어요: ' + e.message, { err: true }); } });
    }
    toastT = setTimeout(done, ms);
  }

  async function reload() { await load(); render(); }
  async function start() {
    if (!checkAuth()) return;
    $('btnBack').href = DEV ? 'admin-settings.html?dev=1' : 'admin-settings.html';
    $('btnNew').addEventListener('click', createBook);
    $('btnTrash').addEventListener('click', () => { S.view = S.view === 'trash' ? 'books' : 'trash'; closeMenu(); render(); });
    $('q').addEventListener('input', (e) => { S.q = e.target.value; renderSide(); });
    $('q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; S.q = ''; renderSide(); e.target.blur(); } if (e.key === 'Enter') { const f = document.querySelector('#groups .bl2-row'); if (f) select(f.dataset.id); } });
    document.addEventListener('keydown', (e) => { if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && $('modal').hidden) { e.preventDefault(); $('q').focus(); } });
    window.addEventListener('focus', async () => { await loadPresence(); if (S.presence) renderSide(); });
    try {
      await load();
      if (!S.sel || !byId(S.sel) || byId(S.sel).deleted_at) { const g = groups().all; S.sel = (g.pub[0] || g.hid[0] || g.work[0] || {}).id || null; }
      render();
      if (S.sel && byId(S.sel) && byId(S.sel).audience_mode === 'selected') loadAudRows(S.sel);
      if (S.presence) setInterval(async () => { await loadPresence(); renderSide(); }, 30000);
    } catch (e) { console.error(e); $('main').innerHTML = '<div class="bl2-empty">불러오지 못했어요: ' + esc(e.message) + '</div>'; }
  }
  window.BookListV2 = { get state() { return S; }, seenBy, groups, applyOrder, reload };
  document.addEventListener('DOMContentLoaded', start);
})();
