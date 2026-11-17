/* =====================================================================
   책 쪽 그리기 공통 모듈 (BookPage)  2026-11-15  — 에디터 정본 화면 통일
   관리자 에디터 v2 · 학생 서재 v2 · PDF 저장 · 미리보기·인쇄가 모두 이것만 쓴다.
   - 쪽 하나 = 독립 칸(shadow DOM). 바깥 화면 규칙이 책 안으로 새지 않고, 쪽끼리 규칙이 섞이지 않는다.
   - 종이 = 794×1058px(210×280mm) 고정. 화면 맞춤·확대는 바깥에서 transform 배율로만 한다.
   - 쪽 html은 자기 디자인(<style>)을 그대로 들고 있다(책마다·쪽마다 별개).
   - 글꼴은 바깥 문서(book-page-fonts.css 등)에 선언(shadow DOM 안 @font-face는 크롬이 무시).
   이 파일은 두 사이트(공홈, 테스트룸)에 같은 내용으로 둔다.
   ===================================================================== */
(function (g) {
  'use strict';
  var W = 794, H = 1058;
  var PREFIX = '<div class="twp">';
  var BASE = ':host{all:initial;display:block;position:relative;box-sizing:border-box;width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff;color:#000;font-size:16px;line-height:normal;text-align:left;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    ':host([data-bp-edit]){height:auto;min-height:' + H + 'px;overflow:visible;-webkit-user-select:text;user-select:text}' +
    '.bp-root{width:' + W + 'px;min-height:' + H + 'px}' +
    'img{-webkit-user-drag:none}';

  function isHtmlPage(p) { return !!p && typeof p.html === 'string' && p.html.trim().indexOf(PREFIX) === 0; }
  function isHtmlBook(pages) { return Array.isArray(pages) && pages.length > 0 && pages.every(isHtmlPage); }

  // host 하나에 쪽 하나를 그린다. opts.edit = 에디터 편집용(종이 밖으로 넘친 부분도 보이게)
  function render(host, html, opts) {
    opts = opts || {};
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (opts.edit) host.setAttribute('data-bp-edit', ''); else host.removeAttribute('data-bp-edit');
    host.classList.add('bp-host');
    root.innerHTML = '<style>' + BASE + '</style><div class="bp-root">' + (html || '') + '</div>';
    root.querySelectorAll('video, audio').forEach(function (el) {
      el.controls = true; el.setAttribute('controlsList', 'nodownload noplaybackrate'); el.setAttribute('playsinline', '');
    });
    return root;
  }

  // 쪽이 종이(280mm)나 글 칸을 넘친 정도(px). 0 = 안 넘침.
  // ① 쪽 자체나 쪽 안 어떤 요소든 1058px 아래로 나간 만큼 ② overflow:hidden 상자 안에서 넘친 만큼 중 큰 값
  function overflowOf(root) {
    var r = root && root.querySelector('.bp-root'); if (!r) return 0;
    var pg = r.querySelector('.twp > .page') || r.firstElementChild; if (!pg) return 0;
    var top = r.getBoundingClientRect().top;
    var over = Math.max(0, pg.getBoundingClientRect().bottom - top - H);
    var els = pg.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], cs = getComputedStyle(el);
      var rb = el.getBoundingClientRect();
      if (rb.height > 0 && rb.bottom - top - H > over) over = rb.bottom - top - H;
      if ((cs.overflowY === 'hidden' || cs.overflow === 'hidden') && el.clientHeight > 0) {
        var d = el.scrollHeight - el.clientHeight; if (d > over) over = d;
      }
    }
    return Math.round(over * 10) / 10;
  }

  // 바깥 상자(box)에 종이를 배율 s로 놓는다. box 크기 = 종이 × s, 안쪽 host는 transform으로만 키움.
  function place(box, host, s) {
    box.style.width = Math.round(W * s) + 'px';
    box.style.height = Math.round(H * s) + 'px';
    host.style.transformOrigin = '0 0';
    host.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  }

  g.BookPage = { W: W, H: H, PREFIX: PREFIX, isHtmlPage: isHtmlPage, isHtmlBook: isHtmlBook, render: render, overflowOf: overflowOf, place: place };
})(window);
