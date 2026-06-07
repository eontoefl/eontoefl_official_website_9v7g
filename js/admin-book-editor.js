// =====================================================================
// 입문서 편집기 (BlockNote) — 페이지 로직  [5·6단계]
//
// 5단계: 서버 저장/불러오기(tr_book_pages) + 버전 백업/되돌리기
// 6단계: 페이지 추가/삭제/순서
// 공통: 편집 중 localStorage 임시저장(크래시 복구) — "저장" 눌러야 서버 반영
//
// 데이터:
//   tr_book_documents (kind='pages', is_active=false 로 신규 생성 — 기존 PDF 뷰어와 분리)
//   tr_book_pages (id=불변앵커, sort_order, blocks, html)
//   tr_book_page_versions (저장마다 스냅샷)
// =====================================================================

const STORAGE_BUCKET = "guide-images"; // 기존 버킷 재사용, 'book/' prefix
const BOOK_TITLE_DEFAULT = "입문서 (편집본)";

const State = {
  books: [], // 모든 'pages' 종류 책
  book: null, // 현재 편집 중 책 (tr_book_documents row)
  pages: [], // tr_book_pages rows (sort_order asc)
  currentId: null, // 현재 편집 중 페이지 id
  editor: null, // BlockNote handle
  dirty: new Set(), // 임시저장(미발행) 변경 있는 페이지 id
  autosaveTimer: null,
  suppress: false, // 내용을 프로그램적으로 불러넣는 중(=사람 입력 아님) 표시
};

// 내용을 에디터에 "조용히" 불러넣기 — 변경 감지가 이걸 수정으로 오해하지 않게
function setEditorBlocksQuiet(blocks) {
  if (!State.editor) return;
  State.suppress = true;
  State.editor.setBlocks(blocks);
  setTimeout(() => { State.suppress = false; }, 60);
}

// ---------------------------------------------------------------------
// 진입
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  if (!checkAuth()) return;
  if (!window.BookEditor || typeof window.BookEditor.mount !== "function") {
    setStatus("error", "에디터 로드 실패 — 새로고침 해주세요");
    return;
  }

  try {
    await loadBooks();
    await loadPages();
  } catch (e) {
    console.error(e);
    setStatus("error", "DB 연결 실패 — SQL 적용됐는지 확인");
    alert("데이터를 불러오지 못했어요.\n\nSupabase에 입문서 에디터용 SQL이 적용됐는지 확인해주세요.\n\n" + e.message);
    return;
  }

  renderBookUI();
  renderPageList();
  mountEditor();
});

function checkAuth() {
  const params = new URLSearchParams(location.search);
  if (params.get("dev") === "1") return true;
  const u = JSON.parse(localStorage.getItem("iontoefl_user") || "null");
  if (!u || u.role !== "admin") {
    alert("⚠️ 관리자만 접근할 수 있습니다.");
    location.href = "index.html";
    return false;
  }
  return true;
}

function currentUserEmail() {
  const u = JSON.parse(localStorage.getItem("iontoefl_user") || "null");
  return u && u.email ? u.email : "dev";
}

// ---------------------------------------------------------------------
// 책 + 페이지 로드 (없으면 생성)
// ---------------------------------------------------------------------
const CURRENT_BOOK_KEY = "bookedit_current_book";

// 'pages' 책들 로드 + 현재 책 결정 (?book=<id> 우선 → 마지막 책 → 첫 책)
async function loadBooks() {
  let books = await supabaseAPI.query("tr_book_documents", { kind: "eq.pages", order: "sort_order.asc" });
  if (!books || books.length === 0) {
    const b = await supabaseAPI.post("tr_book_documents", { title: BOOK_TITLE_DEFAULT, kind: "pages", is_active: false, total_pages: 0, sort_order: 100 });
    books = [b];
  }
  State.books = books;
  const wantId = new URLSearchParams(location.search).get("book");
  let saved = null;
  try { saved = localStorage.getItem(CURRENT_BOOK_KEY); } catch (_) {}
  State.book = books.find((b) => b.id === wantId) || books.find((b) => b.id === saved) || books[0];
  try { localStorage.setItem(CURRENT_BOOK_KEY, State.book.id); } catch (_) {}
}

