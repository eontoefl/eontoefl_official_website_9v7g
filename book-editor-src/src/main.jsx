// Common design editor. Real book data stays in the existing page controller.
import { useEffect, useState } from "react";
import { PageFooterExtension } from "./page-footer.js";
import "../../js/book-page-footer.js";
import "../../css/book-page-footer.css";
import { createRoot } from "react-dom/client";
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from "@blocknote/core";
import { useCreateBlockNote, SuggestionMenuController } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { ko } from "@blocknote/core/locales";
import { designBlockSpecs, designPresets, createDesignBlock, openDesignSettings, flushDesignEdits, subscribeDesignEdits, closeDesignSettings } from "./design-blocks.jsx";
import { sourceMarkerInlineContentSpecs } from "./source-marker.jsx";
import { bookThemes, filteredBookSlashItems } from "./book-slash-menu.jsx";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

function normalizeInternalBookLinks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of doc.querySelectorAll("a[href]")) {
    // Reader contents links stay in the same tab; external links retain their
    // existing safe new-tab behavior. This also applies after later edits.
    if (/^\/?(?:book-v2|admin-book-preview)\.html(?:\?|$)/i.test(a.getAttribute("href") || "")) a.target = "_self";
  }
  window.BookPageFooter.decorateReader(doc.body);
  return doc.body.innerHTML;
}

// Keep existing stored block/marker schemas. Authoring UI changes must not rewrite
// saved page JSON or replace the reader's exported teaching content.
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, ...designBlockSpecs },
  inlineContentSpecs: { ...defaultInlineContentSpecs, ...sourceMarkerInlineContentSpecs },
});
const themes = bookThemes;
function Editor({ editorRef, initialBlocks, uploadFile, onChange, onReady, designTools }) {
  const [theme, setTheme] = useState("neutral");
  const editor = useCreateBlockNote({ schema, dictionary: ko, extensions:[PageFooterExtension],
    initialContent: initialBlocks?.length ? initialBlocks : undefined, uploadFile });
  useEffect(() => {
    editorRef.current = editor;
    const unsub = typeof editor.onChange === "function" ? editor.onChange(() => onChange?.()) : undefined;
    const unsubDirect = subscribeDesignEdits(editor, () => onChange?.());
    onReady?.();
    return () => { if (typeof unsub === "function") unsub(); unsubDirect(); closeDesignSettings(editor); editorRef.current = null; };
  }, [editor]);
  return <div className="book-content bookv2-content">
    <BlockNoteView editor={editor} theme="light" slashMenu={false}>
      {designTools !== false && <SuggestionMenuController triggerCharacter="/"
        getItems={async query => filteredBookSlashItems(editor, query, {theme, onTheme:setTheme,
          onConfigure:id=>openDesignSettings(editor,id)})} />}
    </BlockNoteView>
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
      flush: () => !editorRef.current || flushDesignEdits(editorRef.current),
      getBlocks: () => { const ed = editorRef.current; if (!ed) return []; if (!flushDesignEdits(ed)) throw new Error('입력 중이거나 다른 변경과 충돌한 내용이 있습니다. 입력을 마친 뒤 다시 저장해주세요.'); return ed.document; },
      setBlocks: blocks => {
        const ed = editorRef.current;
        if (!ed) throw new Error("편집기가 준비되기 전입니다.");
        if (!flushDesignEdits(ed)) throw new Error('입력 내용을 먼저 확인해주세요.');
        const safe = Array.isArray(blocks) && blocks.length ? blocks : [{ type: "paragraph" }];
        ed.replaceBlocks(ed.document, safe);
      },
      getHTML: async () => { await ready; const ed = editorRef.current; if (ed && !flushDesignEdits(ed)) throw new Error('입력 내용을 먼저 확인해주세요.'); return ed ? normalizeInternalBookLinks(await ed.blocksToHTMLLossy(ed.document)) : ""; },
      htmlOf: async blocks => { await ready; const ed = editorRef.current; if (ed && !flushDesignEdits(ed)) throw new Error('입력 내용을 먼저 확인해주세요.'); return ed ? normalizeInternalBookLinks(await ed.blocksToHTMLLossy(blocks || [])) : ""; },
      unmount: () => { if (editorRef.current && !flushDesignEdits(editorRef.current)) throw new Error('입력 내용을 먼저 확인해주세요.'); root.unmount(); },
    };
    root.render(<Editor editorRef={editorRef} initialBlocks={options.initialBlocks} uploadFile={options.uploadFile}
      designTools={options.designTools} onChange={options.onChange}
      onReady={() => { resolveReady(handle); options.onReady?.(handle); }} />);
    return handle;
  },
};
if (typeof window !== "undefined") window.BookEditor = BookEditor;
export default BookEditor;
