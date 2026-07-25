// =====================================================================
// 입문서 편집기 (BlockNote) — 페이지 로직
//
// 화면 구조: 왼쪽 목록 없이, 페이지(용지)들이 세로로 이어져 스크롤된다.
//   - 용지 옆에 떠 있는 툴바로 페이지 조작 (이동/복제/추가/삭제)
//   - 편집기는 화면에 가까워질 때만 켠다(지연 마운트) → 페이지 많아도 가벼움
//   - 편집 중 localStorage 임시저장(크래시 복구). "저장" 눌러야 서버 반영
//
// 데이터:
//   tr_book_documents (kind='pages')
//   tr_book_pages (id=불변앵커, sort_order, blocks, html)
//   tr_book_page_versions (저장마다 스냅샷)
// =====================================================================

const STORAGE_BUCKET = "guide-images"; // 기존 버킷 재사용, 'book/' prefix
const BOOK_TITLE_DEFAULT = "입문서 (편집본)";
const MOUNT_MARGIN = "1000px"; // 화면에서 이만큼 떨어져 있을 때 미리 편집기 켜기

const State = {
  books: [],              // 모든 'pages' 종류 책
  book: null,             // 현재 편집 중 책
  pages: [],              // tr_book_pages rows (표시 순서)
  currentId: null,        // 지금 보고 있는 페이지 id
  editors: new Map(),     // pageId -> BlockNote handle (마운트된 것만)
  nodes: new Map(),       // pageId -> 페이지 DOM 요소 (재정렬 시 재사용)
  dirty: new Set(),       // 저장 안 한 변경이 있는 페이지 id
  timers: new Map(),      // pageId -> 임시저장 타이머
  suppress: new Set(),    // 프로그램이 내용 넣는 중인 페이지 (사람 입력 아님)
  io: null,               // 지연 마운트 감시자
  rafPending: false,
  scrollLock: false,      // 프로그램이 스크롤 중 (현재 페이지 자동추적 잠시 멈춤)
};

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
  setupLazyMount();
  renderStack();
  bindSlideBar();
  bindScrollTracking();
  setupPageHotkeys();

  // 첫 페이지는 바로 켜 둔다
  if (State.pages.length) ensureMounted(State.pages[0].id);
  const loading = document.getElementById("editorLoading");
  if (loading) loading.style.display = "none";
  document.getElementById("slideBar").hidden = false;
  setCurrent(State.pages.length ? State.pages[0].id : null);
  setStatus("saved", "준비됨");
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

async function loadPages() {
  let pages = await supabaseAPI.query("tr_book_pages", { book_id: "eq." + State.book.id, order: "sort_order.asc" });
  if (!pages || pages.length === 0) {
    const p1 = await supabaseAPI.post("tr_book_pages", { book_id: State.book.id, sort_order: 1, blocks: [], html: "" });
    pages = [p1];
  }
  State.pages = pages;
  State.currentId = pages[0].id;
  await syncTotalPages();
}

function renderBookUI() {
  document.getElementById("editorTitle").textContent = State.book.title || "입문서";
}

// ---------------------------------------------------------------------
// 페이지 스택 렌더 (DOM 재사용 — 이미 켜진 편집기를 부수지 않는다)
// ---------------------------------------------------------------------
function renderStack() {
  const stack = document.getElementById("pageStack");

  // 사라진 페이지 정리
  Array.from(State.nodes.keys()).forEach((id) => {
    if (!State.pages.some((p) => p.id === id)) {
      const h = State.editors.get(id);
      if (h && typeof h.unmount === "function") { try { h.unmount(); } catch (_) {} }
      State.editors.delete(id);
      const el = State.nodes.get(id);
      if (el) el.remove();
      State.nodes.delete(id);
    }
  });

  // 기존 삽입선 제거 (페이지 요소는 유지)
  stack.querySelectorAll(".bookedit-insert-zone").forEach((z) => z.remove());

  // 원하는 최종 순서 만들기
  const desired = [];
  State.pages.forEach((p, i) => {
    desired.push(makeInsertZone(i));
    let el = State.nodes.get(p.id);
    if (!el) {
      el = createPageSection(p);
      State.nodes.set(p.id, el);
      if (State.io) State.io.observe(el);
    }
    desired.push(el);
  });
  desired.push(makeInsertZone(State.pages.length));

  // 자리가 이미 맞는 노드는 건드리지 않는다 (켜져 있는 편집기 보호)
  desired.forEach((node, i) => {
    const cur = stack.childNodes[i];
    if (cur !== node) stack.insertBefore(node, cur || null);
  });
  while (stack.childNodes.length > desired.length) stack.removeChild(stack.lastChild);

  updateSlideBar();
}