// 현재 책의 페이지 로드 (없으면 1페이지 생성)
async function loadPages() {
  let pages = await supabaseAPI.query("tr_book_pages", { book_id: "eq." + State.book.id, order: "sort_order.asc" });
  if (!pages || pages.length === 0) {
    const p1 = await supabaseAPI.post("tr_book_pages", { book_id: State.book.id, sort_order: 1, blocks: [], html: "" });
    pages = [p1];
  }
  State.pages = pages;          // ★ 총페이지 갱신 전에 먼저 채움 (0페이지 버그 수정)
  State.currentId = pages[0].id;
  await syncTotalPages();       // 항상 실제 개수로 맞춤 (기존에 어긋난 값도 self-heal)
}

function renderBookUI() {
  document.getElementById("editorTitle").textContent = State.book.title || "입문서";
}

// ---------------------------------------------------------------------
// 에디터 마운트
// ---------------------------------------------------------------------
function mountEditor() {
  const initial = blocksForPage(State.currentId);

  State.editor = window.BookEditor.mount("#bookEditor", {
    initialBlocks: initial && initial.length ? initial : undefined,
    uploadFile: uploadFile, // base64 금지 → Storage
    onReady: () => {
      const loading = document.getElementById("editorLoading");
      if (loading) loading.style.display = "none";
      setStatus("saved", hasDraft(State.currentId) ? "임시저장본 복구됨" : "준비됨");
    },
    onChange: onEditorChange,
  });
}

// 현재 페이지에 보여줄 blocks (임시저장본 우선, 없으면 서버본)
function blocksForPage(pageId) {
  const draft = loadDraft(pageId);
  if (draft) return draft;
  const p = State.pages.find((x) => x.id === pageId);
  return p && Array.isArray(p.blocks) ? p.blocks : [];
}

// ---------------------------------------------------------------------
// 편집 변경 → 임시저장(브라우저) + dirty 표시
// ---------------------------------------------------------------------
function onEditorChange() {
  if (!State.editor || !State.currentId) return;
  if (State.suppress) return; // 프로그램이 내용 불러넣는 중 → 사람 수정 아님, 무시
  State.dirty.add(State.currentId);
  setStatus("editing", "편집 중…");
  markPageDirty(State.currentId, true);

  clearTimeout(State.autosaveTimer);
  State.autosaveTimer = setTimeout(() => {
    saveDraft(State.currentId, State.editor.getBlocks());
    setStatus("saved", "임시 저장됨 (브라우저)");
  }, 800);
}

// ---------------------------------------------------------------------
// 페이지 전환
// ---------------------------------------------------------------------
function switchPage(pageId) {
  if (pageId === State.currentId) return;
  // 떠나는 페이지가 "미저장 상태"일 때만 임시저장 보존 (안 고친 페이지엔 헛 드래프트 안 만듦)
  if (State.editor && State.dirty.has(State.currentId)) {
    saveDraft(State.currentId, State.editor.getBlocks());
  }

  State.currentId = pageId;
  setEditorBlocksQuiet(blocksForPage(pageId));
  renderPageList();
  setStatus("saved", hasDraft(pageId) ? "임시저장본 (미발행)" : "불러옴");
}

