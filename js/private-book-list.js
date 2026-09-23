/* Read-only private catalog. Never merge these rows into the legacy publication/trash controls. */
(function (global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  let generation = 0;
  const el = id => document.getElementById(id);
  function clear(message) {
    generation++;
    el('privateBookList').replaceChildren();
    el('privateBookListStatus').textContent = message;
    el('privateBookListStatus').hidden = false;
    el('privateBookLogout').hidden = true;
    el('privateBookListLogin').hidden = false;
  }
  async function load() {
    const ticket = ++generation;
    try {
      await global.PrivateBook.ready();
      const books = await global.PrivateBook.query('pb_book_documents', {kind:'eq.pages', order:'sort_order.asc'});
      if (ticket !== generation) return false;
      const active = books.filter(book => !book.deleted_at && UUID.test(book.id));
      const list = el('privateBookList'); list.replaceChildren();
      for (const book of active) {
        const card = document.createElement('article'); card.className = 'book-card private-book-card';
        const main = document.createElement('div'); main.className = 'book-card-main';
        const titleRow = document.createElement('div'); titleRow.className = 'book-card-titlerow';
        const title = document.createElement('span'); title.className = 'book-card-title'; title.textContent = book.title || '제목 없음';
        const badge = document.createElement('span'); badge.className = 'badge badge-hidden'; badge.textContent = '숨김';
        titleRow.append(title, badge);
        const meta = document.createElement('div'); meta.className = 'book-card-meta';
        meta.textContent = (Number(book.total_pages) || 0) + '페이지 · 관리자만 열람·편집 · 공개 전환 불가';
        main.append(titleRow, meta);
        const actions = document.createElement('div'); actions.className = 'book-card-actions';
        const toggle = document.createElement('label'); toggle.className = 'toggle';
        toggle.title = '학생 공개 기능이 연결되지 않아 숨김으로 유지됩니다.';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = false; checkbox.disabled = true;
        checkbox.setAttribute('aria-label', '숨김 유지 · 공개 전환 불가');
        const track = document.createElement('span'); track.className = 'toggle-track';
        const thumb = document.createElement('span'); thumb.className = 'toggle-thumb';
        toggle.append(checkbox, track, thumb); actions.append(toggle);
        for (const [label,file] of [['수정','admin-book-editor.html'],['미리보기','admin-book-preview.html']]) {
          const a = document.createElement('a'); a.className = 'book-card-edit'; a.textContent = label;
          a.href = file + '?private=1&book=' + encodeURIComponent(book.id); actions.append(a);
        }
        card.append(main, actions); list.append(card);
      }
      el('privateBookListLogin').hidden = true;
      el('privateBookListStatus').textContent = '';
      el('privateBookListStatus').hidden = true;
      el('privateBookLogout').hidden = false;
      return true;
    } catch (_) {
      if (ticket === generation) clear('보호된 숨김 교재는 관리자 로그인 후 표시됩니다.');
      return false;
    }
  }
  global.addEventListener('privatebook:signed-out', () => clear('교재 계정에서 로그아웃되었습니다.'));
  el('privateBookLogout').addEventListener('click', async () => {
    if (!global.confirm('편집 중인 내용은 먼저 저장해주세요. 교재 계정에서 로그아웃할까요?')) return;
    try { await global.PrivateBook.logout(); clear('교재 계정에서 로그아웃되었습니다.'); }
    catch (_) { el('privateBookListStatus').hidden = false; el('privateBookListStatus').textContent = '로그아웃하지 못했습니다. 다시 시도해주세요.'; }
  });
  global.PrivateBookList = Object.freeze({load,clear});
})(window);
