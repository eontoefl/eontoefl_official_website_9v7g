// =====================================================================
// 이온토플 입문서 에디터 — BlockNote 진입점
//
// 정적 페이지(admin-book-editor.html)에서 이렇게 쓴다:
//   const handle = window.BookEditor.mount("#editor", { initialBlocks, onReady });
//   const blocks = handle.getBlocks();
//   const html   = await handle.getHTML();
//
// 2단계에서는 "에디터가 켜진다"까지가 목표. 툴바 구성/이미지 업로드/저장 연결은
// 3~5단계에서 이 파일을 확장한다.
// =====================================================================
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { ko } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

function Editor({ editorRef, initialBlocks, uploadFile, onChange, onReady }) {
  const editor = useCreateBlockNote({
    dictionary: ko, // 한국어 (안내문 / 슬래시 메뉴 등)
    initialContent:
      initialBlocks && initialBlocks.length ? initialBlocks : undefined,
    // 이미지/파일을 끼워넣을 때 호출 → URL 반환. base64 금지의 핵심 통로.
    // (페이지 쪽에서 Supabase Storage 업로더를 넘겨준다)
    uploadFile: uploadFile,
  });

  useEffect(() => {
    editorRef.current = editor;

    // 변경 구독을 onReady보다 먼저 등록 (onReady에서 발생하는 변경도 잡도록)
    let unsub;
    if (onChange && typeof editor.onChange === "function") {
      unsub = editor.onChange(() => onChange());
    }

    if (onReady) onReady();

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [editor]);

  return <BlockNoteView editor={editor} />;
}

const BookEditor = {
  /**
   * 에디터를 특정 요소에 마운트한다.
   * @param {string|HTMLElement} target  - 선택자 또는 DOM 요소
   * @param {object} [options]
   * @param {Array}  [options.initialBlocks] - 처음 보여줄 내용(편집본 blocks)
   * @param {Function} [options.onReady]     - 에디터 준비 완료 시 호출(handle 전달)
   * @returns {object} handle - getBlocks/getHTML/setBlocks/unmount
   */
  mount(target, options = {}) {
    const el =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!el) throw new Error("BookEditor.mount: 대상 요소를 찾을 수 없습니다: " + target);

    const editorRef = { current: null };
    const root = createRoot(el);

    const handle = {
      getEditor: () => editorRef.current,
      getBlocks: () => (editorRef.current ? editorRef.current.document : []),
      setBlocks: (blocks) => {
        const ed = editorRef.current;
        if (!ed) return;
        // 빈 배열로 교체하면 에디터가 깨질 수 있어 최소 1블럭 보장
        const safe =
          Array.isArray(blocks) && blocks.length ? blocks : [{ type: "paragraph" }];
        ed.replaceBlocks(ed.document, safe);
      },
      getHTML: async () => {
        const ed = editorRef.current;
        // 뷰어가 자체 CSS로 스타일링하기 좋게 깔끔한 시맨틱 HTML로 내보낸다
        return ed ? await ed.blocksToHTMLLossy(ed.document) : "";
      },
      // 임의의 blocks(다른 페이지 등)를 HTML로 변환 — 현재 편집중 문서를 안 건드림
      htmlOf: async (blocks) => {
        const ed = editorRef.current;
        return ed ? await ed.blocksToHTMLLossy(blocks || []) : "";
      },
      unmount: () => root.unmount(),
    };

    root.render(
      <Editor
        editorRef={editorRef}
        initialBlocks={options.initialBlocks}
        uploadFile={options.uploadFile}
        onChange={options.onChange}
        onReady={() => options.onReady && options.onReady(handle)}
      />
    );

    return handle;
  },
};

if (typeof window !== "undefined") {
  window.BookEditor = BookEditor;
}

export default BookEditor;
