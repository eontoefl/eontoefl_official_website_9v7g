// =====================================================================
// 입문서 편집기 — "HTML 책" 모드 (보이는 그대로 글자만 고치기)  2026-11-10
//
// HTML 책 = 모든 쪽의 저장된 html이 <div class="twp"> 로 시작하는 책
//   (어시스턴트가 인쇄용 HTML을 그대로 넣은 책. 예: 문장 배열 표현장)
// 이 책을 열면 BlockNote 편집 칸 대신 학생 화면과 같은 html을 그대로 보여 주고,
// 글자만 바로 고친다.
//   - 브라우저 임시저장(localStorage) 없음. 저장 = 고친 쪽만 바로 서버(tr_book_pages.html).
//   - 저장 직전 서버의 그 쪽 updated_at 이 편집기를 연 뒤 바뀌었으면 저장을 멈춘다
//     ("새 버전이 있어요. 새로고침한 뒤 다시 고쳐 주세요.").
//   - blocks 는 건드리지 않는다. 쪽 추가·복제·삭제·순서 이동·버전 되돌리기·텍스트 내려받기는 숨긴다.
//   - <style> 과 숨은 목차 제목(h1.twp-h)은 고치지 못한다(편집 영역 밖).
// 다른 책(블록 책)은 이 파일이 아무것도 하지 않는다.
// =====================================================================
(function () {
  'use strict';

  const PREFIX = '<div class="twp">';
  const RANGE_TITLE = /^(\d{2,3})\s+(.+?)\s+~\s+(.+)$/;
  const M = { active: false, dirty: new Set(), loadedAt: new Map() };

  function isHtmlPage(p) { return !!p && typeof p.html === 'string' && p.html.trim().startsWith(PREFIX); }
  function detect(pages) { return Array.isArray(pages) && pages.length > 0 && pages.every(isHtmlPage); }

  function setDirty(id, on) {
    if (on) M.dirty.add(id); else M.dirty.delete(id);
    const sec = State.nodes.get(id);
    if (sec) sec.classList.toggle('is-dirty', on);
    if (on) setStatus('editing', '고친 쪽 ' + M.dirty.size + '개 · 저장 안 함');
  }

  function editableRegions(root) {
    // .twp 바로 아래 .page 만 고칠 수 있다(<style>, h1.twp-h 는 밖)
    return [...root.querySelectorAll('.twp > .page')];
  }

  // 쪽 html 의 블록 사이 줄바꿈(공백만 있는 글자 마디)은 편집 모드(plaintext-only)에서 빈 줄로 보인다 → 지운다
  function dropNewlineGaps(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const kill = [];
    let n; while ((n = w.nextNode())) { if (/^\s*$/.test(n.data) && n.data.includes('\n')) kill.push(n); }
    kill.forEach((t) => t.remove());
  }

  function makeEditable(region, pageId) {
    dropNewlineGaps(region);
    region.setAttribute('contenteditable', 'plaintext-only');
    if (region.contentEditable !== 'plaintext-only') region.setAttribute('contenteditable', 'true'); // 오래된 브라우저
    region.setAttribute('spellcheck', 'false');
    region.querySelectorAll('img').forEach((im) => { im.setAttribute('contenteditable', 'false'); im.setAttribute('draggable', 'false'); });
    region.addEventListener('input', () => setDirty(pageId, true));
    region.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); return; }                 // 줄·칸 구조는 그대로
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ['b', 'i', 'u'].includes(String(e.key).toLowerCase())) e.preventDefault(); // 서식 단축키 막기
    });
    region.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      document.execCommand('insertText', false, text.replace(/\s*\r?\n\s*/g, ' '));
    });
    region.addEventListener('drop', (e) => e.preventDefault());
    region.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function createSection(p) {
    const sec = document.createElement('section');
    sec.className = 'bookedit-page bookedit-htmlpage';
    sec.dataset.id = p.id;
    sec.innerHTML = '<div class="bookedit-paper"><div class="bookedit-html"></div></div>';
    const box = sec.querySelector('.bookedit-html');
    box.innerHTML = p.html || '';
    editableRegions(box).forEach((r) => makeEditable(r, p.id));
    sec.addEventListener('mousedown', () => setCurrent(p.id));
    return sec;
  }

  // 저장할 html: 원래 모양 그대로, 편집용 속성만 뺀다
  function htmlOf(pageId) {
    const sec = State.nodes.get(pageId);
    const twp = sec && sec.querySelector('.bookedit-html > .twp');
    if (!twp) return null;
    const c = twp.cloneNode(true);
    c.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    c.querySelectorAll('.page[spellcheck]').forEach((el) => el.removeAttribute('spellcheck'));
    c.querySelectorAll('img[draggable]').forEach((el) => el.removeAttribute('draggable'));
    return c.outerHTML;
  }

  function countImgs(html) { return (String(html).match(/<img\b/g) || []).length; }

  function buildOutline() {
    const listEl = document.getElementById('outlineList');
    if (!listEl) return;
    listEl.innerHTML = '';
    let n = 0;
    State.pages.forEach((p) => {
      const sec = State.nodes.get(p.id);
      if (!sec) return;
      sec.querySelectorAll('h1, h2').forEach((h) => {
        const text = (h.textContent || '').trim();
        if (!text) return;
        const btn = document.createElement('button');
        btn.className = 'bookedit-outline-item lv' + (h.tagName === 'H1' ? 1 : 2);
        btn.title = text; btn.dataset.pageId = p.id;
        // "07 첫 단어 ~ 끝 단어" 꼴 제목(단어장 v2 단어 쪽): 번호 칩 + 첫 단어 윗줄, 끝 단어 아랫줄
        const rg = text.match(RANGE_TITLE);
        if (rg) {
          btn.classList.add('bo-range');
          const chip = document.createElement('span'); chip.className = 'bo-chip'; chip.textContent = rg[1];
          const tx = document.createElement('span'); tx.className = 'bo-tx';
          const b = document.createElement('b'); b.textContent = rg[2];
          const s = document.createElement('span'); s.textContent = '~ ' + rg[3];
          tx.append(b, s); btn.append(chip, tx);
        } else btn.textContent = text;
        btn.addEventListener('click', () => {
          State.scrollLock = true;
          setCurrent(p.id);
          sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
          setTimeout(() => { State.scrollLock = false; }, 700);
        });
        listEl.appendChild(btn); n++;
      });
    });
    if (!n) listEl.innerHTML = '<div class="bookedit-outline-empty">목차가 없어요.</div>';
  }

  function start() {
    M.active = true;
    document.body.classList.add('bookedit-htmlmode');
    ['showVersions()', 'downloadBook()'].forEach((fn) => { const b = document.querySelector('[onclick="' + fn + '"]'); if (b) { b.hidden = true; b.style.display = 'none'; } });
    const saveBtn = document.getElementById('btnSave');
    if (saveBtn) saveBtn.title = '저장 (고친 쪽만 바로 서버에 저장 · 학생 화면에 반영)';

    const stack = document.getElementById('pageStack');
    stack.innerHTML = '';
    State.pages.forEach((p) => {
      M.loadedAt.set(p.id, p.updated_at || null);
      const sec = createSection(p);
      State.nodes.set(p.id, sec);
      stack.appendChild(sec);
    });

    setupOutline();      // 접기·너비 조절 (목차 내용은 아래 buildOutline 이 채운다)
    bindScrollTracking();
    // 목차에서 지금 보는 쪽 표시(제목이 있는 쪽)
    const canvas = document.getElementById('canvas');
    let raf = false;
    const mark = () => { raf = false; const list = document.getElementById('outlineList'); if (!list) return; const items = [...list.querySelectorAll('.bookedit-outline-item[data-page-id]')]; let cur = null; const idx = State.pages.findIndex((p) => p.id === State.currentId); for (const it of items) { const i = State.pages.findIndex((p) => p.id === it.dataset.pageId); if (i <= idx) cur = it.dataset.pageId; } items.forEach((it) => it.classList.toggle('active', it.dataset.pageId === cur)); };
    if (canvas) canvas.addEventListener('scroll', () => { if (!raf) { raf = true; requestAnimationFrame(mark); } }, { passive: true });
    setTimeout(mark, 300);
    const loading = document.getElementById('editorLoading');
    if (loading) loading.style.display = 'none';
    const bar = document.getElementById('slideBar'); if (bar) bar.hidden = true;
    setCurrent(State.pages.length ? State.pages[0].id : null);
    window.addEventListener('beforeunload', (e) => { if (M.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
    setStatus('saved', '준비됨 · 보이는 그대로 글자만 고쳐요 (임시저장 없음, 저장해야 반영)');
  }

  async function save() {
    const btn = document.getElementById('btnSave');
    if (!M.dirty.size) { setStatus('saved', '변경 없음'); return; }
    btn.disabled = true;
    setStatus('editing', '저장 중…');
    const targets = State.pages.map((p) => p.id).filter((id) => M.dirty.has(id));
    try {
      // 1) 모두 먼저 확인: 내용 깨짐, 새 버전
      const outs = [];
      for (const id of targets) {
        const p = State.pages.find((x) => x.id === id);
        const html = htmlOf(id);
        if (!html || !html.startsWith(PREFIX)) throw new Error('쪽 모양을 읽지 못했어요. 새로고침한 뒤 다시 고쳐 주세요.');
        if (countImgs(html) !== countImgs(p.html)) throw new Error('그림이 지워진 쪽이 있어요(' + (State.pages.indexOf(p) + 1) + '쪽). 새로고침한 뒤 글자만 다시 고쳐 주세요.');
        outs.push({ id, p, html });
      }
      const rows = await supabaseAPI.query('tr_book_pages', { id: 'in.(' + targets.join(',') + ')', select: 'id,updated_at,deleted_at' });
      const stale = outs.filter((o) => {
        const r = (rows || []).find((x) => x.id === o.id);
        if (!r || r.deleted_at) return true;
        return Date.parse(r.updated_at || 0) !== Date.parse(M.loadedAt.get(o.id) || 0);
      });
      if (stale.length) {
        setStatus('error', '새 버전이 있어요 · 저장 안 함');
        alert('새 버전이 있어요. 새로고침한 뒤 다시 고쳐 주세요.\n\n(편집기를 연 뒤 다른 곳에서 ' + stale.map((o) => (State.pages.indexOf(o.p) + 1) + '쪽').join(', ') + '이 저장됐어요. 지금 고친 내용은 저장하지 않았어요.)');
        return;
      }
      // 2) 저장
      for (const o of outs) {
        const res = await supabaseAPI.patch('tr_book_pages', o.id, { html: o.html, updated_at: new Date().toISOString() });
        const at = (res && res.updated_at) || new Date().toISOString();
        try {
          await supabaseAPI.post('tr_book_page_versions', { page_id: o.id, book_id: State.book.id, blocks: o.p.blocks || [], html: o.html, created_by: currentUserEmail() });
        } catch (e) { console.warn('버전 기록 실패(본문은 저장됨)', e); }
        o.p.html = o.html; o.p.updated_at = at; M.loadedAt.set(o.id, at);
        setDirty(o.id, false);
      }
      try { const now = new Date().toISOString(); await supabaseAPI.patch('tr_book_documents', State.book.id, { updated_at: now }); State.book.updated_at = now; } catch (_) {}
      buildOutline();
      setStatus('saved', outs.length > 1 ? outs.length + '개 쪽 저장됨 (서버 반영)' : '저장됨 (서버 반영)');
    } catch (e) {
      console.error(e);
      setStatus('error', '저장 실패');
      alert('저장하지 못했어요: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  window.BookHtmlMode = { detect, start, save, buildOutline, get active() { return M.active; }, get dirtyCount() { return M.dirty.size; } };
})();
