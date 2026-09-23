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

  // 소스 위치 마커(book-editor-src/src/source-marker.jsx의 bookSourceMarker 인라인 콘텐츠) 허용 글자.
  // 두 파일은 서로 import할 수 없는 별도 런타임(브라우저 IIFE vs React 모듈)이라 목록을 그대로 복제해
  // 유지한다. 순서/구성을 바꾸면 반드시 두 곳을 함께 바꿀 것.
  var BOOK_SOURCE_MARKER_GLYPHS = ["X", "\u2713", "\u25cb", "\u25cf", "\u2192", "\u2197", "\u2198", "\u2193", "\u2199", "\u2190", "\u2196", "\u2191"];
  function isBookSourceMarkerGlyph(g) {
    return typeof g === "string" && BOOK_SOURCE_MARKER_GLYPHS.indexOf(g) !== -1;
  }

  // ── 인라인(굵게/기울임/링크 등) → 마크다운 ──
  function inlineToMd(content) {
    if (!Array.isArray(content)) return "";
    return content
      .map(function (node) {
        if (!node) return "";
        if (node.type === "link") {
          return "[" + inlineToMd(node.content) + "](" + (node.href || "") + ")";
        }
        if (node.type === "bookSourceMarker") {
          // 원자적(atomic) 소스 위치 마커: text 필드가 없어 아래 일반 텍스트 노드 경로를 타면
          // 빈 문자열로 조용히 사라진다. 검증된 글자는 그대로(이스케이프 불필요한 안전한 유니코드
          // 기호), 손상된 값은 codeSpan으로 원본을 보존해 절대 조용히 유실하지 않는다.
          var glyph = node.props && node.props.glyph;
          return isBookSourceMarkerGlyph(glyph)
            ? glyph
            : codeSpan("[미확인 소스 마커: " + JSON.stringify(glyph === undefined ? null : glyph) + "]");
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

  // ── JSON 배열 props(예: notes/options)를 안전하게 해석 ──
  // 실패해도 원본 문자열을 절대 버리지 않고 그대로 보존한다.
  function safeJsonArray(raw) {
    if (raw == null || raw === "") return { ok: true, data: [] };
    if (Array.isArray(raw)) return { ok: true, data: raw }; // 이미 배열로 들어온 경우 대비
    var str = String(raw);
    try {
      var parsed = JSON.parse(str);
      if (!Array.isArray(parsed)) throw new Error("array가 아님");
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, data: null, raw: str, error: e && e.message };
    }
  }

  // 문자열 안에서 가장 긴 연속 백틱(`) 개수를 센다. 코드 스팬/펜스 구분자 길이를 정할 때 쓴다.
  function longestBacktickRun(text) {
    var s = text == null ? "" : String(text);
    var max = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === "`") { cur++; if (cur > max) max = cur; } else cur = 0;
    }
    return max;
  }

  // 인라인 코드 스팬: 내용에 들어있는 백틱보다 긴 구분자를 써서 조기 종료(탈출)를 막는다.
  function codeSpan(text) {
    var s = text == null ? "" : String(text);
    var fenceLen = longestBacktickRun(s) + 1;
    var fence = new Array(fenceLen + 1).join("`");
    var needsPad = s === "" || /^`/.test(s) || /`$/.test(s);
    return fence + (needsPad ? " " : "") + s + (needsPad ? " " : "") + fence;
  }

  // 코드 펜스(``` ... ```): 내용에 들어있는 백틱보다 긴 펜스를 써서 조기 종료(탈출)를 막는다.
  function codeFenceFor(text) {
    var s = text == null ? "" : String(text);
    var fenceLen = Math.max(3, longestBacktickRun(s) + 1);
    return new Array(fenceLen + 1).join("`");
  }

  // JSON 파싱 실패 시: 경고 + 원본 텍스트를 코드블럭으로 그대로 보존한다(이모지/특수기호 없이).
  // 원본 텍스트 안에 백틱이 있어도 펜스가 조기 종료되지 않도록 길이를 늘려서 쓴다.
  function jsonWarningBlock(label, raw, errMsg) {
    var body = raw == null ? "" : raw;
    var fence = codeFenceFor(body);
    return (
      "> 경고: " + label + " 데이터를 해석하지 못했습니다(JSON 오류" +
      (errMsg ? ": " + errMsg : "") +
      "). 원본 텍스트를 그대로 표시합니다.\n" +
      fence + "\n" + body + "\n" + fence
    );
  }

  // http(s) 이면서 실제로 파싱 가능한 절대 URL만 실행 가능한 링크로 인정한다.
  //   - 제어문자(탭/개행/그 외 C0, DEL)가 하나라도 섞여 있으면 무조건 거부
  //     (단순 접두사 정규식은 "java\nscript:..." 같은 값을 걸러내지 못한다)
  //   - new URL()로 실제로 파싱해 protocol/hostname을 확인한다
  function isSafeHttpUrl(raw) {
    if (raw == null) return false;
    var s = String(raw);
    if (/[\x00-\x1F\x7F]/.test(s)) return false; // 제어문자 포함 시 무조건 거부
    var trimmed = s.trim();
    if (!trimmed) return false;
    var UrlCtor = typeof URL !== "undefined" ? URL : null;
    if (!UrlCtor) return false; // URL 생성자를 쓸 수 없는 환경에서는 안전하게 실패 처리
    try {
      var u = new UrlCtor(trimmed);
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      if (!u.hostname) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 마크다운 링크 "텍스트" 부분 이스케이프: \ [ ] 를 이스케이프해 링크 구문 밖으로 탈출하지 못하게 한다.
  function escapeLinkText(text) {
    var s = text == null ? "" : String(text);
    return s.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  // 마크다운 링크 "대상(destination)" 부분: <...> 꺾쇠 형태로 감싸서 괄호(). ) 탈출 문제를
  // 원천 차단하고, <, >, \ 만 이스케이프한다(꺾쇠 안에서는 괄호를 이스케이프할 필요가 없다).
  function escapeLinkDestination(url) {
    var s = url == null ? "" : String(url);
    return s.replace(/\\/g, "\\\\").replace(/</g, "\\<").replace(/>/g, "\\>");
  }

  function safeMdLink(text, url) {
    return "[" + escapeLinkText(text) + "](<" + escapeLinkDestination(url) + ">)";
  }

  // 예상한 필드(quote/note, label/text/explanation/correct 등) 중 하나라도 있는지 확인.
  // 원시값이거나 전혀 다른 구조의 데이터가 섞여도 자리표시자 텍스트를 원본 없이 만들지 않기 위함.
  function hasOwnAny(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined) return true;
    }
    return false;
  }

  // ── 제목형 커스텀 블럭: bookHeading ──
  function bookHeadingToMd(block) {
    var props = block.props || {};
    var lvl = parseInt(props.level, 10);
    if (!lvl || isNaN(lvl)) lvl = 2;
    lvl = Math.min(3, Math.max(1, lvl)); // 커스텀 제목은 1~3단계까지만 허용
    return new Array(lvl + 1).join("#") + " " + inlineToMd(block.content);
  }

  // ── 강조 박스: bookCallout(정보/팁/주의) ──
  function bookCalloutToMd(block) {
    var props = block.props || {};
    var toneMap = { info: "안내", tip: "팁", warning: "주의" };
    var toneLabel = toneMap[props.tone] || ("참고" + (props.tone ? "(" + props.tone + ")" : ""));
    var title = (props.title || "").trim();
    var head = "**" + toneLabel + (title ? ": " + title : "") + "**";
    var body = inlineToMd(block.content);
    var lines = ["> " + head];
    if (body) {
      lines.push(">");
      body.split("\n").forEach(function (l) { lines.push("> " + l); });
    }
    return lines.join("\n");
  }

  // ── 좌우 비교: bookCompare ──
  function bookCompareToMd(block) {
    var props = block.props || {};
    var title = (props.title || "").trim();
    var out = [];
    if (title) out.push("### " + title);
    out.push("**" + (props.leftTitle || "") + "**\n" + (props.leftBody || ""));
    out.push("**" + (props.rightTitle || "") + "**\n" + (props.rightBody || ""));
    return out.join("\n\n");
  }

  // ── 지문 + 주석: bookAnnotated ──
  function bookAnnotatedToMd(block) {
    var props = block.props || {};
    var title = (props.title || "").trim();
    var out = [];
    if (title) out.push("### " + title);
    if (props.passage) out.push(String(props.passage));
    var parsed = safeJsonArray(props.notes);
    if (!parsed.ok) {
      out.push(jsonWarningBlock("notes(주석)", parsed.raw, parsed.error));
    } else if (parsed.data.length) {
      var noteLines = ["**주석**"];
      parsed.data.forEach(function (n, i) {
        var isPlainObj = n && typeof n === "object" && !Array.isArray(n);
        if (isPlainObj && hasOwnAny(n, ["quote", "note"])) {
          var quote = n.quote != null ? String(n.quote) : "";
          var note = n.note != null ? String(n.note) : "";
          noteLines.push((i + 1) + ". \"" + quote + "\": " + note);
        } else {
          // quote/note 형태가 아닌 원시값·다른 구조의 데이터도 원본을 코드 스팬으로 보존해 유실 방지
          noteLines.push((i + 1) + ". " + codeSpan(JSON.stringify(n === undefined ? null : n)));
        }
      });
      out.push(noteLines.join("\n"));
    }
    return out.join("\n\n");
  }

  // ── 문제/보기: bookQuestion ──
  function bookQuestionToMd(block) {
    var props = block.props || {};
    var title = (props.title || "").trim();
    var out = [];
    if (title) out.push("### " + title);
    if (props.question) out.push("**Q. " + props.question + "**");
    var parsed = safeJsonArray(props.options);
    if (!parsed.ok) {
      out.push(jsonWarningBlock("options(보기)", parsed.raw, parsed.error));
    } else if (parsed.data.length) {
      var optLines = [];
      parsed.data.forEach(function (opt, i) {
        var isPlainObj = opt && typeof opt === "object" && !Array.isArray(opt);
        if (!isPlainObj || !hasOwnAny(opt, ["label", "text", "explanation", "correct"])) {
          // 예상한 보기 형태가 아닌 원시값 등도 원본을 코드 스팬으로 보존해 유실 방지
          optLines.push("- " + (i + 1) + ". " + codeSpan(JSON.stringify(opt === undefined ? null : opt)));
          return;
        }
        var mark = opt.correct === true ? "[정답]" : "[오답]"; // 엄격한 boolean true만 정답으로 인정('false' 문자열 등은 오답)
        var label = opt.label != null && opt.label !== "" ? String(opt.label) : String(i + 1);
        var text = opt.text != null ? String(opt.text) : "";
        var line = "- " + mark + " " + label + ". " + text;
        if (opt.explanation) {
          line += "\n  - 해설: " + String(opt.explanation).split("\n").join("\n    ");
        }
        optLines.push(line);
      });
      out.push(optLines.join("\n"));
    }
    return out.join("\n\n");
  }

  // ── 흐름도(분기): bookFlow ──
  function bookFlowToMd(block) {
    var props = block.props || {};
    var title = (props.title || "").trim();
    var out = [];
    if (title) out.push("### " + title);
    if (props.start) out.push("**시작:** " + props.start);
    if (props.decision) out.push("**분기:** " + props.decision);
    var branches = [];
    branches.push("- **" + (props.leftLabel || "") + "**: " + (props.leftBody || ""));
    branches.push("- **" + (props.rightLabel || "") + "**: " + (props.rightBody || ""));
    out.push(branches.join("\n"));
    return out.join("\n\n");
  }

  // ── 외부 미디어 링크: bookMedia(link/audio/video) ──
  function bookMediaToMd(block) {
    var props = block.props || {};
    var typeMap = { link: "링크", audio: "오디오", video: "영상" };
    var label = typeMap[props.mediaType] || "미디어";
    var title = (props.title || "").trim();
    var url = (props.url || "").trim();
    var desc = (props.description || "").trim();
    var titleText = title || url || "(제목 없음)";
    var linkPart;
    if (url && isSafeHttpUrl(url)) {
      linkPart = safeMdLink(titleText, url);
    } else if (url) {
      // http/https가 아니거나 검증에 실패한 URL은 실행 가능한 링크를 만들지 않는다.
      // 코드 스팬(안전한 구분자)으로만 노출해 원본 텍스트는 보존하되 실행은 막는다.
      linkPart = escapeLinkText(titleText) + " " + codeSpan(url) + " [유효하지 않은 URL: 링크 비활성화]";
    } else {
      linkPart = escapeLinkText(titleText);
    }
    var lines = ["**[" + label + "] " + linkPart + "**"];
    if (desc) lines.push(desc);
    return lines.join("\n");
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
      case "bookHeading":
        return bookHeadingToMd(block);
      case "bookCallout":
        return bookCalloutToMd(block);
      case "bookCompare":
        return bookCompareToMd(block);
      case "bookAnnotated":
        return bookAnnotatedToMd(block);
      case "bookQuestion":
        return bookQuestionToMd(block);
      case "bookFlow":
        return bookFlowToMd(block);
      case "bookMedia":
        return bookMediaToMd(block);
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
    // Exposed so callers/tests can check the source-marker allowlist without duplicating it.
    bookSourceMarkerGlyphs: BOOK_SOURCE_MARKER_GLYPHS.slice(),
    isBookSourceMarkerGlyph: isBookSourceMarkerGlyph,
  };
})();
