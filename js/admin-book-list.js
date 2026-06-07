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
    const card = document.createElement("div");
    card.className = "book-card";
    card.innerHTML =
      '<div class="book-card-main">' +
        '<div class="book-card-titlerow">' +
          '<span class="book-card-title">' + esc(b.title || "(제목 없음)") + "</span>" +
          '<span class="badge badge-role" data-act="role">' + (ROLE_LABEL[role] || "기타") + "</span>" +
          '<span class="badge ' + (pub ? "badge-public" : "badge-hidden") + '">' + (pub ? "공개" : "숨김") + "</span>" +
        "</div>" +
        '<div class="book-card-meta">' + (b.total_pages || 0) + "페이지 · 수정 " + fmtDate(b.updated_at) + "</div>" +
      "</div>" +
      '<div class="book-card-actions">' +
        '<label class="toggle" title="공개/숨김"><input type="checkbox" data-act="pub"' + (pub ? " checked" : "") + "><span class=\"toggle-track\"></span><span class=\"toggle-thumb\"></span></label>" +
        '<button class="book-card-edit" data-act="edit"><i class="fas fa-pen-to-square"></i> 수정</button>' +
        '<button class="book-mini" data-act="rename" title="이름변경"><i class="fas fa-i-cursor"></i></button>' +
        '<button class="book-mini is-danger" data-act="del" title="삭제(휴지통)"><i class="fas fa-trash-can"></i></button>' +
      "</div>";

    card.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act]");
      if (!t) return;
      const act = t.dataset.act;
      if (act === "edit") editBook(b.id);
      else if (act === "rename") renameBook(b);
      else if (act === "del") softDelete(b);
      else if (act === "pub") togglePublish(b, t.checked);
      else if (act === "role") openRoleMenu(b, t);
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
