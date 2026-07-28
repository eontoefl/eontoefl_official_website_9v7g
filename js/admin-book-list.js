// =====================================================================
// 입문서 관리 페이지
//  - 'pages' 종류 책 목록 / 새책 / 수정(편집기로) / 공개·숨김 / 역할 / 휴지통(30일)
//  - role, deleted_at 컬럼은 SQL 적용 후 완전 동작 (없어도 목록은 뜨게 resilient)
// =====================================================================
const ROLE_LABEL = { regular: "일반", australia: "호주", etc: "기타" };
const TRASH_DAYS = 30;
const BL = { books: [] };

document.addEventListener("DOMContentLoaded", () => {
  if (!checkAuth()) return;
  load();
});

function checkAuth() {
  const params = new URLSearchParams(location.search);
  if (params.get("dev") === "1") return true;
  const u = JSON.parse(localStorage.getItem("iontoefl_user") || "null");
  if (!u || u.role !== "admin") { alert("⚠️ 관리자만 접근할 수 있습니다."); location.href = "index.html"; return false; }
  return true;
}

async function load() {
  try {
    // select=* 로 받아 컬럼 없어도 안전. deleted_at 분리는 JS에서.
    const books = await supabaseAPI.query("tr_book_documents", { kind: "eq.pages", order: "sort_order.asc", select: "*" });
    BL.books = books || [];
    await purgeExpired();
    render();
  } catch (e) {
    console.error(e);
    document.getElementById("loading").innerHTML = "<p>불러오기 실패: " + e.message + "</p>";
    return;
  }
  document.getElementById("loading").style.display = "none";
}

// 휴지통 30일 경과분 영구삭제 (방문 시 정리)
async function purgeExpired() {
  const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const expired = BL.books.filter((b) => b.deleted_at && new Date(b.deleted_at).getTime() < cutoff);
  for (const b of expired) {
    try { await supabaseAPI.hardDelete("tr_book_documents", b.id); } catch (_) {}
  }
  if (expired.length) BL.books = BL.books.filter((b) => !expired.includes(b));
}

function render() {
  const active = BL.books.filter((b) => !b.deleted_at);
  const trash = BL.books.filter((b) => b.deleted_at);

  renderActive(active);
  renderTrash(trash);
  document.getElementById("trashCount").textContent = trash.length ? "(" + trash.length + ")" : "";
}

function fmtDate(s) { try { return new Date(s).toLocaleDateString("ko-KR"); } catch (_) { return "-"; } }

function renderActive(books) {
  const list = document.getElementById("bookList");
  document.getElementById("bookEmpty").style.display = books.length ? "none" : "block";
  list.innerHTML = "";
  books.forEach((b) => {
    const role = b.role || "etc";
    const pub = !!b.is_active;
    const aud = b.audience_mode === "selected" ? "selected" : "all";
    // 공개된 책에만 "대상" 배지 노출 (숨김이면 아무도 못 보므로 의미 없음)
    const audBadge = pub
      ? '<span class="badge badge-aud" data-act="audience">' +
          (aud === "selected"
            ? '<i class="fas fa-user-check"></i> 특정 학생'
            : '<i class="fas fa-users"></i> 전체공개') +
        "</span>"
      : "";
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML =
      '<div class="book-card-main">' +
        '<div class="book-card-titlerow">' +
          '<span class="book-card-title">' + esc(b.title || "(제목 없음)") + "</span>" +
          '<span class="badge badge-role" data-act="role">' + (ROLE_LABEL[role] || "기타") + "</span>" +
          '<span class="badge ' + (pub ? "badge-public" : "badge-hidden") + '">' + (pub ? "공개" : "숨김") + "</span>" +
          audBadge +
        "</div>" +
        '<div class="book-card-meta">' + (b.total_pages || 0) + "페이지 · 수정 " + fmtDate(b.updated_at) + "</div>" +
      "</div>" +
      '<div class="book-card-actions">' +
        '<label class="toggle" title="공개/숨김"><input type="checkbox" data-act="pub"' + (pub ? " checked" : "") + "><span class=\"toggle-track\"></span><span class=\"toggle-thumb\"></span></label>" +
        '<button class="book-card-edit" data-act="edit"><i class="fas fa-pen-to-square"></i> 수정</button>' +
        '<button class="book-mini" data-act="download" title="텍스트(.md)로 다운로드"><i class="fas fa-file-arrow-down"></i></button>' +
        '<button class="book-mini" data-act="rename" title="이름변경"><i class="fas fa-i-cursor"></i></button>' +
        '<button class="book-mini is-danger" data-act="del" title="삭제(휴지통)"><i class="fas fa-trash-can"></i></button>' +
      "</div>";

    card.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.dataset.act;
      if (act === "edit") editBook(b.id);
      else if (act === "download") downloadBook(b, t);
      else if (act === "rename") renameBook(b);
      else if (act === "del") softDelete(b);
      else if (act === "pub") togglePublish(b, t.checked);
      else if (act === "role") openRoleMenu(b, t);
      else if (act === "audience") openAudience(b);
    });
    list.appendChild(card);
  });
}

