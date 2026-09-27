import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseAnnotatedNotes, parseQuestionOptions } from "./design-data.js";
import "./design-editing.css";

const types = new Set(["bookHeading", "bookCallout", "bookCompare", "bookAnnotated", "bookQuestion", "bookFlow", "bookMedia"]);
const states = new WeakMap();
const dialogListeners = new Set();
let opened = null;
function state(editor) {
  if (!states.has(editor)) states.set(editor, { active: null, pending: new Set(), listeners: new Set() });
  return states.get(editor);
}
function liveBlock(editor, id) {
  try { return editor.getBlock(id); } catch { return undefined; }
}
function notify(editor) { state(editor).listeners.forEach((fn) => fn()); }
export function subscribeDesignEdits(editor, listener) {
  state(editor).listeners.add(listener);
  return () => state(editor).listeners.delete(listener);
}
// MUST call synchronously before reading document/getBlocks, saving, exporting,
// changing pages or destroying the editor. On false, abort and keep page mounted:
// a conflicting edit or unfinished IME composition needs the author's attention.
export function flushDesignEdits(editor) {
  let ok = true;
  for (const commit of [...state(editor).pending]) if (!commit()) ok = false;
  return ok;
}
export function getActiveDesignBlock(editor) {
  const block = liveBlock(editor, state(editor).active);
  return block && types.has(block.type) ? block : null;
}
export function designRootEvents(editor, block, editable) {
  if (!editable) return {};
  const remember = () => { state(editor).active = block.id; };
  return { onPointerDownCapture: remember, onFocusCapture: remember };
}
function publishDialog() { dialogListeners.forEach((fn) => fn(opened)); }
export function closeDesignSettings(editor) {
  if (opened && (!editor || opened.editor === editor)) { opened = null; publishDialog(); }
}
export function openDesignSettings(editor, blockId = getActiveDesignBlock(editor)?.id) {
  if (!flushDesignEdits(editor)) return false;
  const block = liveBlock(editor, blockId);
  if (!block || !types.has(block.type)) return false;
  opened = { editor, id: block.id, type: block.type, returnFocus: document.activeElement };
  publishDialog();
  return true;
}
export function updateDesignProps(editor, block, patch) {
  const current = liveBlock(editor, block.id);
  if (!current || current.type !== block.type) return false;
  if (Object.keys(patch).some((key) => current.props[key] !== block.props[key])) return false;
  editor.updateBlock(block.id, { props: patch });
  return true;
}

export function EditorControls({ block, editor, children }) {
  const [request, setRequest] = useState(null);
  const dialogRef = useRef(null);
  const visible = request?.editor === editor && request.id === block.id && request.type === block.type;
  useLayoutEffect(() => {
    dialogListeners.add(setRequest);
    return () => { dialogListeners.delete(setRequest); };
  }, []);
  useLayoutEffect(() => {
    if (!visible) return;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opened === request) { opened = null; publishDialog(); }
      if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
    };
  }, [visible, request]);
  if (!visible) return null;
  const close = () => closeDesignSettings(editor);
  return createPortal(
    <dialog ref={dialogRef} className="book-design-settings" aria-label="디자인 설정" contentEditable={false}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } }}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header><h2>디자인 설정</h2><button type="button" autoFocus onClick={close} aria-label="디자인 설정 닫기">닫기</button></header>
      <div className="book-design-settings-fields">{children}</div>
    </dialog>, document.body,
  );
}

function arrayParser(field) { return field === "notes" ? parseAnnotatedNotes : parseQuestionOptions; }
function valid(result) { return !result.error && !result.invalidCount && !result.omittedCount; }
function readValue(block, field, index, itemKey) {
  if (index === undefined) return block.props[field];
  if (!valid(arrayParser(field)(block.props[field]))) return null;
  return JSON.parse(block.props[field])[index]?.[itemKey] ?? null;
}