function createPageSection(p) {
  const sec = document.createElement("section");
  sec.className = "bookedit-page";
  sec.dataset.id = p.id;
  sec.innerHTML =
    '<div class="bookedit-paper">' +
      '<div class="bookedit-preview"></div>' +
      '<div class="bookedit-mount"></div>' +
    "</div>";

  // 편집기 켜지기 전엔 저장된 내용을 그대로 보여준다(높이/모양 유지)
  const prev = sec.querySelector(".bookedit-preview");
  prev.innerHTML = p.html || "";

  sec.addEventListener("mousedown", () => setCurrent(p.id));
  return sec;
}


// 페이지 사이 "여기에 추가" 삽입선
function makeInsertZone(index) {
  const z = document.createElement("div");
  z.className = "bookedit-insert-zone";
  z.title = "여기에 페이지 추가";
  z.innerHTML =
    '<span class="bookedit-insert-line"></span>' +
    '<span class="bookedit-insert-plus"><i class="fas fa-plus"></i></span>';
  z.addEventListener("click", () => insertPageAt(index));
  return z;
}

// ---------------------------------------------------------------------
// 지연 마운트 — 화면에 가까워지면 그 페이지 편집기를 켠다
// ---------------------------------------------------------------------
function setupLazyMount() {
  if (!("IntersectionObserver" in window)) return; // 미지원이면 아래 fallback로 전부 마운트
  State.io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) ensureMounted(en.target.dataset.id);
    });
  }, { root: document.getElementById("canvas"), rootMargin: MOUNT_MARGIN });
}

function ensureMounted(pageId) {
  if (!pageId) return null;
  if (State.editors.has(pageId)) return State.editors.get(pageId);

  const sec = State.nodes.get(pageId);
  if (!sec) return null;
  const host = sec.querySelector(".bookedit-mount");
  if (!host) return null;

  const initial = blocksForPage(pageId);
  const handle = window.BookEditor.mount(host, {
    initialBlocks: initial && initial.length ? initial : undefined,
    uploadFile: uploadFile, // base64 금지 → Storage
    onReady: () => { sec.classList.add("is-mounted"); },
    onChange: () => onEditorChange(pageId),
  });
  State.editors.set(pageId, handle);
  return handle;
}

// 아무 편집기 핸들 (blocks → html 변환용)
function anyHandle() {
  for (const h of State.editors.values()) return h;
  return null;
}

// 페이지에 보여줄 blocks (임시저장본 우선, 없으면 서버본)
function blocksForPage(pageId) {
  const draft = loadDraft(pageId);
  if (draft) return draft;
  const p = State.pages.find((x) => x.id === pageId);
  return p && Array.isArray(p.blocks) ? p.blocks : [];
}

// 지금 시점의 내용 (켜져 있으면 편집기에서, 아니면 저장본에서)
function currentBlocksFor(pageId) {
  const h = State.editors.get(pageId);
  if (h) return h.getBlocks();
  return blocksForPage(pageId);
}

function setBlocksQuiet(pageId, blocks) {
  const h = ensureMounted(pageId);
  if (!h) return;
  State.suppress.add(pageId);
  h.setBlocks(blocks);
  setTimeout(() => State.suppress.delete(pageId), 60);
}

// ---------------------------------------------------------------------
// 편집 변경 → 임시저장(브라우저) + 표시
// ---------------------------------------------------------------------
function onEditorChange(pageId) {
  if (State.suppress.has(pageId)) return;
  State.dirty.add(pageId);
  setCurrent(pageId);
  setStatus("editing", "편집 중…");
  markPageDirty(pageId, true);

  clearTimeout(State.timers.get(pageId));
  State.timers.set(pageId, setTimeout(() => {
    const h = State.editors.get(pageId);
    if (h) saveDraft(pageId, h.getBlocks());
    setStatus("saved", "임시 저장됨 (브라우저)");
  }, 800));
}