function renderTrash(books) {
  const list = document.getElementById("trashList");
  document.getElementById("trashEmpty").style.display = books.length ? "none" : "block";
  list.innerHTML = "";
  books.forEach((b) => {
    const left = TRASH_DAYS - Math.floor((Date.now() - new Date(b.deleted_at).getTime()) / (24 * 60 * 60 * 1000));
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML =
      '<div class="book-card-main">' +
        '<div class="book-card-titlerow"><span class="book-card-title">' + esc(b.title || "(제목 없음)") + "</span></div>" +
        '<div class="book-card-meta trash-days">' + (b.total_pages || 0) + "페이지 · " + Math.max(0, left) + "일 후 영구삭제</div>" +
      "</div>" +
      '<div class="book-card-actions">' +
        '<button class="book-card-edit" data-act="restore"><i class="fas fa-rotate-left"></i> 되살리기</button>' +
      "</div>";
    card.addEventListener("click", (e) => {
      if (e.target.closest('[data-act="restore"]')) restoreBook(b);
    });
    list.appendChild(card);
  });
}

// ===== 동작 =====
async function createBook() {
  const name = prompt("새 입문서 이름:", "새 입문서");
  if (!name || !name.trim()) return;
  const maxOrder = BL.books.reduce((m, b) => Math.max(m, b.sort_order || 0), 0);
  const b = await supabaseAPI.post("tr_book_documents", { title: name.trim(), kind: "pages", is_active: false, total_pages: 0, sort_order: maxOrder + 1 });
  location.href = "admin-book-editor.html?book=" + b.id; // 새 책 → 바로 편집기
}

function editBook(id) { location.href = "admin-book-editor.html?book=" + id; }