// React never owns the editable node's children. Only unfocused clean nodes sync
// props, so typing/IME and caret survive unrelated React renders.
export function DesignText({ as: Tag = "span", block, editor, editable, field, index, itemKey, label, children, ...attributes }) {
  const value = readValue(block, field, index, itemKey);
  if (!editable || value === null) return <Tag {...attributes}>{children ?? value}</Tag>;
  return <EditableText Tag={Tag} block={block} editor={editor} field={field} index={index} itemKey={itemKey}
    value={value} label={label || field} attributes={attributes} />;
}
function EditableText({ Tag, block, editor, field, index, itemKey, value, label, attributes }) {
  const node = useRef(null);
  // Native input isolates a props title from the neighboring inline contentDOM.
  const nativeInput = block.type === 'bookCallout' && field === 'title';
  const fit = () => { const el = node.current; if (nativeInput && el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } };
  const setText = text => { if (node.current) { if (nativeInput) { node.current.value = text; fit(); } else node.current.textContent = text; } };
  const session = useRef(null);
  const [error, setError] = useState(false);
  const latest = useRef(null);
  latest.current = { block, value };
  function begin() {
    if (!session.current) session.current = { baseline: latest.current.block.props[field], dirty: false, composing: false };
  }
  function commit() {
    const draft = session.current;
    if (!draft?.dirty) return !draft?.composing;
    if (draft.composing) return false;
    const current = liveBlock(editor, block.id);
    if (!current || current.type !== block.type || current.props[field] !== draft.baseline) {
      setError(true); node.current?.setAttribute("aria-invalid", "true"); return false;
    }
    const text = (nativeInput ? node.current.value : node.current.innerText).replace(/\r\n?/g, "\n");
    let next = text;
    if (index !== undefined) {
      if (!valid(arrayParser(field)(current.props[field]))) { setError(true); return false; }
      const items = JSON.parse(current.props[field]);
      if (!items[index]) { setError(true); return false; }
      items[index] = { ...items[index], [itemKey]: text };
      next = JSON.stringify(items);
    }
    editor.updateBlock(block.id, { props: { [field]: next } });
    draft.baseline = next; draft.dirty = false;
    setError(false); return true;
  }
  const commitRef = useRef(commit); commitRef.current = commit;
  useLayoutEffect(() => {
    const flush = () => commitRef.current();
    state(editor).pending.add(flush);
    const el = node.current;
    const stop = (event) => event.stopPropagation();
    const input = () => { begin(); session.current.dirty = true; fit(); notify(editor); };
    const focus = () => { state(editor).active = block.id; begin(); };
    const blur = () => {
      if (commitRef.current()) {
        session.current = null;
        setText(readValue(liveBlock(editor, block.id) || latest.current.block, field, index, itemKey) ?? "");
      }
    };
    const start = () => { begin(); session.current.composing = true; };
    const end = () => { session.current.composing = false; input(); };
    const keydown = (event) => {
      event.stopPropagation();
      // Nested plain-text fields are outside ProseMirror's slash-menu event
      // stream. At the start of a field, slash opens the same settings dialog.
      // Slashes elsewhere remain literal (including URLs and fractions).
      if (event.key === "/" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (nativeInput && el.selectionStart === 0 && el.selectionEnd === 0) { event.preventDefault(); openDesignSettings(editor, block.id); return; }
        const selection = nativeInput ? null : el.ownerDocument.getSelection();
        if (selection?.isCollapsed && el.contains(selection.anchorNode)) {
          const prefix = el.ownerDocument.createRange();
          prefix.selectNodeContents(el);
          prefix.setEnd(selection.anchorNode, selection.anchorOffset);
          if (!prefix.toString()) {
            event.preventDefault();
            openDesignSettings(editor, block.id);
            return;
          }
        }
      }
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault(); session.current = null;
        setText(readValue(liveBlock(editor, block.id) || latest.current.block, field, index, itemKey) ?? "");
        setError(false); el.blur();
      }
    };
    // Native listeners run before ProseMirror's parent handlers, unlike React's
    // delegated handlers. Browser Tab navigation and text shortcuts stay native.
    const events = { beforeinput: stop, input: (e) => { stop(e); input(); }, keydown, keyup: stop,
      paste: stop, cut: stop, copy: stop, drop: (e) => { e.preventDefault(); stop(e); },
      pointerdown: stop, mousedown: stop, click: stop, focus, blur,
      compositionstart: (e) => { stop(e); start(); }, compositionupdate: stop,
      compositionend: (e) => { stop(e); end(); } };
    for (const [name, fn] of Object.entries(events)) el.addEventListener(name, fn);
    let width = -1;
    const observer = nativeInput ? new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } }) : null;
    observer?.observe(el);
    if (nativeInput) document.fonts?.addEventListener('loadingdone', fit);
    return () => { observer?.disconnect(); if (nativeInput) document.fonts?.removeEventListener('loadingdone', fit); state(editor).pending.delete(flush); for (const [name, fn] of Object.entries(events)) el.removeEventListener(name, fn); };
  }, [editor, block.id, field, index, itemKey]);
  useLayoutEffect(() => {
    if (!session.current?.dirty && document.activeElement !== node.current) setText(value);
  }, [value]);
  if (nativeInput) return <Tag {...attributes} contentEditable={false}><textarea ref={node} rows={1}
    data-design-inline="true" aria-label={label} aria-multiline="true" aria-invalid={error || undefined} /></Tag>;
  return <Tag {...attributes} ref={node} contentEditable="plaintext-only" suppressContentEditableWarning
    data-design-inline="true" tabIndex={0} role="textbox" aria-label={label} aria-multiline="true"
    aria-invalid={error || undefined} title={error ? "다른 변경과 충돌했습니다. 내용을 복사한 뒤 Esc로 최신 값을 다시 불러오세요." : undefined} />;
}