// 저장 안 한 표시는 페이지 목록 팝오버에 (열려 있을 때만 갱신)
function markPageDirty(pageId, on) {
  const pop = document.getElementById("pagePop");
  if (!pop || pop.hidden) return;
  const dot = pop.querySelector('.bookedit-pop-item[data-id="' + pageId + '"] .bookedit-dirty-dot');
  if (dot) dot.classList.toggle("on", !!on);
}

// ---------------------------------------------------------------------
// 현재 페이지 추적 (스크롤 위치 기준)
// ---------------------------------------------------------------------
function bindScrollTracking() {
  const canvas = document.getElementById("canvas");
  canvas.addEventListener("scroll", () => {
    if (State.rafPending) return;
    State.rafPending = true;
    requestAnimationFrame(() => {
      State.rafPending = false;
      updateCurrentByScroll();
    });
  }, { passive: true });
}

function updateCurrentByScroll() {
  if (State.scrollLock) return; // 페이지 옮기는 중엔 번호가 튀지 않게
  const canvas = document.getElementById("canvas");
  const box = canvas.getBoundingClientRect();
  const mid = box.top + box.height / 2;

  let hit = null, nearest = null, nearestDist = Infinity;
  State.pages.forEach((p) => {
    const el = State.nodes.get(p.id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top <= mid && r.bottom >= mid) hit = p.id;
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < nearestDist) { nearestDist = d; nearest = p.id; }
  });

  const id = hit || nearest;
  if (id && id !== State.currentId) setCurrent(id);
}

function setCurrent(pageId) {
  if (!pageId || pageId === State.currentId) { updateSlideBar(); return; }
  State.currentId = pageId;
  State.nodes.forEach((el, id) => el.classList.toggle("is-current", id === pageId));
  updateSlideBar();
}

function goToPage(pageId) {
  if (!pageId) return;
  setCurrent(pageId);
  ensureMounted(pageId);
  const el = State.nodes.get(pageId);
  if (!el) return;
  State.scrollLock = true;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  setTimeout(() => { State.scrollLock = false; }, 600);
}

// Alt + ←/→ (또는 ↑/↓) 로 이전/다음 페이지
function setupPageHotkeys() {
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    if (!back && !fwd) return;
    const idx = State.pages.findIndex((p) => p.id === State.currentId);
    const next = State.pages[idx + (fwd ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    goToPage(next.id);
  });
}

// ---------------------------------------------------------------------
// 용지 옆 툴바
// ---------------------------------------------------------------------
function bindSlideBar() {
  document.getElementById("sbPrev").addEventListener("click", () => movePage(-1));
  document.getElementById("sbNext").addEventListener("click", () => movePage(1));
  document.getElementById("sbDup").addEventListener("click", duplicatePage);
  document.getElementById("sbAdd").addEventListener("click", addPage);
  document.getElementById("sbDel").addEventListener("click", () => deletePage(State.currentId));
  document.getElementById("sbNum").addEventListener("click", togglePagePop);

  document.addEventListener("click", (e) => {
    const pop = document.getElementById("pagePop");
    if (pop.hidden) return;
    if (e.target.closest("#pagePop") || e.target.closest("#sbNum")) return;
    pop.hidden = true;
  });
}

// 현재 페이지를 앞/뒤로 한 칸 옮기기 (순서 변경)
async function movePage(dir) {
  const idx = State.pages.findIndex((p) => p.id === State.currentId);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= State.pages.length) return;

  const [moved] = State.pages.splice(idx, 1);
  State.pages.splice(to, 0, moved);

  renderStack();
  const pop = document.getElementById("pagePop");
  if (pop && !pop.hidden) renderPagePop();

  // 옮긴 페이지를 계속 보고 있게
  State.scrollLock = true;
  const el = State.nodes.get(moved.id);
  if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  setTimeout(() => { State.scrollLock = false; }, 600);

  await persistOrder();
}

function updateSlideBar() {
  const idx = State.pages.findIndex((p) => p.id === State.currentId);
  const num = document.getElementById("sbNum");
  if (num) num.textContent = idx >= 0 ? idx + 1 : 1;
  const prev = document.getElementById("sbPrev");
  const next = document.getElementById("sbNext");
  if (prev) prev.disabled = idx <= 0;
  if (next) next.disabled = idx < 0 || idx >= State.pages.length - 1;
}

