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
        const badge = document.createElement('span'); badge.className = 'badge private-book-badge'; badge.textContent = '관리자 전용 · 비공개';
        titleRow.append(title, badge);
        const meta = document.createElement('div'); meta.className = 'book-card-meta';
        meta.textContent = (Number(book.total_pages) || 0) + '페이지 · 학생에게 공개되지 않습니다';
        main.append(titleRow, meta);
        const actions = document.createElement('div'); actions.className = 'book-card-actions';
        for (const [label,file] of [['수정','admin-book-editor.html'],['미리보기','admin-book-preview.html']]) {
          const a = document.createElement('a'); a.className = 'book-card-edit'; a.textContent = label;
          a.href = file + '?private=1&book=' + encodeURIComponent(book.id); actions.append(a);
        }
        card.append(main, actions); list.append(card);
      }
      el('privateBookListLogin').hidden = true;
      el('privateBookListStatus').textContent = active.length ? '관리자 인증 완료 · 비공개 교재 ' + active.length + '개' : '등록된 비공개 교재가 없습니다.';
      return true;
    } catch (_) {
      if (ticket === generation) clear('비공개 관리자 로그인 후 교재가 표시됩니다. 기존 사이트 로그인과 별도입니다.');
      return false;
    }
  }
  global.addEventListener('privatebook:signed-out', () => clear('로그아웃되었습니다. 비공개 관리자 로그인이 필요합니다.'));
  global.PrivateBookList = Object.freeze({load,clear});
})(window);