// ---------------------------------------------------------------------
// 저장(발행) — 서버 tr_book_pages 에 반영 + 버전 백업
// ---------------------------------------------------------------------
// 저장 = "수정한 모든 페이지"를 한 번에 서버에 발행 (현재 페이지만 X)
async function savePage() {
  if (!State.editor || !State.currentId) return;
  const btn = document.getElementById("btnSave");
  btn.disabled = true;
  setStatus("editing", "저장 중…");

  try {
    // 현재 페이지의 최신 내용을 임시저장에 반영(다른 페이지들은 이미 전환 시 저장됨)
    saveDraft(State.currentId, State.editor.getBlocks());

    // 발행 대상 = 수정된(dirty) 모든 페이지. 없으면 현재 페이지만.
    const targets = State.dirty.size ? Array.from(State.dirty) : [State.currentId];

    for (const pageId of targets) {
      const blocks = pageId === State.currentId ? State.editor.getBlocks() : loadDraft(pageId);
      if (!blocks) continue;
      const html = await State.editor.htmlOf(blocks);

      await supabaseAPI.patch("tr_book_pages", pageId, {
        blocks: blocks,
        html: html,
        updated_at: new Date().toISOString(),
      });
      await supabaseAPI.post("tr_book_page_versions", {
        page_id: pageId,
        book_id: State.book.id,
        blocks: blocks,
        html: html,
        created_by: currentUserEmail(),
      });

      const p = State.pages.find((x) => x.id === pageId);
      if (p) { p.blocks = blocks; p.html = html; }
      clearDraft(pageId);
      markPageDirty(pageId, false);
    }
    State.dirty.clear();

    // 책 수정시각도 갱신 (관리 목록의 '수정일'이 안 바뀌던 문제)
    try {
      const now = new Date().toISOString();
      await supabaseAPI.patch("tr_book_documents", State.book.id, { updated_at: now });
      State.book.updated_at = now;
    } catch (_) {}

    setStatus("saved", targets.length > 1 ? targets.length + "개 페이지 저장됨" : "저장됨 (서버 반영)");
  } catch (e) {
    console.error(e);
    setStatus("error", "저장 실패");
    alert("저장 중 오류: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// 페이지 추가 / 삭제 / 순서  [6단계]
// ---------------------------------------------------------------------
async function addPage() {
  const maxOrder = State.pages.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
  const np = await supabaseAPI.post("tr_book_pages", {
    book_id: State.book.id,
    sort_order: maxOrder + 1,
    blocks: [],
    html: "",
  });
  State.pages.push(np);
  await syncTotalPages();
  switchPage(np.id);
}

async function deletePage(pageId) {
  if (State.pages.length <= 1) {
    alert("최소 1페이지는 있어야 해요.");
    return;
  }
  if (!confirm("이 페이지를 삭제할까요? (되돌릴 수 없어요)")) return;

  try {
    await supabaseAPI.hardDelete("tr_book_pages", pageId);
    clearDraft(pageId);
    const idx = State.pages.findIndex((p) => p.id === pageId);
    State.pages = State.pages.filter((p) => p.id !== pageId);
    await syncTotalPages();

    // 삭제한 게 현재 페이지면 이웃으로 이동
    if (State.currentId === pageId) {
      const next = State.pages[Math.min(idx, State.pages.length - 1)];
      State.currentId = next.id;
      setEditorBlocksQuiet(blocksForPage(next.id));
    }
    renderPageList();
    setStatus("saved", "페이지 삭제됨");
  } catch (e) {
    console.error(e);
    alert("삭제 실패: " + e.message);
  }
}

async function movePage(pageId, dir) {
  const idx = State.pages.findIndex((p) => p.id === pageId);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= State.pages.length) return;

  const a = State.pages[idx];
  const b = State.pages[swapIdx];
  const ao = a.sort_order, bo = b.sort_order;

  try {
    await supabaseAPI.patch("tr_book_pages", a.id, { sort_order: bo });
    await supabaseAPI.patch("tr_book_pages", b.id, { sort_order: ao });
    a.sort_order = bo; b.sort_order = ao;
    State.pages.sort((x, y) => x.sort_order - y.sort_order);
    renderPageList();
  } catch (e) {
    console.error(e);
    alert("순서 변경 실패: " + e.message);
  }
}

async function syncTotalPages() {
  try {
    await supabaseAPI.patch("tr_book_documents", State.book.id, {
      total_pages: State.pages.length,
    });
    State.book.total_pages = State.pages.length;
  } catch (e) { /* 표시용이라 실패해도 치명적이지 않음 */ }
}

// ---------------------------------------------------------------------
// 사이드바 렌더
// ---------------------------------------------------------------------
function renderPageList() {
  const list = document.getElementById("pageList");
  list.innerHTML = "";

  State.pages.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = "bookedit-page-item" + (p.id === State.currentId ? " active" : "");
    item.dataset.id = p.id;

    item.innerHTML =
      '<span class="bookedit-page-num">' + (i + 1) + "</span>" +
      '<span class="bookedit-page-label">페이지 ' + (i + 1) + "</span>" +
      '<span class="bookedit-dirty-dot' + (State.dirty.has(p.id) ? " on" : "") + '" title="저장 안 한 변경"></span>' +
      '<span class="bookedit-page-actions">' +
        '<button class="bookedit-mini" title="위로" data-act="up"><i class="fas fa-chevron-up"></i></button>' +
        '<button class="bookedit-mini" title="아래로" data-act="down"><i class="fas fa-chevron-down"></i></button>' +
        '<button class="bookedit-mini is-danger" title="삭제" data-act="del"><i class="fas fa-trash-can"></i></button>' +
      "</span>";

    // 클릭 → 전환 (액션 버튼 클릭은 제외)
    item.addEventListener("click", (e) => {
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        e.stopPropagation();
        const act = actBtn.dataset.act;
        if (act === "up") movePage(p.id, -1);
        else if (act === "down") movePage(p.id, +1);
        else if (act === "del") deletePage(p.id);
        return;
      }
      switchPage(p.id);
    });

    list.appendChild(item);
  });
}