// ---------------------------------------------------------------------
// 페이지 목록 팝오버 (이동 + 드래그 순서변경)
// ---------------------------------------------------------------------
function togglePagePop() {
  const pop = document.getElementById("pagePop");
  if (!pop.hidden) { pop.hidden = true; return; }
  renderPagePop();
  pop.hidden = false;
  positionPagePop();
  const act = pop.querySelector(".bookedit-pop-item.active");
  if (act) act.scrollIntoView({ block: "nearest" });
}

// 툴바 왼쪽에 띄우고, 자리 없으면 오른쪽 / 화면 밖으로 안 나가게
function positionPagePop() {
  const pop = document.getElementById("pagePop");
  const anchor = document.getElementById("sbNum");
  if (!pop || !anchor) return;
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 232;
  const h = pop.offsetHeight || 300;

  let left = a.left - w - 12;
  if (left < 12) left = Math.min(a.right + 12, window.innerWidth - w - 12);
  let top = a.top + a.height / 2 - h / 2;
  top = Math.max(76, Math.min(top, window.innerHeight - h - 12));

  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

function renderPagePop() {
  const list = document.getElementById("pagePopList");
  list.innerHTML = "";
  State.pages.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "bookedit-pop-item" + (p.id === State.currentId ? " active" : "");
    row.dataset.id = p.id;
    row.innerHTML =
      '<span class="bookedit-page-handle" title="드래그해서 순서 변경"><i class="fas fa-grip-vertical"></i></span>' +
      '<span class="bookedit-pop-num">' + (i + 1) + "</span>" +
      '<span class="bookedit-pop-label">페이지 ' + (i + 1) + "</span>" +
      '<span class="bookedit-dirty-dot' + (State.dirty.has(p.id) ? " on" : "") + '"></span>';

    row.addEventListener("click", (e) => {
      if (e.target.closest(".bookedit-page-handle")) return;
      goToPage(p.id);
      document.getElementById("pagePop").hidden = true;
    });

    const handle = row.querySelector(".bookedit-page-handle");
    handle.addEventListener("mousedown", () => { row.draggable = true; });
    handle.addEventListener("mouseup", () => { row.draggable = false; });
    row.addEventListener("dragstart", (e) => {
      DnD.fromId = p.id;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", p.id); } catch (_) {}
    });
    row.addEventListener("dragend", () => {
      row.draggable = false;
      row.classList.remove("dragging");
      clearDropMarkers();
    });
    row.addEventListener("dragover", (e) => {
      if (!DnD.fromId || DnD.fromId === p.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      showDropMarker(row, isBefore(row, e.clientY));
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      onDropReorder(DnD.fromId, p.id, isBefore(row, e.clientY));
    });

    list.appendChild(row);
  });
}

// ── 드래그 정렬 헬퍼 ──
const DnD = { fromId: null };

function isBefore(item, y) {
  const r = item.getBoundingClientRect();
  return y < r.top + r.height / 2;
}
function clearDropMarkers() {
  document.querySelectorAll(".bookedit-pop-item.drop-before, .bookedit-pop-item.drop-after")
    .forEach((el) => el.classList.remove("drop-before", "drop-after"));
}
function showDropMarker(item, before) {
  clearDropMarkers();
  item.classList.add(before ? "drop-before" : "drop-after");
}

async function onDropReorder(fromId, toId, before) {
  clearDropMarkers();
  DnD.fromId = null;
  if (!fromId || fromId === toId) return;

  const from = State.pages.findIndex((p) => p.id === fromId);
  if (from < 0) return;
  const [moved] = State.pages.splice(from, 1);
  const to = State.pages.findIndex((p) => p.id === toId);
  if (to < 0) { State.pages.splice(from, 0, moved); return; }
  State.pages.splice(before ? to : to + 1, 0, moved);

  renderStack();
  renderPagePop();
  await persistOrder();
}

