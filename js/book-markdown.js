// =====================================================================
// 입문서(BlockNote) → 마크다운(.md) 변환기 — 공통 모듈
//
// 관리자 리스트(admin-book-list)와 편집기(admin-book-editor) 양쪽에서
// 똑같은 형식의 텍스트 파일을 뽑기 위해 하나의 변환기를 공유한다.
//
//   window.BookMarkdown = {
//     blocksToMarkdown(blocks),          // 한 페이지 blocks → 마크다운
//     buildBookMarkdown(title, pages),   // 책 전체(pages=[{blocks}]) → 마크다운
//     downloadMarkdown(filename, text),  // 브라우저 다운로드 트리거
//     filenameFor(title),                // "제목_YYYY-MM-DD.md"
//   }
//
// 설계 합의(A안 + 캡션):
//   - 제목/표/리스트/굵게·기울임 등 "의미 구조"는 보존, 글자색 등 순수 스타일은 버림
//   - 이미지는 파일 대신 [이미지: 캡션] 텍스트로 (AI가 읽을 수 있게)
//   - 페이지 사이에 --- 구분선 + <!-- 페이지 N --> 주석
// =====================================================================
(function () {
  "use strict";

  var MEDIA_LABEL = { image: "이미지", video: "영상", audio: "오디오", file: "파일" };

  // ── 인라인(굵게/기울임/링크 등) → 마크다운 ──
  function inlineToMd(content) {
    if (!Array.isArray(content)) return "";
    return content
      .map(function (node) {
        if (!node) return "";
        if (node.type === "link") {
          return "[" + inlineToMd(node.content) + "](" + (node.href || "") + ")";
        }
        var t = node.text != null ? String(node.text) : "";
        if (!t) return "";
        var s = node.styles || {};
        // 코드 스팬 안에는 다른 스타일을 겹치지 않는다(마크다운 규칙)
        if (s.code) return "`" + t + "`";
        if (s.strike) t = "~~" + t + "~~";
        if (s.bold) t = "**" + t + "**";
        if (s.italic) t = "*" + t + "*";
        return t;
      })
      .join("");
  }

  // ── 코드블럭 등 순수 텍스트 추출(스타일 없이) ──
  function plainText(content) {
    if (!Array.isArray(content)) return "";
    return content.map(function (n) { return n && n.text != null ? String(n.text) : ""; }).join("");
  }

  // ── 이미지/미디어 → [이미지: 캡션] ──
  function mediaToMd(type, props) {
    props = props || {};
    var label = MEDIA_LABEL[type] || "첨부";
    var cap = (props.caption || "").trim();
    if (cap) return "[" + label + ": " + cap + "]";
    var name = (props.name || "").trim();
    if (name) return "[" + label + ": " + name + "]";
    return "[" + label + " — 설명 없음]";
  }

  // ── 표 → GFM 마크다운 표 ──
  function tableToMd(content) {
    var rows = content && content.rows ? content.rows : [];
    if (!rows.length) return "";
    function cellText(cell) {
      // 셀은 인라인 배열이거나 { content:[...] } 형태일 수 있음
      var inline = Array.isArray(cell) ? cell : cell && cell.content ? cell.content : [];
      return inlineToMd(inline).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
    }
    function rowCells(row) {
      var cells = row && row.cells ? row.cells : [];
      return cells.map(cellText);
    }
    var header = rowCells(rows[0]);
    if (!header.length) return "";
    var sep = header.map(function () { return "---"; });
    var line = function (cells) { return "| " + cells.join(" | ") + " |"; };
    var out = [line(header), line(sep)];
    for (var i = 1; i < rows.length; i++) out.push(line(rowCells(rows[i])));
    return out.join("\n");
  }

  // ── 블럭 1개 → 마크다운(자기 줄) ──
  function blockLine(block, depth) {
    var type = block.type;
    var props = block.props || {};
    var indent = new Array(depth + 1).join("  "); // depth*2 칸

    switch (type) {
      case "heading": {
        var lvl = Math.min(6, Math.max(1, props.level || 1));
        return new Array(lvl + 1).join("#") + " " + inlineToMd(block.content);
      }
      case "quote":
        return "> " + inlineToMd(block.content);
      case "bulletListItem":
        return indent + "- " + inlineToMd(block.content);
      case "numberedListItem":
        return indent + "1. " + inlineToMd(block.content);
      case "checkListItem":
        return indent + "- [" + (props.checked ? "x" : " ") + "] " + inlineToMd(block.content);
      case "codeBlock":
        return "```" + (props.language || "") + "\n" + plainText(block.content) + "\n```";
      case "table":
        return tableToMd(block.content);
      case "image":
      case "video":
      case "audio":
      case "file":
        return mediaToMd(type, props);
      case "paragraph":
      default:
        return inlineToMd(block.content);
    }
  }

  // ── 블럭 + 자식(중첩 리스트 등) 재귀 렌더 ──
  function renderBlock(block, depth) {
    var isList = /ListItem$/.test(block.type || "");
    var parts = [blockLine(block, depth)];
    if (Array.isArray(block.children) && block.children.length) {
      block.children.forEach(function (ch) {
        parts.push(renderBlock(ch, isList ? depth + 1 : depth));
      });
    }
    return parts.join("\n");
  }

  function blocksToMarkdown(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return "";
    return blocks
      .map(function (b) { return renderBlock(b, 0); })
      .join("\n\n")
      .replace(/[ \t]+$/gm, "")   // 줄 끝 공백 정리
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  // ── 책 전체 ──
  function buildBookMarkdown(title, pages) {
    var head = "# " + (title || "입문서");
    var blocks = [head];
    (pages || []).forEach(function (pg, i) {
      var md = blocksToMarkdown(pg && pg.blocks ? pg.blocks : []);
      blocks.push("<!-- 페이지 " + (i + 1) + " -->\n\n" + (md || "_(빈 페이지)_"));
    });
    return blocks.join("\n\n---\n\n") + "\n";
  }

  // ── 파일명: 제목_YYYY-MM-DD.md ──
  function filenameFor(title) {
    var safe = String(title || "입문서").replace(/[\\/:*?"<>|]/g, "").trim() || "입문서";
    var d = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var ymd = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return safe + "_" + ymd + ".md";
  }

  // ── 다운로드 트리거 ──
  function downloadMarkdown(filename, text) {
    var blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "입문서.md";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  window.BookMarkdown = {
    blocksToMarkdown: blocksToMarkdown,
    buildBookMarkdown: buildBookMarkdown,
    downloadMarkdown: downloadMarkdown,
    filenameFor: filenameFor,
  };
})();