function markPageDirty(pageId, on) {
  const item = document.querySelector('.bookedit-page-item[data-id="' + pageId + '"] .bookedit-dirty-dot');
  if (item) item.classList.toggle("on", !!on);
}

// ---------------------------------------------------------------------
// 버전 되돌리기  [5단계]
// ---------------------------------------------------------------------
async function showVersions() {
  const modal = document.getElementById("versionModal");
  const listEl = document.getElementById("versionList");
  modal.classList.add("open");
  listEl.innerHTML = '<div class="bookedit-empty">불러오는 중…</div>';

  try {
    const rows = await supabaseAPI.query("tr_book_page_versions", {
      page_id: "eq." + State.currentId,
      order: "created_at.desc",
      limit: "30",
    });

    if (!rows || rows.length === 0) {
      listEl.innerHTML = '<div class="bookedit-empty">저장된 버전이 없어요.<br>한 번 저장하면 여기 쌓여요.</div>';
      return;
    }

    listEl.innerHTML = "";
    rows.forEach((v) => {
      const when = new Date(v.created_at).toLocaleString("ko-KR");
      const row = document.createElement("div");
      row.className = "bookedit-version-item";
      row.innerHTML =
        '<div><div class="bookedit-version-when">' + when + "</div>" +
        '<div class="bookedit-version-who">' + (v.created_by || "-") + "</div></div>" +
        '<button class="btn-secondary">이 버전으로</button>';
      row.querySelector("button").addEventListener("click", () => restoreVersion(v));
      listEl.appendChild(row);
    });
  } catch (e) {
    listEl.innerHTML = '<div class="bookedit-empty">버전을 불러오지 못했어요.</div>';
  }
}

function restoreVersion(v) {
  if (!confirm("이 버전으로 되돌릴까요?\n(지금 편집 중인 내용은 사라져요. 저장해야 서버에 반영돼요.)")) return;
  // 조용히 불러넣고(자동 점 켜짐 방지), 되돌리기는 "수정"이 맞으니 점은 직접 켜준다
  setEditorBlocksQuiet(Array.isArray(v.blocks) ? v.blocks : []);
  closeVersions();
  State.dirty.add(State.currentId);
  markPageDirty(State.currentId, true);
  setStatus("editing", "되돌림 — 저장해야 반영");
}

function closeVersions() {
  document.getElementById("versionModal").classList.remove("open");
}

// ---------------------------------------------------------------------
// 이미지/파일 업로드 → Supabase Storage (base64 금지)
// ---------------------------------------------------------------------
async function uploadFile(file) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const path = "book/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
  const endpoint = SUPABASE_URL + "/storage/v1/object/" + STORAGE_BUCKET + "/" + path;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
    },
    body: file,
  });
  if (!resp.ok) {
    let msg = "업로드 실패 (" + resp.status + ")";
    try { const e = await resp.json(); msg = e.message || e.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return SUPABASE_URL + "/storage/v1/object/public/" + STORAGE_BUCKET + "/" + path;
}

// ---------------------------------------------------------------------
// 임시저장(localStorage) — 페이지별
// ---------------------------------------------------------------------
function draftKey(pageId) {
  return "bookedit_draft_" + (State.book ? State.book.id : "x") + "_" + pageId;
}
function saveDraft(pageId, blocks) {
  try { localStorage.setItem(draftKey(pageId), JSON.stringify(blocks || [])); } catch (_) {}
}
function loadDraft(pageId) {
  try {
    const raw = localStorage.getItem(draftKey(pageId));
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch (_) { return null; }
}
function clearDraft(pageId) {
  try { localStorage.removeItem(draftKey(pageId)); } catch (_) {}
}
function hasDraft(pageId) {
  return !!loadDraft(pageId);
}

// ---------------------------------------------------------------------
// 상태 표시
// ---------------------------------------------------------------------
function setStatus(type, text) {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  let icon = "";
  if (type === "saved") icon = '<span class="bookedit-glint"></span> ';
  else if (type === "editing") icon = '<i class="fas fa-pen" style="font-size:11px;"></i> ';
  else if (type === "error") icon = '<i class="fas fa-triangle-exclamation" style="color:var(--error);"></i> ';
  el.innerHTML = icon + text;
}

function goBack() {
  location.href = "admin-book-list.html";
}