// ---------------------------------------------------------------------
// 저장(발행) — 서버 tr_book_pages 에 반영 + 버전 백업
// ---------------------------------------------------------------------
async function savePage() {
  const btn = document.getElementById("btnSave");
  btn.disabled = true;
  setStatus("editing", "저장 중…");

  try {
    // 켜져 있는 편집기의 최신 내용을 임시저장에 반영
    State.dirty.forEach((id) => {
      const h = State.editors.get(id);
      if (h) saveDraft(id, h.getBlocks());
    });

    const targets = State.dirty.size ? Array.from(State.dirty) : (State.currentId ? [State.currentId] : []);
    if (!targets.length) { setStatus("saved", "변경 없음"); return; }

    let conv = anyHandle() || ensureMounted(targets[0]);
    if (!conv) throw new Error("편집기가 아직 준비되지 않았어요. 잠시 후 다시 눌러주세요.");

    for (const pageId of targets) {
      const blocks = currentBlocksFor(pageId);
      if (!blocks) continue;
      const html = await conv.htmlOf(blocks);

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

    // 책 수정시각도 갱신
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
// 페이지 추가 / 복제 / 삭제 / 순서
// ---------------------------------------------------------------------
// 현재 페이지 "다음"에 추가
async function addPage() {
  const curIdx = State.pages.findIndex((p) => p.id === State.currentId);
  await insertPageAt(curIdx >= 0 ? curIdx + 1 : State.pages.length);
}

async function insertPageAt(index, seed) {
  try {
    const np = await supabaseAPI.post("tr_book_pages", {
      book_id: State.book.id,
      sort_order: 0,
      blocks: (seed && seed.blocks) || [],
      html: (seed && seed.html) || "",
    });
    const at = Math.max(0, Math.min(index, State.pages.length));
    State.pages.splice(at, 0, np);
    renderStack();
    ensureMounted(np.id);
    goToPage(np.id);
    await syncTotalPages();
    await persistOrder();
  } catch (e) {
    console.error(e);
    alert("페이지 추가 실패: " + e.message);
  }
}

// 현재 페이지 복제 → 바로 아래에
async function duplicatePage() {
  const id = State.currentId;
  const idx = State.pages.findIndex((p) => p.id === id);
  if (idx < 0) return;
  try {
    const blocks = currentBlocksFor(id);
    const h = anyHandle();
    const html = h ? await h.htmlOf(blocks) : (State.pages[idx].html || "");
    await insertPageAt(idx + 1, { blocks, html });
    setStatus("saved", "페이지 복제됨");
  } catch (e) {
    console.error(e);
    alert("복제 실패: " + e.message);
  }
}

async function deletePage(pageId) {
  if (!pageId) return;
  if (State.pages.length <= 1) {
    alert("최소 1페이지는 있어야 해요.");
    return;
  }
  if (!confirm("이 페이지를 삭제할까요? (되돌릴 수 없어요)")) return;

  try {
    await supabaseAPI.hardDelete("tr_book_pages", pageId);
    clearDraft(pageId);
    State.dirty.delete(pageId);
    const idx = State.pages.findIndex((p) => p.id === pageId);
    State.pages = State.pages.filter((p) => p.id !== pageId);

    renderStack();
    const next = State.pages[Math.min(idx, State.pages.length - 1)];
    if (next) setCurrent(next.id);

    await syncTotalPages();
    await persistOrder();
    setStatus("saved", "페이지 삭제됨");
  } catch (e) {
    console.error(e);
    alert("삭제 실패: " + e.message);
  }
}

// 현재 배열 순서대로 sort_order 를 1..N 로 다시 매기고, 바뀐 것만 저장
async function persistOrder() {
  const changed = [];
  State.pages.forEach((p, i) => {
    const so = i + 1;
    if (p.sort_order !== so) { p.sort_order = so; changed.push(p); }
  });
  try {
    for (const p of changed) {
      await supabaseAPI.patch("tr_book_pages", p.id, { sort_order: p.sort_order });
    }
    if (changed.length) setStatus("saved", "순서 변경됨");
  } catch (e) {
    console.error(e);
    alert("순서 저장 실패: " + e.message);
  }
}

async function syncTotalPages() {
  try {
    await supabaseAPI.patch("tr_book_documents", State.book.id, { total_pages: State.pages.length });
    State.book.total_pages = State.pages.length;
  } catch (e) { /* 표시용이라 실패해도 치명적이지 않음 */ }
}

// ---------------------------------------------------------------------
// 버전 되돌리기
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
  const id = State.currentId;
  setBlocksQuiet(id, Array.isArray(v.blocks) ? v.blocks : []);
  closeVersions();
  State.dirty.add(id);
  markPageDirty(id, true);
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
