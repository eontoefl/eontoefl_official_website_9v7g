/* Presentation only: identify the existing centered '- 123 -' paragraph.
   Never change page text, block IDs, source numbering or persisted JSON. */
(function (global) {
  'use strict';
  const isNumber = text => /^\s*-\s*\d{1,4}\s*-\s*$/.test(text || '');
  function mark(root, candidates) {
    if (!root) return;
    const matches = candidates.filter(item => item.number);
    for (const item of candidates) item.element.classList.toggle('book-page-number', matches.length === 1 && item.number);
    root.classList.toggle('book-numbered-page', matches.length === 1);
  }
  function decorateReader(root) {
    if (!root) return;
    mark(root, Array.from(root.children).map(element => ({element, number:
      element.tagName === 'P' && isNumber(element.textContent) &&
      (element.style.textAlign === 'center' || element.getAttribute('data-text-alignment') === 'center')
    })));
  }
  global.BookPageFooter = Object.freeze({isNumber, decorateReader});
})(typeof window !== 'undefined' ? window : globalThis);