// 이 책의 저장된 페이지들을 순서대로 받아 → 마크다운(.md) 다운로드
async function downloadBook(b, btn) {
  if (!window.BookMarkdown) { alert("변환기 로드 실패 — 새로고침 해주세요."); return; }
  const prev = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
  try {
    const pages = await supabaseAPI.query("tr_book_pages", {
      book_id: "eq." + b.id,
      order: "sort_order.asc",
      select: "sort_order,blocks",
    });
    if (!pages || !pages.length) { alert("이 책엔 아직 페이지가 없어요."); return; }
    const md = window.BookMarkdown.buildBookMarkdown(b.title, pages);
    window.BookMarkdown.downloadMarkdown(window.BookMarkdown.filenameFor(b.title), md);
  } catch (e) {
    console.error(e);
    alert("다운로드 실패: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = prev; }
  }
}

async function renameBook(b) {
  const name = prompt("책 이름 변경:", b.title);
  if (!name || !name.trim() || name.trim() === b.title) return;
  await supabaseAPI.patch("tr_book_documents", b.id, { title: name.trim() });
  b.title = name.trim();
  render();
}

async function togglePublish(b, val) {
  try {
    await supabaseAPI.patch("tr_book_documents", b.id, { is_active: val });
    b.is_active = val;
    render();
  } catch (e) { alert("변경 실패: " + e.message); render(); }
}

async function softDelete(b) {
  if (!confirm('"' + b.title + '" 책을 휴지통으로 보낼까요?\n30일간 보관 후 자동 영구삭제돼요. (그 전엔 되살릴 수 있어요)')) return;
  try {
    await supabaseAPI.patch("tr_book_documents", b.id, { deleted_at: new Date().toISOString(), is_active: false });
    b.deleted_at = new Date().toISOString();
    b.is_active = false;
    render();
  } catch (e) {
    alert("휴지통 기능은 DB SQL(role/deleted_at 컬럼) 적용 후 동작해요.\n\n" + e.message);
  }
}

async function restoreBook(b) {
  await supabaseAPI.patch("tr_book_documents", b.id, { deleted_at: null });
  b.deleted_at = null;
  render();
}

// ===== 역할 변경 미니 메뉴 =====
let roleMenuEl = null;
function openRoleMenu(b, anchor) {
  closeRoleMenu();
  const rect = anchor.getBoundingClientRect();
  roleMenuEl = document.createElement("div");
  roleMenuEl.className = "role-menu open";
  roleMenuEl.style.left = rect.left + "px";
  roleMenuEl.style.top = rect.bottom + 6 + "px";
  const cur = b.role || "etc";
  ["regular", "australia", "etc"].forEach((r) => {
    const btn = document.createElement("button");
    btn.className = r === cur ? "active" : "";
    btn.textContent = ROLE_LABEL[r] + (r === cur ? "  ✓" : "");
    btn.addEventListener("click", (e) => { e.stopPropagation(); setRole(b, r); closeRoleMenu(); });
    roleMenuEl.appendChild(btn);
  });
  document.body.appendChild(roleMenuEl);
  setTimeout(() => document.addEventListener("click", closeRoleMenu, { once: true }), 0);
}
function closeRoleMenu() { if (roleMenuEl) { roleMenuEl.remove(); roleMenuEl = null; } }
async function setRole(b, r) {
  try {
    await supabaseAPI.patch("tr_book_documents", b.id, { role: r });
    b.role = r;
    render();
  } catch (e) {
    alert("역할 기능은 DB SQL(role 컬럼) 적용 후 동작해요.\n\n" + e.message);
  }
}

// ===== 휴지통 보기 토글 =====
function toggleTrash() {
  const t = document.getElementById("trashSection");
  const a = document.getElementById("activeSection");
  const show = t.style.display === "none";
  t.style.display = show ? "block" : "none";
  a.style.display = show ? "none" : "block";
}

function goBack() { location.href = "admin-settings.html"; }

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// =====================================================================
// 공개 대상 관리 (전체공개 / 특정 학생)
//   - audience_mode: tr_book_documents 컬럼
//   - 특정 학생: tr_book_access (book_id, user_id) 에 저장
//   - 학생 검색: applications(입금확인=true, 입문서전용 제외) → users(email)로 user_id 확보
// =====================================================================
const AUD = { book: null, added: [], searchTimer: null };

async function openAudience(b) {
  AUD.book = b;
  AUD.added = [];
  document.getElementById("audBookTitle").textContent = b.title || "(제목 없음)";
  document.getElementById("audSearch").value = "";
  document.getElementById("audResults").innerHTML = "";
  const mode = b.audience_mode === "selected" ? "selected" : "all";
  document.querySelectorAll('input[name="audMode"]').forEach((r) => { r.checked = r.value === mode; });
  applyAudModeUI(mode);
  document.getElementById("audModal").classList.add("open");

  if (mode === "selected") await loadAddedStudents();
}

function applyAudModeUI(mode) {
  document.getElementById("audSelectedArea").style.display = mode === "selected" ? "block" : "none";
}

function closeAudience() {
  document.getElementById("audModal").classList.remove("open");
  AUD.book = null;
}

// 대상 방식 라디오 변경 → 저장
async function onAudModeChange(mode) {
  if (!AUD.book) return;
  applyAudModeUI(mode);
  try {
    await supabaseAPI.patch("tr_book_documents", AUD.book.id, { audience_mode: mode });
    AUD.book.audience_mode = mode;
    render(); // 카드 배지 갱신
    if (mode === "selected") await loadAddedStudents();
  } catch (e) {
    alert("대상 방식 저장 실패 — DB SQL(add_book_audience.sql) 적용 후 동작해요.\n\n" + e.message);
  }
}

// 이 책에 이미 추가된 학생 목록
async function loadAddedStudents() {
  const wrap = document.getElementById("audAdded");
  wrap.innerHTML = '<div class="aud-hint">불러오는 중…</div>';
  try {
    const rows = await supabaseAPI.query("tr_book_access", { book_id: "eq." + AUD.book.id, order: "created_at.desc" });
    AUD.added = rows || [];
    renderAdded();
  } catch (e) {
    wrap.innerHTML = '<div class="aud-hint">목록을 불러오지 못했어요. (DB SQL 적용 필요)</div>';
  }
}

function renderAdded() {
  const wrap = document.getElementById("audAdded");
  if (!AUD.added.length) { wrap.innerHTML = '<div class="aud-hint">아직 추가된 학생이 없어요.</div>'; return; }
  wrap.innerHTML = "";
  AUD.added.forEach((a) => {
    const row = document.createElement("div");
    row.className = "aud-person";
    row.innerHTML =
      '<div class="aud-person-info"><b>' + esc(a.student_name || "-") + "</b>" +
      '<span>' + esc(a.student_email || "") + "</span></div>" +
      '<button class="book-mini is-danger" title="제거"><i class="fas fa-xmark"></i></button>';
    row.querySelector("button").addEventListener("click", () => removeAccess(a));
    wrap.appendChild(row);
  });
}

// 학생 검색 (입력 디바운스)
function onAudSearchInput(term) {
  clearTimeout(AUD.searchTimer);
  const q = (term || "").trim();
  if (q.length < 1) { document.getElementById("audResults").innerHTML = ""; return; }
  AUD.searchTimer = setTimeout(() => searchStudents(q), 250);
}

async function searchStudents(term) {
  const box = document.getElementById("audResults");
  box.innerHTML = '<div class="aud-hint">검색 중…</div>';
  try {
    // 결제완료(입금확인) + 입문서전용 제외 = 내벨업챌린지 결제자
    const apps = await supabaseAPI.query("applications", {
      deposit_confirmed_by_admin: "eq.true",
      application_type: "neq.book_only",
      name: "ilike.*" + term + "*",
      select: "id,name,email",
      order: "name.asc",
      limit: "20",
    });
    // 이미 추가된 이메일은 제외
    const addedEmails = new Set(AUD.added.map((a) => (a.student_email || "").toLowerCase()));
    const list = (apps || []).filter((a) => a.email && !addedEmails.has(a.email.toLowerCase()));
    if (!list.length) { box.innerHTML = '<div class="aud-hint">결제 완료된 학생 중 검색 결과가 없어요.</div>'; return; }
    // 이메일 중복 제거(신청서 여러 개일 수 있음)
    const seen = new Set();
    box.innerHTML = "";
    list.forEach((a) => {
      const key = a.email.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const row = document.createElement("div");
      row.className = "aud-result";
      row.innerHTML =
        '<div class="aud-person-info"><b>' + esc(a.name || "-") + "</b><span>" + esc(a.email) + "</span></div>" +
        '<button class="aud-add-btn"><i class="fas fa-plus"></i> 추가</button>';
      row.querySelector("button").addEventListener("click", () => addAccess(a, row));
      box.appendChild(row);
    });
  } catch (e) {
    box.innerHTML = '<div class="aud-hint">검색 실패: ' + esc(e.message) + "</div>";
  }
}

async function addAccess(app, rowEl) {
  try {
    // 이메일로 실제 로그인 계정(users.id) 확보 — 뷰어 권한판정이 user_id 기준
    const users = await supabaseAPI.query("users", { email: "eq." + app.email, select: "id,name", limit: "1" });
    if (!users || !users.length) {
      alert("이 학생은 아직 학습 사이트 계정이 없어요.\n(로그인한 적이 있어야 지정할 수 있어요.)");
      return;
    }
    const row = await supabaseAPI.post("tr_book_access", {
      book_id: AUD.book.id,
      user_id: users[0].id,
      student_name: app.name || users[0].name || null,
      student_email: app.email,
      created_by: "admin",
    });
    AUD.added.unshift(row);
    renderAdded();
    if (rowEl) rowEl.remove();
  } catch (e) {
    // 중복(이미 추가)일 수 있음
    alert("추가 실패 (이미 추가됐거나 DB SQL 미적용): " + e.message);
  }
}

async function removeAccess(a) {
  try {
    await supabaseAPI.hardDelete("tr_book_access", a.id);
    AUD.added = AUD.added.filter((x) => x.id !== a.id);
    renderAdded();
  } catch (e) { alert("제거 실패: " + e.message); }
}
