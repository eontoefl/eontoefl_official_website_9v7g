// Common design editor. Real book data stays in the existing page controller.
import { useEffect, useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { ko } from "@blocknote/core/locales";
import { designBlockSpecs, designPresets, createDesignBlock } from "./design-blocks.jsx";
import { sourceMarkerInlineContentSpecs } from "./source-marker.jsx";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

function normalizeInternalBookLinks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of doc.querySelectorAll("a[href]")) {
    // Reader contents links stay in the same tab; external links retain their
    // existing safe new-tab behavior. This also applies after later edits.
    if (/^\/?book-v2\.html(?:\?|$)/i.test(a.getAttribute("href") || "")) a.target = "_self";
  }
  return doc.body.innerHTML;
}

// Custom blocks (design-blocks.jsx) stay exactly as before; the only addition is the
// bookSourceMarker inline content type alongside the default text/link inline specs.
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, ...designBlockSpecs },
  inlineContentSpecs: { ...defaultInlineContentSpecs, ...sourceMarkerInlineContentSpecs },
});
const themes = [["neutral", "기본 안내"], ["reading", "리딩"], ["listening", "리스닝"], ["writing", "라이팅"], ["speaking", "스피킹"]];
const nativePresets = [
  { type: "table", label: "기본 비교표" },
  { type: "image", label: "사진·캡션" },
  { type: "checkListItem", label: "체크리스트" },
];
function makeBlock(type, theme) {
  if (type === "table") return { type: "table", content: { type: "tableContent", rows: [
    { cells: ["항목", "대상 A", "대상 B"] }, { cells: ["비교 기준", "내용을 입력하세요", "내용을 입력하세요"] },
  ] } };
  if (type === "image") return { type: "image", props: { caption: "사진 설명을 입력하세요" } };
  if (type === "checkListItem") return { type: "checkListItem", content: "확인할 항목을 입력하세요" };
  return createDesignBlock(type, theme);
}
function DesignToolbar({ editor }) {
  const id = useId();
  const [type, setType] = useState("bookCallout");
  const [theme, setTheme] = useState("neutral");
  const [notice, setNotice] = useState("");
  function insert() {
    try {
      const target = editor.getTextCursorPosition()?.block || editor.document.at(-1);
      const created = editor.insertBlocks([makeBlock(type, theme)], target, "after");
      // Do not focus inline content on a content:none block: its labelled form is editable instead.
      if (created[0]?.content !== undefined) editor.setTextCursorPosition(created[0], "start");
      setNotice("디자인을 추가했습니다. 블록의 디자인 편집에서 내용을 바꿀 수 있습니다.");
    } catch (err) { setNotice("추가하지 못했습니다: " + err.message); }
  }
  return <div className="book-design-toolbar" aria-label="공통 디자인 도구" contentEditable={false}>
    <label htmlFor={id + "-type"}>디자인<select id={id + "-type"} value={type} onChange={e => setType(e.target.value)}>
      {[...designPresets, ...nativePresets].map(p => <option key={p.type} value={p.type}>{p.label}</option>)}
    </select></label>
    <label htmlFor={id + "-theme"}>새 블록 색상<select id={id + "-theme"} value={theme} onChange={e => setTheme(e.target.value)}>
      {themes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <button type="button" onClick={insert}>디자인 추가</button>
    <span className="book-design-toolbar-status" role="status">{notice}</span>
  </div>;
}
function Editor({ editorRef, initialBlocks, uploadFile, onChange, onReady, designTools }) {
  const editor = useCreateBlockNote({ schema, dictionary: ko,
    initialContent: initialBlocks?.length ? initialBlocks : undefined, uploadFile });
  useEffect(() => {
    editorRef.current = editor;
    const unsub = typeof editor.onChange === "function" ? editor.onChange(() => onChange?.()) : undefined;
    onReady?.();
    return () => { if (typeof unsub === "function") unsub(); editorRef.current = null; };
  }, [editor]);
  return <div className="book-content">
    {designTools !== false && <DesignToolbar editor={editor} />}
    <BlockNoteView editor={editor} theme="light" />
  </div>;
}
const BookEditor = {
  designPresets, themes, createDesignBlock,
  mount(target, options = {}) {
    const el = typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("BookEditor.mount: 대상 요소를 찾을 수 없습니다: " + target);
    const editorRef = { current: null };
    const root = createRoot(el);
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const handle = {
      ready,
      getEditor: () => editorRef.current,
      getBlocks: () => editorRef.current ? editorRef.current.document : [],
      setBlocks: blocks => {
        const ed = editorRef.current;
        if (!ed) throw new Error("편집기가 준비되기 전입니다.");
        const safe = Array.isArray(blocks) && blocks.length ? blocks : [{ type: "paragraph" }];
        ed.replaceBlocks(ed.document, safe);
      },
      getHTML: async () => { await ready; const ed = editorRef.current; return ed ? normalizeInternalBookLinks(await ed.blocksToHTMLLossy(ed.document)) : ""; },
      htmlOf: async blocks => { await ready; const ed = editorRef.current; return ed ? normalizeInternalBookLinks(await ed.blocksToHTMLLossy(blocks || [])) : ""; },
      unmount: () => root.unmount(),
    };
    root.render(<Editor editorRef={editorRef} initialBlocks={options.initialBlocks} uploadFile={options.uploadFile}
      designTools={options.designTools} onChange={options.onChange}
      onReady={() => { resolveReady(handle); options.onReady?.(handle); }} />);
    return handle;
  },
};
if (typeof window !== "undefined") window.BookEditor = BookEditor;
export default BookEditor;
