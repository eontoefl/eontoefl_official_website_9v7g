import { createExtension } from '@blocknote/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import '../../js/book-theme.js';

// Editor-side twin of BookTheme.decorateReader. Uses decorations only, so the
// stored blocks and text never change. CSS applies only inside .bt-eon pages.
const R = () => window.BookTheme.rules;

function leadingText(node) {
  // first text child (skipping nothing else); returns {text, offset} within node content
  let off = 0;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.isText) return { text: c.text, offset: off };
    off += c.nodeSize;
    if (c.type.name !== 'hardBreak') return null;
  }
  return null;
}
function inlineLead(decos, node, pos, re, cls, attrsFor, gap) {
  const lead = leadingText(node); if (!lead) return false;
  const m = lead.text.match(re); if (!m) return false;
  const from = pos + 1 + lead.offset + m.index + m[1].length; const to = from + m[2].length + (gap ? (m[3] || '').length : 0);
  decos.push(Decoration.inline(from, to, { class: 'bt-deco ' + cls, ...(attrsFor ? attrsFor(m[2]) : {}) }));
  return true;
}
function arrows(decos, node, pos) {
  let off = 0, lineStart = true, count = 0, seen = false;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c.type.name === 'hardBreak') lineStart = true;
    else if (c.isText) {
      if (lineStart) { const m = c.text.match(R().arrow); if (m) { const from = pos + 1 + off + m[1].length; const lead = !seen; decos.push(Decoration.inline(from, from + m[2].length + (lead ? m[3].length : 0), { class: lead ? 'bt-deco bt-arw bt-arw-lead' : 'bt-deco bt-arw' })); count++; } }
      if (c.text.trim()) { lineStart = false; seen = true; }
    } else { lineStart = false; seen = true; }
    off += c.nodeSize;
  }
  return count;
}
function allLinked(node) {
  let any = false, ok = true;
  node.forEach(c => { if (c.isText && c.text.trim()) { any = true; if (!c.marks.some(m => m.type.name === 'link')) ok = false; } });
  return any && ok;
}
function trailingPage(decos, node, pos) {
  let off = 0, last = null, lastOff = 0;
  node.forEach((c, o) => { if (c.isText && c.text.trim()) { last = c; lastOff = o; } });
  if (!last) return;
  const m = last.text.match(R().tocPage); if (!m) return;
  const from = pos + 1 + lastOff + m.index + (m[0].length - m[0].trimStart().length); const to = pos + 1 + lastOff + last.text.trimEnd().length;
  decos.push(Decoration.inline(from, to, { class: 'bt-deco bt-tpage' }));
}

function build(doc) {
  const decos = [];
  const rules = R(); let last = '';
  let run = [];
  const flush = () => { const kinds = rules.unifyRun(run.map(r => r.kind)); run.forEach((r, i) => decos.push(Decoration.node(r.pos - 1, r.pos - 1 + r.parent.nodeSize, { class: kinds[i] === 'src' ? 'bt-src' : 'bt-memo-' + kinds[i] }))); run = []; };
  // React node views ignore decoration attrs, so mark the surrounding blockContainer instead.
  const outer = (pos, parent, attrs) => { if (parent && parent.type.name === 'blockContainer') decos.push(Decoration.node(pos - 1, pos - 1 + parent.nodeSize, attrs)); };
  doc.descendants((node, pos, parent) => {
    const name = node.type.name;
    let prevBlock = '';
    if (node.isBlock && name !== 'blockContainer' && name !== 'blockGroup' && name !== 'doc') { prevBlock = last; last = name; if (name !== 'bookCallout' && run.length) flush(); }
    if (name === 'table') return false;
    if (name === 'bookHeading') {
      const level = String(node.attrs.level || '2');
      const num = c => ({ 'data-n': String(rules.circledNumber(c)) });
      if (level === '1') { if (!inlineLead(decos, node, pos, rules.step, 'bt-num', num)) {
        const lead = leadingText(node); const m = lead && lead.text.match(rules.kick);
        if (m) { inlineLead(decos, node, pos, rules.kick, 'bt-kick', null, !allLinked(node));
          if (allLinked(node)) outer(pos, parent, { 'data-bt-ch': window.BookTheme.CH_BY_NUM[m[2].padStart(2, '0')] || 'n' }); } }
      } else inlineLead(decos, node, pos, rules.step, 'bt-num', num);
      if (allLinked(node)) trailingPage(decos, node, pos);
      return false;
    }
    if (name === 'paragraph') {
      const text = node.textContent; const cls = [];
      if (/^\s*-\s*\d{1,4}\s*-\s*$/.test(text)) return false;
      const eng = rules.isEnglish(text);
      if (inlineLead(decos, node, pos, rules.step, 'bt-num', c => ({ 'data-n': String(rules.circledNumber(c)) }))) { if (!eng) cls.push('bt-step'); }
      else if (inlineLead(decos, node, pos, rules.parenStep, 'bt-pnum')) cls.push('bt-pstep');
      else if (inlineLead(decos, node, pos, rules.leadNum, 'bt-lnum')) cls.push('bt-li');
      if (arrows(decos, node, pos) && rules.arrow.test(text.trimStart())) cls.push('bt-arrp');
      if (eng) { cls.push('bt-eng'); if (rules.engPlain(text)) cls.push('bt-eng-plain'); }
      if (allLinked(node)) { cls.push('bt-tocitem'); trailingPage(decos, node, pos); }
      if (cls.length) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: cls.join(' ') }));
      return false;
    }
    if (name === 'bookCallout') {
      const media = ['image', 'table', 'bookMedia', 'video'].includes(prevBlock);
      if (parent && parent.type.name === 'blockContainer') run.push({ pos, parent, kind: media && rules.source.test(node.textContent) ? 'src' : rules.memoKind(node.textContent) });
      arrows(decos, node, pos);
      return false;
    }
    return true;
  });
  flush();
  return DecorationSet.create(doc, decos);
}

export const BookThemeExtension = createExtension({
  key: 'bookTheme',
  prosemirrorPlugins: [new Plugin({
    key: new PluginKey('bookTheme'),
    state: { init: (_, state) => build(state.doc), apply: (tr, old) => tr.docChanged ? build(tr.doc) : old },
    props: { decorations(state) { return this.getState(state); } },
  })],
});


