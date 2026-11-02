// =====================================================================
// 입문서 버전 협업 — 편집기 화면 (협업이 켜진 책에서만 동작)
//
// 세 동작을 분리한다.
//   * 수정안 보내기: 현재 변경을 별도 수정안으로 서버에 보관. 본문·기준 버전은 그대로.
//   * 불러오기: 선택한 버전의 대상 범위로 "이 작업창"만 바꾼다. 교체 전 서버 백업을 먼저 만든다.
//   * 저장: 서버 기준 버전이 그대로일 때만 한 번에 확정(새 V번호). 공개 전환과는 무관.
//
// admin-book-editor.js의 State·화면 함수를 사용한다. 협업이 꺼진 책은 이 파일이 아무것도 하지 않는다.
// =====================================================================
(function () {
  "use strict";

  const C = window.BookRevisionClient;
  const W = window.BookWorkingCopy;
  const POLL_MS = 30000;
  const RENDERER = "blocknote-20261102";

  const BC = {
    enabled: false,
    book: null,
    user: null,
    head: null,          // { id, seq } — 이 작업창이 출발한 서버 기준
    latest: null,        // { id, seq } — 마지막으로 확인한 서버 head
    base: null,          // { order:[uid], content: Map uid→{blocks, html}, deleted: Map uid→{blocks, html} }
    wc: null,            // 보관 중인 작업본
    idbOk: true,
    busy: false,
    authLost: false,
    unread: 0,
    structureAllowed: true,
    timers: new Map(),
    persistTimer: null,
    recoveries: [],
    legacyDrafts: [],
    revisions: [],
    panelTab: "history",
    pollTimer: null,
    bookChannel: null,
    lastNotice: "",
  };

  // ------------------------------------------------------------------
  // 작은 도우미
  // ------------------------------------------------------------------
  const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
  const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
  function fingerprint(blocks) {
    const s = JSON.stringify(blocks || []);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16) + ":" + s.length;
  }
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fmtTime(s) { try { return new Date(s).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } }
  function pageIndex(uid) { return State.pages.findIndex((p) => p.id === uid); }
  function pageLabelRange(uids) {
    const nums = (uids || []).map((u) => pageIndex(u) + 1).filter((n) => n > 0).sort((a, b) => a - b);
    const missing = (uids || []).length - nums.length;
    const parts = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      parts.push(i === j ? String(nums[i]) : nums[i] + "~" + nums[j]);
      i = j;
    }
    let txt = parts.length ? parts.join(", ") + "쪽" : "";
    if (missing > 0) txt += (txt ? " · " : "") + "지금 목록에 없는 쪽 " + missing + "개";
    return txt || "쪽 변경 없음";
  }
  function firstText(blocks) {
    const walk = (arr) => {
      for (const b of arr || []) {
        const t = typeof inlineText === "function" ? inlineText(b.content) : "";
        if (t && t.trim()) return t.trim();
        const c = walk(b.children);
        if (c) return c;
      }
      return "";
    };
    return walk(blocks).slice(0, 40);
  }
  const authorLabel = (r) => (r.author_source === "aside" ? "Aside 작성" : r.author_source === "system" ? "시스템" : "대표");
  const kindLabel = (r) => (r.kind === "save" ? "V" + r.seq + " 저장" : r.kind === "baseline" ? "V" + r.seq + " 기준본" : r.kind === "proposal" ? "수정안" : "교체 전 백업");

  function liveHandle() {
    for (const h of State.editors.values()) return h;
    return State.pages.length ? ensureMounted(State.pages[0].id) : null;
  }

  // ------------------------------------------------------------------
  // 확인창 (취소 가능)
  // ------------------------------------------------------------------
  function dialog(opts) {
    return new Promise((resolve) => {
      const ov = document.createElement("div");
      ov.className = "bookedit-modal-overlay open bc-dialog";
      ov.innerHTML =
        '<div class="bookedit-modal bc-dialog-box" role="dialog" aria-modal="true">' +
          '<div class="bookedit-modal-head"><h2>' + esc(opts.title || "확인") + "</h2></div>" +
          '<div class="bookedit-modal-body bc-dialog-body"></div>' +
          '<div class="bc-dialog-actions"></div>' +
        "</div>";
      const body = ov.querySelector(".bc-dialog-body");
      (opts.lines || []).forEach((l) => {
        const p = document.createElement("p");
        p.className = l.warn ? "bc-warn" : "";
        p.textContent = l.text != null ? l.text : l;
        body.appendChild(p);
      });
      if (opts.fields) {
        opts.fields.forEach((f) => {
          const lab = document.createElement("label");
          lab.className = "bc-field";
          lab.innerHTML = "<span>" + esc(f.label) + "</span>";
          let input;
          if (f.type === "select") {
            input = document.createElement("select");
            f.options.forEach((o) => { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; input.appendChild(op); });
          } else if (f.type === "textarea") {
            input = document.createElement("textarea");
            input.rows = 3;
          } else {
            input = document.createElement("input");
            input.type = "text";
          }
          input.name = f.name;
          input.value = f.value || "";
          if (f.maxLength) input.maxLength = f.maxLength;
          lab.appendChild(input);
          body.appendChild(lab);
        });
      }
      const act = ov.querySelector(".bc-dialog-actions");
      const done = (v) => {
        const vals = {};
        ov.querySelectorAll("input,textarea,select").forEach((el) => { vals[el.name] = el.value; });
        ov.remove();
        document.removeEventListener("keydown", onKey);
        resolve(v === null ? null : { choice: v, values: vals });
      };
      const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
      document.addEventListener("keydown", onKey);
      (opts.buttons || [{ label: "확인", value: "ok", primary: true }]).forEach((b) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = b.primary ? "btn-grad" : b.danger ? "btn-ghost is-danger" : "btn-secondary";
        btn.textContent = b.label;
        btn.dataset.choice = b.value;
        btn.addEventListener("click", () => done(b.value));
        act.appendChild(btn);
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn-ghost";
      cancel.textContent = opts.cancelLabel || "취소";
      cancel.dataset.choice = "cancel";
      cancel.addEventListener("click", () => done(null));
      act.insertBefore(cancel, act.firstChild);
      document.body.appendChild(ov);
      const first = ov.querySelector("input,textarea,select") || ov.querySelector(".btn-grad") || cancel;
      setTimeout(() => first.focus(), 0);
    });
  }
  async function notice(title, lines) {
    await dialog({ title, lines, buttons: [], cancelLabel: "닫기" });
  }

  // ------------------------------------------------------------------
  // 상태 표시
  // ------------------------------------------------------------------
  function changedPageIds() {
    const ids = new Set(Object.keys((BC.wc && BC.wc.content) || {}));
    Object.keys((BC.wc && BC.wc.added) || {}).forEach((u) => ids.add(u));
    State.dirty.forEach((u) => ids.add(u));
    return Array.from(ids).filter((u) => pageIndex(u) >= 0);
  }
  function structureDiffers() {
    if (!BC.base) return false;
    return !same(BC.base.order, State.pages.map((p) => p.id));
  }
  function hasChanges() { return changedPageIds().length > 0 || structureDiffers(); }

  function refreshStatus(extra) {
    if (!BC.enabled) return;
    let type = "saved";
    let txt;
    const n = changedPageIds().length;
    if (BC.authLost) {
      type = "error";
      txt = "관리자 확인 필요 · 입력한 내용은 유지됩니다";
    } else if (BC.wc && BC.wc.pending_commit) {
      type = "editing";
      txt = "저장 결과 확인 필요 · 작업은 이 기기에 보관 중";
    } else if (hasChanges()) {
      type = "editing";
      const fromAside = (BC.wc.loaded_sources || []).some((s) => s.author_source === "aside");
      const loaded = (BC.wc.loaded_sources || []).length > 0;
      txt = loaded ? (fromAside ? "Aside 수정안 불러옴 · 저장 전" : "불러온 버전 · 저장 전") : "수정 중";
      txt += " · " + (n ? n + "쪽" : "쪽 순서") + (structureDiffers() && n ? " + 쪽 순서" : "");
      txt += BC.idbOk ? " · 이 기기에 임시 보관" : " · 임시 보관 불가(창을 닫으면 사라져요)";
    } else {
      txt = "서버 저장본 V" + BC.head.seq;
    }
    if (BC.latest && BC.latest.id !== BC.head.id && BC.latest.seq > BC.head.seq) txt += " · 새 서버 저장본 있음 (V" + BC.latest.seq + ")";
    if (extra) txt = extra + " · " + txt;
    setStatus(type, esc(txt));
    const chip = document.getElementById("bcBadge");
    if (chip) { chip.textContent = BC.unread > 0 ? String(BC.unread) : ""; chip.hidden = !(BC.unread > 0); }
  }

  function handleAuthError(e) {
    if (e && e.code === "AUTH_REQUIRED") {
      BC.authLost = true;
      refreshStatus();
      return true;
    }
    return false;
  }

  async function goReauth() {
    try { await persistNow(); } catch (e) {
      await notice("작업을 보관하지 못했어요", ["다시 로그인하기 전에 작업을 이 기기에 저장하지 못했어요. 창을 닫지 말고 텍스트로 내려받아 두세요.", String(e.message || e)]);
      return;
    }
    location.href = "login.html?reauth=1&redirect=" + encodeURIComponent(location.pathname.replace(/^\//, "") + location.search);
  }

  // ------------------------------------------------------------------
  // 작업본 보관
  // ------------------------------------------------------------------
  function emptyWorking() {
    return {
      user_id: BC.user.id, book_id: BC.book, tab_id: W.getTabId(), device_id: W.deviceId(),
      working_copy_id: C.uuid(), base_revision_id: BC.head.id, base_seq: BC.head.seq,
      order: null, added: {}, content: {}, loaded_sources: [], pending_commit: null, generation: 0,
    };
  }

  function captureMounted() {
    // 켜진 편집기 내용 → 작업본 (입력 확정 실패 시 예외)
    for (const [uid, h] of State.editors.entries()) {
      if (!State.dirty.has(uid) && !(BC.wc.content[uid])) continue;
      if (h.flush && !h.flush()) throw new Error("입력을 마치거나 충돌 표시를 확인해주세요.");
      setContent(uid, h.getBlocks());
    }
  }

  function setContent(uid, blocks) {
    const p = State.pages.find((x) => x.id === uid);
    const baseBlocks = BC.wc.added[uid] ? BC.wc.added[uid].blocks : (p ? p.blocks : null);
    if (baseBlocks && same(baseBlocks, blocks) && !BC.wc.added[uid]) delete BC.wc.content[uid];
    else BC.wc.content[uid] = { blocks: clone(blocks) };
  }

  function syncStructureToWorking() {
    if (!BC.wc) return;
    const ids = State.pages.map((p) => p.id);
    BC.wc.order = same(ids, BC.base.order) ? null : ids;
    Object.keys(BC.wc.added).forEach((u) => { if (!ids.includes(u)) delete BC.wc.added[u]; });
    Object.keys(BC.wc.content).forEach((u) => { if (!ids.includes(u)) delete BC.wc.content[u]; });
  }

  async function persistNow() {
    if (!BC.wc) return;
    syncStructureToWorking();
    if (!BC.idbOk) throw new Error("이 브라우저에 작업본을 보관할 수 없어요");
    await W.putWorking(BC.wc);
  }
  function schedulePersist() {
    clearTimeout(BC.persistTimer);
    BC.persistTimer = setTimeout(() => { persistNow().catch(storageFailed); }, 400);
  }
  function storageFailed(e) {
    console.error(e);
    BC.idbOk = false;
    refreshStatus();
  }

  // ------------------------------------------------------------------
  // 진입
  // ------------------------------------------------------------------
  async function detect(bookId) {
    if (!C || !W) return false;
    const st = await C.status([bookId]);
    return !!(st && st[bookId]);
  }

  function showGate(lines, withLogin) {
    const loading = document.getElementById("editorLoading");
    if (!loading) return;
    loading.style.display = "flex";
    loading.innerHTML = '<div class="bc-gate"><i class="fas fa-user-shield"></i>' +
      lines.map((l) => "<p>" + esc(l) + "</p>").join("") +
      (withLogin ? '<button class="btn-grad" id="bcGateLogin">기존 관리자 로그인으로 다시 로그인</button>' : "") + "</div>";
    const b = document.getElementById("bcGateLogin");
    if (b) b.addEventListener("click", () => {
      location.href = "login.html?reauth=1&redirect=" + encodeURIComponent(location.pathname.replace(/^\//, "") + location.search);
    });
  }

  // admin-book-editor.js의 loadPages 대신 호출. 반환 false면 편집기를 띄우지 않는다.
  async function loadPages(bookId) {
    BC.book = bookId;
    const session = await C.validSession();
    if (!session) {
      showGate(["이 책은 버전 협업이 켜져 있어 관리자 확인이 필요해요.", "기존 관리자 로그인 화면에서 한 번 다시 로그인하면 돌아와요."], true);
      return false;
    }
    BC.user = session.user;
    try { await W.open(); } catch (e) { BC.idbOk = false; }
    if (BC.idbOk) { try { await W.claimTab(); } catch (_) { BC.idbOk = false; } }
    if (!W.getTabId()) BC.fallbackTab = C.uuid();

    let st;
    try {
      st = await C.getState(bookId, true);
    } catch (e) {
      if (e.code === "AUTH_REQUIRED") { showGate(["관리자 확인이 만료됐어요.", "기존 관리자 로그인으로 다시 로그인해 주세요."], true); return false; }
      if (e.code === "FORBIDDEN") { showGate(["이 계정은 이 책의 협업 권한이 없어요.", "다른 관리자 계정으로 로그인했는지 확인해 주세요."], true); return false; }
      throw e;
    }
    if (!st.enabled) { location.reload(); return false; }
    BC.enabled = true;
    BC.head = { id: st.head_revision_id, seq: st.head_seq };
    BC.latest = { ...BC.head };
    BC.unread = st.unread_proposals || 0;
    BC.structureAllowed = st.structure_allowed !== false;
    BC.base = {
      order: st.pages.map((p) => p.id),
      content: new Map(st.pages.map((p) => [p.id, { blocks: p.blocks, html: p.html }])),
      deleted: new Map((st.deleted_pages || []).map((p) => [p.id, { blocks: p.blocks, html: p.html }])),
    };
    State.pages = st.pages.map((p) => ({ id: p.id, sort_order: p.sort_order, blocks: p.blocks, html: p.html }));
    State.currentId = State.pages[0] ? State.pages[0].id : null;
    if (st.book && st.book.title) State.book.title = st.book.title;

    BC.wc = emptyWorking();
    if (BC.idbOk) {
      try { await recoverOnStart(); } catch (e) { console.error(e); BC.idbOk = false; }
    }
    scanLegacyDrafts();
    return true;
  }

  async function recoverOnStart() {
    const user = BC.user.id;
    const tab = W.getTabId();
    // 1) 불러오기 도중 중단된 전환 → 이전 작업본으로
    const broken = await W.incompleteTransitions(user, BC.book, tab);
    for (const t of broken) {
      if (t.before) await W.putWorking(t.before);
      t.phase = "aborted";
      t.aborted_reason = "재진입 시 복구";
      await W.putTransition(t);
      BC.lastNotice = "불러오기 도중 창이 닫혀, 불러오기 전 작업으로 되돌렸어요.";
    }
    // 2) 이 작업창의 작업본
    const mine = await W.getWorking(user, BC.book, tab);
    if (mine && workingHasChanges(mine)) {
      if (mine.base_revision_id === BC.head.id) {
        BC.wc = mine;
        applyWorkingToState(mine);
        if (!BC.lastNotice) BC.lastNotice = "이 작업창의 미저장 작업을 복구했어요.";
      } else {
        BC.recoveries.push({ rec: mine, reason: "이전 기준(V" + mine.base_seq + ")의 미저장 작업" });
        await W.deleteWorking(user, BC.book, tab).catch(() => {});
        mine.tab_id = "orphan-" + C.uuid();
        await W.putWorking(mine);
      }
    } else if (mine && mine.pending_commit) {
      BC.wc = mine;
    }
    // 3) 닫힌 다른 작업창의 작업본
    const alive = await W.aliveTabs();
    const all = await W.listWorking(user, BC.book);
    for (const r of all || []) {
      if (r.tab_id === tab || alive.has(r.tab_id) || !workingHasChanges(r)) continue;
      if (BC.recoveries.some((x) => x.rec.key === r.key)) continue;
      BC.recoveries.push({ rec: r, reason: r.base_revision_id === BC.head.id ? "닫힌 다른 작업창의 미저장 작업" : "이전 기준(V" + r.base_seq + ")의 미저장 작업" });
    }
    if (BC.wc.pending_commit) await resolvePendingCommit();
  }

  function workingHasChanges(r) {
    return !!(r && (Object.keys(r.content || {}).length || Object.keys(r.added || {}).length || (r.order && r.order.length)));
  }

  function applyWorkingToState(rec) {
    const order = rec.order || BC.base.order;
    const pages = [];
    order.forEach((uid) => {
      if (rec.added[uid]) pages.push({ id: uid, sort_order: 0, blocks: rec.added[uid].blocks, html: rec.added[uid].html || "" });
      else if (BC.base.content.has(uid)) { const c = BC.base.content.get(uid); pages.push({ id: uid, sort_order: 0, blocks: c.blocks, html: c.html }); }
      else if (BC.base.deleted.has(uid)) { const c = BC.base.deleted.get(uid); pages.push({ id: uid, sort_order: 0, blocks: c.blocks, html: c.html }); }
    });
    State.pages = pages;
    State.currentId = pages[0] ? pages[0].id : null;
    Object.keys(rec.content).forEach((u) => State.dirty.add(u));
  }

  function scanLegacyDrafts() {
    BC.legacyDrafts = [];
    let done = null;
    try { done = localStorage.getItem("eon_book_legacy_imported_" + BC.book); } catch (_) {}
    if (done) return;
    const prefixes = ["bookedit_draft_" + BC.book + "_", "bookedit_draftbak_" + BC.book + "_"];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const pre = prefixes.find((p) => k && k.startsWith(p));
        if (!pre) continue;
        const uid = k.slice(pre.length);
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(k)); } catch (_) { continue; }
        let blocks = null;
        if (Array.isArray(raw)) blocks = raw;
        else if (raw && Array.isArray(raw.blocks)) blocks = raw.blocks;
        else if (raw && raw.draft) blocks = Array.isArray(raw.draft) ? raw.draft : raw.draft.blocks;
        if (Array.isArray(blocks) && blocks.length) BC.legacyDrafts.push({ key: k, uid, blocks });
      }
    } catch (_) {}
  }

  // 편집기 화면이 다 그려진 뒤 (admin-book-editor.js에서 호출)
  function afterRender() {
    if (!BC.enabled) return;
    installChrome();
    refreshStatus();
    refreshPreviews(Object.keys(BC.wc.content || {}));
    if (BC.lastNotice) setTimeout(() => refreshStatus(BC.lastNotice), 50);
    if (BC.recoveries.length || BC.legacyDrafts.length) showRecoveryBar();
    startPolling();
    flushOutbox();
    window.addEventListener("beforeunload", (e) => {
      if (BC.busy) { e.preventDefault(); e.returnValue = ""; }
    });
    const open = new URLSearchParams(location.search).get("open");
    if (open) setTimeout(() => openPanel().then(() => openDetail(open)), 300);
  }

  function installChrome() {
    const btn = document.querySelector('button[onclick="showVersions()"]');
    if (btn && !document.getElementById("bcBadge")) {
      btn.innerHTML = '<i class="fas fa-clock-rotate-left"></i> 버전 <span class="bc-badge" id="bcBadge" hidden></span>';
      btn.title = "수정안·저장 이력";
    }
    const save = document.getElementById("btnSave");
    if (save) save.title = "저장 (서버 기준본 확정 · 공개 여부는 바뀌지 않아요)";
    if (!BC.bookChannel && "BroadcastChannel" in window) {
      BC.bookChannel = new BroadcastChannel("eon-book-collab-" + BC.book);
      BC.bookChannel.addEventListener("message", (ev) => {
        const m = ev.data || {};
        if (m.type === "saved" && m.tab !== W.getTabId() && m.seq > (BC.latest ? BC.latest.seq : 0)) {
          BC.latest = { id: m.id, seq: m.seq };
          refreshStatus("다른 작업창에서 V" + m.seq + " 저장됨");
        }
      });
    }
  }

  function showRecoveryBar() {
    let bar = document.getElementById("bcRecovery");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "bcRecovery";
      bar.className = "bc-recovery";
      document.body.appendChild(bar);
    }
    const items = [];
    BC.recoveries.forEach((r, i) => {
      items.push('<div class="bc-recovery-item"><span>' + esc(r.reason) + " · " + esc(fmtTime(r.rec.saved_at)) + " · " +
        (Object.keys(r.rec.content || {}).length + Object.keys(r.rec.added || {}).length) + "쪽</span>" +
        '<button class="btn-secondary" data-rec="' + i + '">백업으로 보관하고 불러오기 화면 열기</button></div>');
    });
    if (BC.legacyDrafts.length) {
      items.push('<div class="bc-recovery-item"><span>예전 방식 임시본 ' + BC.legacyDrafts.length + "쪽 (이 기기)</span>" +
        '<button class="btn-secondary" data-legacy="1">서버 백업으로 보관</button></div>');
    }
    if (!items.length) { bar.remove(); return; }
    bar.innerHTML = '<div class="bc-recovery-head"><b>복구할 작업이 있어요</b><button class="btn-ghost" data-close="1">나중에</button></div>' + items.join("");
    bar.onclick = async (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.close) { bar.hidden = true; return; }
      if (b.dataset.rec != null) await recoverRecord(Number(b.dataset.rec));
      if (b.dataset.legacy) await importLegacyDrafts();
    };
  }

  // ------------------------------------------------------------------
  // 편집 → 작업본
  // ------------------------------------------------------------------
  function onChange(pageId) {
    if (!BC.enabled) return;
    const gen = BC.wc.generation;
    clearTimeout(BC.timers.get(pageId));
    BC.timers.set(pageId, setTimeout(() => {
      BC.timers.delete(pageId);
      if (!BC.wc || BC.wc.generation !== gen) return; // 불러오기 등으로 작업본이 바뀐 뒤 늦게 온 변경
      const h = State.editors.get(pageId);
      if (!h) return;
      if (h.flush && !h.flush()) { setStatus("editing", "입력 중 · 아직 보관하지 않은 내용이 있어요"); return; }
      try { setContent(pageId, h.getBlocks()); } catch (_) { return; }
      if (!BC.wc.content[pageId] && !BC.wc.added[pageId]) { State.dirty.delete(pageId); markPageDirty(pageId, false); }
      persistNow().then(() => refreshStatus()).catch(storageFailed);
    }, 800));
    refreshStatus();
  }

  function blocksForPage(pageId) {
    const c = BC.wc && BC.wc.content[pageId];
    if (c) return c.blocks;
    const p = State.pages.find((x) => x.id === pageId);
    return p && Array.isArray(p.blocks) ? p.blocks : [];
  }

  function canChangeStructure() {
    if (BC.structureAllowed) return true;
    alert("공개 중이거나 학생 기록(메모·진도·지정 학생)이 있는 책이라 쪽 추가·삭제·순서 변경은 저장할 수 없어요.\n쪽 내용 수정은 할 수 있어요.");
    return false;
  }

  // 쪽 추가/복제/삭제/순서 변경 뒤 (서버 쓰기 없음)
  function structureChanged(info) {
    if (!BC.enabled) return;
    if (info && info.added) BC.wc.added[info.added.id] = { blocks: clone(info.added.blocks || []), html: info.added.html || "" };
    syncStructureToWorking();
    schedulePersist();
    refreshStatus();
  }

  // ------------------------------------------------------------------
  // 저장용 변경 명세
  // ------------------------------------------------------------------
  // 기준 순서 → 작업 순서의 최소 구조 동작. 순서를 안 바꾼 쪽들의 상대 순서는 그대로 둔다.
  function diffStructure(baseOrder, baseDeleted, order, added) {
    const ops = [];
    const inOrder = new Set(order);
    baseOrder.forEach((u) => { if (!inOrder.has(u)) ops.push({ op: "delete", page_uid: u }); });
    const pos = new Map(baseOrder.map((u, i) => [u, i]));
    const cand = order.filter((u) => pos.has(u));
    // 최장 증가 부분수열 = 그대로 두는 쪽
    const seq = cand.map((u) => pos.get(u));
    const tails = [];
    const tailIdx = [];
    const prev = new Array(seq.length).fill(-1);
    seq.forEach((v, i) => {
      let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
      tails[lo] = v; tailIdx[lo] = i;
      prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
    });
    const keep = new Set();
    let k = tailIdx[tails.length - 1];
    while (k != null && k >= 0) { keep.add(cand[k]); k = prev[k]; }
    let before = null;
    order.forEach((u) => {
      if (added.has(u)) ops.push({ op: "add", page_uid: u, after: before });
      else if (baseDeleted.has(u)) ops.push({ op: "restore", page_uid: u, after: before });
      else if (pos.has(u) && !keep.has(u)) ops.push({ op: "move", page_uid: u, after: before });
      before = u;
    });
    return ops;
  }

  async function buildChanges() {
    captureMounted();
    syncStructureToWorking();
    const conv = liveHandle();
    if (!conv) throw new Error("편집기가 아직 준비되지 않았어요. 잠시 후 다시 눌러주세요.");
    const pages = [];
    for (const p of State.pages) {
      const isAdded = !!BC.wc.added[p.id];
      const c = BC.wc.content[p.id];
      if (!c && !isAdded) continue;
      const blocks = c ? c.blocks : BC.wc.added[p.id].blocks;
      const baseC = BC.base.content.get(p.id) || BC.base.deleted.get(p.id);
      if (!isAdded && baseC && same(baseC.blocks, blocks)) continue;
      pages.push({ page_uid: p.id, blocks, html: await conv.htmlOf(blocks), renderer_version: RENDERER });
    }
    const structure = diffStructure(BC.base.order, new Set(BC.base.deleted.keys()), State.pages.map((p) => p.id),
      new Set(Object.keys(BC.wc.added)));
    return { pages, structure };
  }

  function sourceLinksFor(changes) {
    const sent = new Map(changes.pages.map((p) => [p.page_uid, p.blocks]));
    const links = [];
    (BC.wc.loaded_sources || []).forEach((s) => {
      const pages = (s.pages || []).filter((u) => sent.has(u));
      if (!pages.length && !(s.structure && changes.structure.length)) return;
      const edited = pages.some((u) => fingerprint(sent.get(u)) !== (s.hashes || {})[u]);
      links.push({ revision_id: s.revision_id, pages, mode: edited ? "edited" : "as_is", structure: !!(s.structure && changes.structure.length) });
    });
    return links;
  }

  // ------------------------------------------------------------------
  // 저장
  // ------------------------------------------------------------------
  function lockUi(on) {
    BC.busy = on;
    document.body.classList.toggle("bc-busy", on);
    const b = document.getElementById("btnSave");
    if (b) b.disabled = on;
  }

  async function save() {
    if (BC.busy) return;
    if (BC.authLost) { await askReauth(); return; }
    lockUi(true);
    let changes;
    try {
      if (BC.wc.pending_commit) {
        const resolved = await resolvePendingCommit();
        if (resolved === "unknown") return;
      }
      changes = await buildChanges();
      if (!changes.pages.length && !changes.structure.length) {
        BC.wc.content = {}; BC.wc.added = {}; State.dirty.clear();
        await persistNow().catch(storageFailed);
        refreshStatus("변경 없음");
        return;
      }
      if (changes.structure.length && !BC.structureAllowed) {
        await notice("쪽 구조는 저장할 수 없어요", ["공개 중이거나 학생 기록이 있는 책이에요. 쪽 추가·삭제·순서 변경을 되돌린 뒤 저장해주세요."]);
        return;
      }
      const links = sourceLinksFor(changes);
      const hash = fingerprint([BC.head.id, changes, links]);
      const pending = BC.wc.pending_commit && BC.wc.pending_commit.hash === hash ? BC.wc.pending_commit
        : { request_id: C.uuid(), expected_head: BC.head.id, hash, started_at: new Date().toISOString() };
      BC.wc.pending_commit = pending;
      await persistNow().catch(storageFailed);
      setStatus("editing", "저장 중…");
      let res;
      try {
        res = await C.commit({ book: BC.book, expectedHead: pending.expected_head, requestId: pending.request_id, changes, sourceLinks: links,
          title: changes.pages.length ? pageLabelRange(changes.pages.map((p) => p.page_uid)) + " 수정" : "쪽 구조 변경" });
      } catch (e) {
        if (handleAuthError(e)) { await askReauth(); return; }
        if (e.code === "UNKNOWN_RESULT") {
          refreshStatus("저장 결과를 확인하지 못했어요");
          await notice("저장 결과 확인 필요", ["서버 응답을 받지 못했어요. 작업은 이 기기에 그대로 있어요.",
            "다시 저장을 누르면 같은 요청 번호로 결과를 확인해요(두 번 저장되지 않아요)."]);
          return;
        }
        BC.wc.pending_commit = null;
        await persistNow().catch(storageFailed);
        throw e;
      }
      await handleCommitResult(res, changes);
    } catch (e) {
      console.error(e);
      refreshStatus("저장 실패");
      await notice("저장하지 못했어요", [e.message || String(e), "작업은 이 기기에 그대로 남아 있어요."]);
    } finally {
      lockUi(false);
      refreshStatus();
    }
  }

  async function handleCommitResult(res, changes) {
    if (res && res.ok === false && res.code === "CONFLICT") {
      BC.wc.pending_commit = null;
      await persistNow().catch(storageFailed);
      BC.latest = { id: res.current_head_revision_id, seq: res.current_head_seq };
      const d = await dialog({
        title: "다른 곳에서 먼저 저장됐어요",
        lines: ["이 작업창은 V" + BC.head.seq + " 기준인데, 서버에는 V" + res.current_head_seq + "이 저장돼 있어요.",
          "서버 본문은 바뀌지 않았고, 지금 작업은 이 기기에 보존돼 있어요.",
          "내 작업을 서버 백업으로 보관한 뒤 최신본을 열면, 그 백업을 골라 다시 불러올 수 있어요."],
        buttons: [{ label: "내 작업 백업하고 최신본 열기", value: "backup", primary: true }],
        cancelLabel: "닫기",
      });
      if (d && d.choice === "backup") await backupAndReload("저장 충돌 백업");
      return;
    }
    if (!res || !res.ok) throw new Error("저장 응답이 올바르지 않아요");
    BC.wc.pending_commit = null;
    if (res.no_change) {
      BC.wc.content = {}; BC.wc.added = {}; State.dirty.clear();
      await persistNow().catch(storageFailed);
      refreshStatus("변경 없음");
      return;
    }
    applySaved(res, changes);
    await persistNow().catch(storageFailed);
    if (BC.bookChannel) BC.bookChannel.postMessage({ type: "saved", id: res.revision_id, seq: res.seq, tab: W.getTabId() });
    const later = res.current_head_seq > res.seq;
    if (later) BC.latest = { id: res.current_head_revision_id, seq: res.current_head_seq };
    refreshStatus("V" + res.seq + " 저장 확인" + (res.replayed ? " (응답 재확인)" : ""));
    if (later) {
      await notice("저장은 확인됐어요", ["V" + res.seq + " 저장이 확인됐어요. 그 뒤 서버에 V" + res.current_head_seq + "이 더 저장돼 있어요.",
        "이 작업창은 V" + res.seq + " 기준이에요. 계속 고치기 전에 최신본을 여는 게 안전해요."]);
    }
  }

  function applySaved(res, changes) {
    const sent = new Map(changes.pages.map((p) => [p.page_uid, p]));
    const newOrder = State.pages.map((p) => p.id);
    const nowLive = new Set(newOrder);
    BC.base.order.forEach((u) => {
      if (!nowLive.has(u)) {
        const c = sent.get(u) || BC.base.content.get(u);
        if (c) BC.base.deleted.set(u, { blocks: c.blocks, html: c.html });
      }
    });
    newOrder.forEach((u) => {
      BC.base.deleted.delete(u);
      const s = sent.get(u);
      if (s) BC.base.content.set(u, { blocks: s.blocks, html: s.html });
      else if (!BC.base.content.has(u) && BC.wc.added[u]) BC.base.content.set(u, { blocks: BC.wc.added[u].blocks, html: "" });
    });
    BC.base.order.forEach((u) => { if (!nowLive.has(u)) BC.base.content.delete(u); });
    BC.base.order = newOrder;
    State.pages.forEach((p) => {
      const s = sent.get(p.id);
      if (s) { p.blocks = s.blocks; p.html = s.html; }
      const c = BC.wc.content[p.id];
      if (s && c && same(c.blocks, s.blocks)) delete BC.wc.content[p.id];
      if (!BC.wc.content[p.id]) { State.dirty.delete(p.id); markPageDirty(p.id, false); }
    });
    BC.wc.added = {};
    BC.wc.order = null;
    BC.wc.loaded_sources = (BC.wc.loaded_sources || []).map((s) => ({ ...s, pages: (s.pages || []).filter((u) => !sent.has(u)) }))
      .filter((s) => s.pages.length);
    BC.head = { id: res.revision_id, seq: res.seq };
    BC.wc.base_revision_id = BC.head.id;
    BC.wc.base_seq = BC.head.seq;
    if (!BC.latest || BC.latest.seq < res.seq) BC.latest = { ...BC.head };
    State.book.total_pages = res.total_pages;
  }

  // 응답을 못 받은 저장의 결과 확인
  async function resolvePendingCommit() {
    const pc = BC.wc.pending_commit;
    if (!pc) return "none";
    let r;
    try { r = await C.getRequestResult(BC.book, pc.request_id); } catch (e) {
      if (handleAuthError(e)) return "unknown";
      refreshStatus("저장 결과 확인 실패");
      return "unknown";
    }
    if (!r.found) {
      BC.wc.pending_commit = null;
      await persistNow().catch(storageFailed);
      return "not_found";
    }
    const res = r.result || {};
    if (res.ok && !res.no_change && res.revision_id) {
      // 저장은 됐다. 이 작업창 기준을 서버 상태로 맞추기 위해 다시 연다(가짜 재기준화 없음).
      BC.wc.pending_commit = null;
      const changedNow = Object.keys(BC.wc.content || {}).length;
      // 보낸 내용은 그 저장 버전에 들어갔다. 작업본 기준을 그 버전으로 옮기고(추가 쪽은 이제 기존 쪽), 다시 연다.
      Object.entries(BC.wc.added || {}).forEach(([u, a]) => { if (!BC.wc.content[u]) BC.wc.content[u] = { blocks: a.blocks }; });
      BC.wc.added = {};
      BC.wc.base_revision_id = res.revision_id;
      BC.wc.base_seq = res.seq;
      await persistNow().catch(storageFailed);
      await notice("이전 저장이 확인됐어요", ["응답을 못 받았던 저장(V" + res.seq + ")이 서버에 반영돼 있었어요.",
        changedNow ? "확인을 위해 최신본을 다시 열어요. 남은 작업은 '복구할 작업'에 보관돼요." : "최신본을 다시 열어요."]);
      location.reload();
      return "reloaded";
    }
    BC.wc.pending_commit = null;
    await persistNow().catch(storageFailed);
    return "not_found";
  }

  async function askReauth() {
    const d = await dialog({
      title: "관리자 확인 필요",
      lines: ["로그인이 만료돼 서버 저장·불러오기·수정안 보내기를 멈췄어요.", "입력한 내용은 이 기기에 보관돼 있어요. 기존 관리자 로그인으로 다시 로그인하면 이어서 할 수 있어요."],
      buttons: [{ label: "다시 로그인", value: "login", primary: true }],
      cancelLabel: "나중에",
    });
    if (d && d.choice === "login") await goReauth();
  }

  // ------------------------------------------------------------------
  // 서버 백업
  // ------------------------------------------------------------------
  async function createBackupOfCurrent(title, meta) {
    const changes = await buildChanges();
    if (!changes.pages.length && !changes.structure.length) return null;
    const requestId = C.uuid();
    let res;
    try {
      res = await C.createBackup({ book: BC.book, base: BC.wc.base_revision_id, requestId, title, changes, meta });
    } catch (e) {
      if (e.code === "UNKNOWN_RESULT") res = await C.createBackup({ book: BC.book, base: BC.wc.base_revision_id, requestId, title, changes, meta });
      else throw e;
    }
    if (!res || !res.ok || !res.revision_id) throw new Error("서버 백업 응답이 올바르지 않아요");
    return res.revision_id;
  }

  async function backupAndReload(title) {
    lockUi(true);
    try {
      const id = await createBackupOfCurrent(title, { tab: W.getTabId(), reason: "conflict" });
      if (BC.idbOk) await W.deleteWorking(BC.user.id, BC.book, W.getTabId());
      const u = new URL(location.href);
      if (id) u.searchParams.set("open", id);
      location.href = u.toString();
    } catch (e) {
      if (!handleAuthError(e)) await notice("백업하지 못했어요", [e.message || String(e), "작업은 이 기기에 그대로 있어요."]);
    } finally {
      lockUi(false);
    }
  }

  // 다른 작업창/이전 기준 작업본 → 서버 백업 → 불러오기 화면
  async function recoverRecord(i) {
    const item = BC.recoveries[i];
    if (!item || BC.busy) return;
    lockUi(true);
    try {
      const rec = item.rec;
      const conv = liveHandle();
      let baseOrder, baseDeleted;
      if (rec.base_revision_id === BC.head.id) {
        baseOrder = BC.base.order; baseDeleted = new Set(BC.base.deleted.keys());
      } else if (/^[0-9a-f-]{36}$/.test(rec.base_revision_id)) {
        const b = await C.getRevision(rec.base_revision_id, false);
        baseOrder = (b.manifest || []).filter((m) => !m.is_deleted).map((m) => m.page_uid);
        baseDeleted = new Set((b.manifest || []).filter((m) => m.is_deleted).map((m) => m.page_uid));
      } else {
        throw new Error("이 작업본의 기준을 알 수 없어요. 내용을 텍스트로 확인해 주세요.");
      }
      const pages = [];
      for (const [uid, c] of Object.entries(rec.content || {})) pages.push({ page_uid: uid, blocks: c.blocks, html: await conv.htmlOf(c.blocks), renderer_version: RENDERER });
      for (const [uid, a] of Object.entries(rec.added || {})) {
        if (!rec.content[uid]) pages.push({ page_uid: uid, blocks: a.blocks, html: await conv.htmlOf(a.blocks), renderer_version: RENDERER });
      }
      const order = rec.order || baseOrder;
      const structure = diffStructure(baseOrder, baseDeleted, order, new Set(Object.keys(rec.added || {})));
      const base = /^[0-9a-f-]{36}$/.test(rec.base_revision_id) ? rec.base_revision_id : BC.head.id;
      const res = await C.createBackup({ book: BC.book, base, requestId: rec.recover_request_id || (rec.recover_request_id = C.uuid()),
        title: item.reason + " 보관", changes: { pages, structure }, meta: { tab: rec.tab_id, reason: "recover" } });
      await W.deleteWorking(rec.user_id, rec.book_id, rec.tab_id);
      BC.recoveries.splice(i, 1);
      showRecoveryBar();
      await openPanel();
      await openDetail(res.revision_id);
    } catch (e) {
      if (!handleAuthError(e)) await notice("보관하지 못했어요", [e.message || String(e), "원래 작업본은 지우지 않았어요."]);
    } finally {
      lockUi(false);
    }
  }

  async function importLegacyDrafts() {
    if (BC.busy) return;
    lockUi(true);
    try {
      const conv = liveHandle();
      const live = new Set(BC.base.order);
      const pages = [];
      const seen = new Set();
      for (const d of BC.legacyDrafts) {
        if (!live.has(d.uid) || seen.has(d.uid)) continue;
        seen.add(d.uid);
        pages.push({ page_uid: d.uid, blocks: d.blocks, html: await conv.htmlOf(d.blocks), renderer_version: RENDERER });
      }
      if (!pages.length) { await notice("보관할 임시본이 없어요", ["지금 책에 있는 쪽의 예전 임시본이 없어요."]); return; }
      const res = await C.createBackup({ book: BC.book, base: BC.head.id, requestId: C.uuid(), title: "예전 방식 임시본 가져옴",
        changes: { pages, structure: [] }, meta: { reason: "legacy-drafts", keys: BC.legacyDrafts.length } });
      try { localStorage.setItem("eon_book_legacy_imported_" + BC.book, res.revision_id); } catch (_) {}
      BC.legacyDrafts = [];
      showRecoveryBar();
      await notice("서버 백업으로 보관했어요", ["예전 임시본 " + pages.length + "쪽을 '교체 전 백업'에 보관했어요. 이 기기의 원래 임시본은 지우지 않았어요."]);
    } catch (e) {
      if (!handleAuthError(e)) await notice("보관하지 못했어요", [e.message || String(e)]);
    } finally {
      lockUi(false);
    }
  }

  // ------------------------------------------------------------------
  // 불러오기 (작업창 교체)
  // ------------------------------------------------------------------
  function simulate(order, deletedSet, ops) {
    const arr = order.slice();
    const del = new Set(deletedSet);
    const all = new Set([...arr, ...del]);
    const insertAfter = (uid, after) => {
      if (after == null) { arr.unshift(uid); return; }
      const i = arr.indexOf(after);
      if (i < 0) throw new Error("기준 위치 쪽(" + (pageIndex(after) + 1 || "?") + ")을 지금 작업창에서 찾을 수 없어요.");
      arr.splice(i + 1, 0, uid);
    };
    for (const op of ops || []) {
      const i = arr.indexOf(op.page_uid);
      if (op.op === "add") { if (all.has(op.page_uid)) throw new Error("추가할 쪽이 이미 있어요."); insertAfter(op.page_uid, op.after); all.add(op.page_uid); }
      else if (op.op === "delete") { if (i < 0) throw new Error("지울 쪽이 이미 없어요."); arr.splice(i, 1); del.add(op.page_uid); }
      else if (op.op === "restore") { if (!del.has(op.page_uid)) throw new Error("되살릴 쪽이 삭제 상태가 아니에요."); del.delete(op.page_uid); insertAfter(op.page_uid, op.after); }
      else if (op.op === "move") { if (i < 0) throw new Error("옮길 쪽을 찾을 수 없어요."); arr.splice(i, 1); insertAfter(op.page_uid, op.after); }
    }
    return { order: arr, deleted: del };
  }

  async function loadRevision(revId, mode) {
    if (BC.busy) return;
    if (BC.authLost) { await askReauth(); return; }
    if (!BC.idbOk) { await notice("불러올 수 없어요", ["이 브라우저에 작업본을 안전하게 보관할 수 없어 교체를 멈췄어요."]); return; }
    lockUi(true);
    let transition = null;
    try {
      const full = mode === "full";
      const rev = await C.getRevision(revId, full);
      const fresh = await C.getState(BC.book, false);
      BC.latest = { id: fresh.head_revision_id, seq: fresh.head_seq };
      if (fresh.head_revision_id !== BC.head.id) {
        const d = await dialog({
          title: "화면이 최신이 아니에요",
          lines: ["이 작업창은 V" + BC.head.seq + " 기준인데 서버에는 V" + fresh.head_seq + "이 있어요.",
            "먼저 지금 작업을 백업하고 최신본을 연 다음 다시 불러와 주세요. 기준 번호만 바꾸는 처리는 하지 않아요."],
          buttons: [{ label: "작업 백업하고 최신본 열기", value: "go", primary: true }],
        });
        if (d && d.choice === "go") {
          const id = hasChanges() ? await createBackupOfCurrent("최신본 열기 전 백업", { reason: "stale-view" }) : null;
          if (BC.idbOk) await W.deleteWorking(BC.user.id, BC.book, W.getTabId());
          const u = new URL(location.href);
          u.searchParams.set("open", revId);
          if (id) u.searchParams.set("backup", id);
          location.href = u.toString();
        }
        return;
      }

      // 적용 계획 (아직 아무것도 바꾸지 않음)
      captureMounted();
      syncStructureToWorking();
      const curOrder = State.pages.map((p) => p.id);
      const curDeleted = new Set([...BC.base.deleted.keys(), ...BC.base.order.filter((u) => !curOrder.includes(u))]);
      const content = new Map((rev.pages || []).map((p) => [p.page_uid, p]));
      let ops = [];
      let targetPages = [];
      const notes = [];
      if (full) {
        const target = (rev.manifest || []).filter((m) => !m.is_deleted).map((m) => m.page_uid);
        const targetSet = new Set(target);
        curOrder.forEach((u) => { if (!targetSet.has(u)) ops.push({ op: "delete", page_uid: u }); });
        let prev = null;
        target.forEach((u) => {
          if (curDeleted.has(u)) ops.push({ op: "restore", page_uid: u, after: prev });
          else if (!curOrder.includes(u)) throw new Error("이 버전의 쪽 일부를 지금 책에서 찾을 수 없어요.");
          prev = u;
        });
        const sim0 = simulate(curOrder, curDeleted, ops);
        const finalOrder = sim0.order;
        // 순서까지 맞추기: 남은 차이는 move로
        const moves = diffStructure(finalOrder, new Set(), target, new Set()).filter((o) => o.op === "move");
        ops = ops.concat(moves);
        targetPages = target.filter((u) => content.has(u) && !same(blocksForPage(u), content.get(u).blocks));
        notes.push("책 전체를 V" + rev.seq + " 상태로 바꿔요: 내용 다른 쪽 " + targetPages.length + "개, 쪽 구조 동작 " + ops.length + "개.");
      } else {
        if (rev.manifest_complete) {
          if ((rev.scope.structure || []).length) notes.push("이 저장의 쪽 구조 변경(" + rev.scope.structure.length + "개)은 불러오지 않아요. 필요하면 '책 전체를 이 버전으로'를 쓰세요.");
        } else {
          ops = (rev.scope && rev.scope.structure) || [];
        }
        targetPages = (rev.pages || []).map((p) => p.page_uid);
      }
      if (ops.length && !BC.structureAllowed) throw new Error("공개 중이거나 학생 기록이 있는 책이라 쪽 구조 변경이 들어 있는 버전은 불러올 수 없어요.");
      let sim;
      try { sim = simulate(curOrder, curDeleted, ops); } catch (e) {
        await notice("구조가 달라 불러오지 않았어요", [e.message, "자동으로 다른 자리에 옮기지 않았어요. 지금 작업은 그대로예요."]);
        return;
      }
      const dead = targetPages.filter((u) => !sim.order.includes(u));
      if (dead.length) {
        await notice("삭제된 쪽을 가리켜요", ["이 버전은 지금 삭제된 쪽 " + dead.length + "개의 내용을 바꾸려 해요. 자동으로 되살리지 않았어요.",
          "필요하면 '삭제된 쪽' 탭에서 먼저 되살린 뒤 다시 불러오세요."]);
        return;
      }
      const overlap = targetPages.filter((u) => BC.wc.content[u]);
      const lines = ["현재 수정한 내용은 자동 백업됩니다. 선택한 수정안의 대상 범위로 바꿀까요? 저장을 누르기 전에는 서버 본문이 바뀌지 않습니다."];
      lines.push("대상: " + pageLabelRange(targetPages) + (ops.length ? " · 쪽 구조 동작 " + ops.length + "개" : ""));
      if (rev.base_seq && rev.base_seq !== BC.head.seq && !full) {
        const changed = rev.changed_since_base || [];
        lines.push({ warn: true, text: "이 수정안은 V" + rev.base_seq + " 기준입니다. 이후 저장한 V" + BC.head.seq + "에서 대상 " + changed.length +
          "쪽이 변경됐습니다. 불러오면 해당 쪽은 수정안 내용으로 교체됩니다." });
      }
      if (overlap.length) lines.push({ warn: true, text: "저장 안 한 수정이 있는 " + overlap.length + "쪽이 교체돼요(교체 전 서버 백업)." });
      notes.forEach((n) => lines.push(n));
      lines.push("대상 밖의 쪽과 저장 안 한 수정은 그대로 둬요. 같은 쪽 안의 문장을 합치지는 않아요.");
      const d = await dialog({ title: (full ? "책 전체 바꾸기 · " : "불러오기 · ") + (rev.title || kindLabel(rev)), lines,
        buttons: [{ label: "불러오기", value: "ok", primary: true }] });
      if (!d) { refreshStatus("불러오기 취소 · 바뀐 것 없음"); return; }

      // 1) 교체 전 서버 백업 (미저장 작업이 있을 때)
      let backupId = null;
      if (hasChanges()) {
        setStatus("editing", "교체 전 백업 중…");
        backupId = await createBackupOfCurrent("교체 전 백업 · " + (rev.title || kindLabel(rev)), { reason: "load", revision: revId, tab: W.getTabId() });
      }
      // 2) 전환 기록 먼저
      const before = clone(BC.wc);
      transition = { id: C.uuid(), user_id: BC.user.id, book_id: BC.book, tab_id: W.getTabId(), phase: "started",
        before, revision_id: revId, backup_id: backupId, created_at: new Date().toISOString() };
      await W.putTransition(transition);
      // 3) 바로 전에 head 다시 확인
      const again = await C.getState(BC.book, false);
      if (again.head_revision_id !== BC.head.id) {
        transition.phase = "aborted"; transition.aborted_reason = "head-changed";
        await W.putTransition(transition);
        BC.latest = { id: again.head_revision_id, seq: again.head_seq };
        await notice("불러오지 않았어요", ["그사이 서버에 V" + again.head_seq + "이 저장됐어요. 작업은 그대로예요.",
          backupId ? "교체 전 백업은 이미 서버에 보관됐어요." : ""]);
        return;
      }
      // 4) 새 작업본 만들기
      const after = clone(BC.wc);
      after.generation = (after.generation || 0) + 1;
      after.order = sim.order;
      (ops || []).filter((o) => o.op === "add").forEach((o) => {
        const c = content.get(o.page_uid);
        after.added[o.page_uid] = { blocks: c ? c.blocks : [], html: c ? c.html : "" };
      });
      const hashes = {};
      targetPages.forEach((u) => {
        const c = content.get(u);
        if (!c) return;
        after.content[u] = { blocks: clone(c.blocks) };
        hashes[u] = fingerprint(c.blocks);
      });
      after.loaded_sources = (after.loaded_sources || []).map((s) => ({ ...s, pages: (s.pages || []).filter((u) => !hashes[u]) }))
        .filter((s) => s.pages.length);
      after.loaded_sources.push({ revision_id: rev.id, kind: rev.kind, author_source: rev.author_source, title: rev.title,
        pages: Object.keys(hashes), structure: ops.length > 0, hashes, loaded_at: new Date().toISOString(), backup_id: backupId });
      transition.after = after;
      transition.phase = "applying";
      await W.putTransition(transition);
      // 5) 작업본 보관 → 화면 교체
      const cleanAfter = clone(after);
      Object.keys(cleanAfter.content).forEach((u) => {
        const base = cleanAfter.added[u] ? null : (BC.base.content.get(u) || BC.base.deleted.get(u));
        if (base && same(base.blocks, cleanAfter.content[u].blocks)) delete cleanAfter.content[u];
      });
      if (same(cleanAfter.order, BC.base.order)) cleanAfter.order = null;
      await W.putWorking(cleanAfter);
      applyToScreen(cleanAfter, new Set([...targetPages, ...ops.map((o) => o.page_uid)]), content);
      verifyScreen(cleanAfter, targetPages);
      transition.phase = "complete";
      await W.putTransition(transition);
      W.deleteTransition(transition.id).catch(() => {});
      // 6) 불러오기 기록 (실패해도 작업본은 유지, 나중에 다시 보냄)
      const ev = { id: C.uuid(), user_id: BC.user.id, book_id: BC.book, kind: "load", revision: rev.id, backup: backupId,
        working_copy_id: BC.wc.working_copy_id, device_id: W.deviceId(), tab_id: W.getTabId() };
      await W.putOutbox(ev).catch(() => {});
      flushOutbox();
      closePanel();
      refreshStatus((rev.author_source === "aside" ? "Aside 수정안" : kindLabel(rev)) + " 불러옴");
    } catch (e) {
      console.error(e);
      if (transition && transition.phase !== "complete" && transition.phase !== "aborted") {
        try {
          await W.putWorking(transition.before);
          BC.wc = transition.before;
          applyToScreen(transition.before, null, null);
          transition.phase = "aborted"; transition.aborted_reason = String(e.message || e);
          await W.putTransition(transition);
        } catch (e2) { console.error(e2); }
      }
      if (!handleAuthError(e)) await notice("불러오지 못했어요", [e.message || String(e), "불러오기 전 작업 상태를 유지했어요."]);
    } finally {
      lockUi(false);
      refreshStatus();
    }
  }

  // 작업본 → 화면 (대상 쪽 편집기는 새로 켜서 이전 되돌리기 기록을 지운다)
  function applyToScreen(rec, affected, content) {
    BC.timers.forEach((t) => clearTimeout(t));
    BC.timers.clear();
    BC.wc = rec;
    const prevIds = new Set(State.pages.map((p) => p.id));
    const order = rec.order || BC.base.order;
    const pages = [];
    order.forEach((uid) => {
      const old = State.pages.find((p) => p.id === uid);
      if (rec.added[uid]) pages.push(old && !(affected && affected.has(uid)) ? old : { id: uid, sort_order: 0, blocks: rec.added[uid].blocks, html: rec.added[uid].html || "" });
      else if (old) pages.push(old);
      else {
        const c = BC.base.content.get(uid) || BC.base.deleted.get(uid);
        if (c) pages.push({ id: uid, sort_order: 0, blocks: c.blocks, html: c.html });
      }
    });
    const remount = [];
    State.pages = pages;
    State.dirty.clear();
    Object.keys(rec.content).forEach((u) => State.dirty.add(u));
    Object.keys(rec.added).forEach((u) => State.dirty.add(u));
    const touch = affected || new Set(order.filter((u) => prevIds.has(u)));
    touch.forEach((uid) => {
      const h = State.editors.get(uid);
      if (h) {
        State.suppress.add(uid);
        try { h.unmount(); } catch (_) { try { h.setBlocks(blocksForPage(uid)); } catch (__) {} }
        State.editors.delete(uid);
        remount.push(uid);
      }
      const sec = State.nodes.get(uid);
      if (sec) {
        sec.classList.remove("is-mounted");
        const host = sec.querySelector(".bookedit-mount");
        if (host) host.innerHTML = "";
        const prev = sec.querySelector(".bookedit-preview");
        const c = content && content.get(uid);
        if (prev && c) { prev.innerHTML = c.html || ""; window.BookPageFooter?.decorateReader(prev); }
      }
    });
    renderStack();
    remount.forEach((uid) => { ensureMounted(uid); setTimeout(() => State.suppress.delete(uid), 80); });
    if (State.currentId && pageIndex(State.currentId) < 0) setCurrent(State.pages[0] ? State.pages[0].id : null);
    scheduleOutline();
    refreshPreviews(Array.from(touch).filter((u) => !(content && content.has(u))));
  }

  // 아직 편집기가 안 켜진 쪽의 미리보기를 작업본 내용으로 (오래된 화면이 보이지 않게)
  async function refreshPreviews(uids) {
    const conv = liveHandle();
    if (!conv) return;
    for (const uid of uids || []) {
      if (State.editors.has(uid)) continue;
      const sec = State.nodes.get(uid);
      const prev = sec && sec.querySelector(".bookedit-preview");
      if (!prev) continue;
      try { prev.innerHTML = await conv.htmlOf(blocksForPage(uid)); window.BookPageFooter?.decorateReader(prev); } catch (_) {}
    }
  }

  function verifyScreen(rec, targets) {
    const order = rec.order || BC.base.order;
    if (!same(State.pages.map((p) => p.id), order)) throw new Error("화면 쪽 순서가 작업본과 달라요");
    for (const u of targets) {
      if (!same(blocksForPage(u), (rec.content[u] || rec.added[u] || { blocks: (BC.base.content.get(u) || {}).blocks }).blocks)) {
        throw new Error("화면 내용이 불러온 버전과 달라요 (" + (pageIndex(u) + 1) + "쪽)");
      }
    }
  }

  async function flushOutbox() {
    if (!BC.enabled || !BC.idbOk) return;
    let items = [];
    try { items = await W.listOutbox(BC.user.id, BC.book); } catch (_) { return; }
    for (const it of items) {
      try {
        if (it.kind === "load") {
          await C.recordLoad({ book: it.book_id, eventId: it.id, revision: it.revision, backup: it.backup,
            workingCopyId: it.working_copy_id, deviceId: it.device_id, tabId: it.tab_id });
        }
        await W.deleteOutbox(it.id);
      } catch (e) {
        if (handleAuthError(e)) return;
        if (e.code !== "UNKNOWN_RESULT") { console.warn("불러오기 기록 실패", e); await W.deleteOutbox(it.id).catch(() => {}); }
        else refreshStatus("작업본 불러옴 · 기록 동기화 대기");
        return;
      }
    }
  }

  // ------------------------------------------------------------------
  // 수정안 보내기
  // ------------------------------------------------------------------
  async function submitProposalUi() {
    if (BC.busy) return;
    if (BC.authLost) { await askReauth(); return; }
    let changes;
    try { changes = await buildChanges(); } catch (e) { await notice("보낼 수 없어요", [e.message]); return; }
    if (!changes.pages.length && !changes.structure.length) { await notice("보낼 변경이 없어요", ["이 작업창에서 바꾼 쪽이 없어요."]); return; }
    const isAside = new URLSearchParams(location.search).get("author") === "aside";
    const d = await dialog({
      title: "현재 변경을 수정안으로 보내기",
      lines: ["서버 본문·기준 버전·공개 상태는 바뀌지 않아요. 대표가 '버전'에서 확인하고 불러올 수 있어요.",
        "대상: " + pageLabelRange(changes.pages.map((p) => p.page_uid)) + (changes.structure.length ? " · 쪽 구조 동작 " + changes.structure.length + "개" : "")],
      fields: [
        { name: "title", label: "제목", value: "", maxLength: 200 },
        { name: "summary", label: "요약", type: "textarea", value: "", maxLength: 2000 },
        { name: "author", label: "작성 출처", type: "select", value: isAside ? "aside" : "admin",
          options: [{ value: "admin", label: "대표" }, { value: "aside", label: "Aside" }] },
      ],
      buttons: [{ label: "수정안 보내기", value: "send", primary: true }],
    });
    if (!d) return;
    const r = await submitProposal({ changes, title: d.values.title, summary: d.values.summary, authorSource: d.values.author });
    if (!r) return;
    const d2 = await dialog({
      title: "수정안을 보냈어요",
      lines: ["'" + (d.values.title || "제목 없음") + "' · " + pageLabelRange(r.pages || []) + " · 기준 V" + BC.head.seq,
        "서버에서 다시 읽어 확인했어요. 이 작업창의 변경은 아직 남아 있어요."],
      buttons: [{ label: "이 작업창 변경 비우기", value: "clear", danger: true }],
      cancelLabel: "그대로 두기",
    });
    if (d2 && d2.choice === "clear") discardWorking();
  }

  async function submitProposal({ changes, title, summary, authorSource, meta }) {
    lockUi(true);
    try {
      const requestId = C.uuid();
      const args = { book: BC.book, base: BC.head.id, requestId, title, summary, changes, authorSource: authorSource || "aside", meta };
      let res;
      try { res = await C.submitProposal(args); } catch (e) {
        if (e.code === "UNKNOWN_RESULT") res = await C.submitProposal(args); else throw e;
      }
      const check = await C.getRevision(res.revision_id, false);
      if (!check || check.kind !== "proposal" || (check.pages || []).length !== changes.pages.length) throw new Error("보낸 수정안을 다시 확인하지 못했어요");
      BC.revisions = [];
      refreshStatus("수정안 보냄");
      return { ...res, verified: true };
    } catch (e) {
      if (!handleAuthError(e)) await notice("보내지 못했어요", [e.message || String(e), "작업은 그대로예요."]);
      return null;
    } finally {
      lockUi(false);
    }
  }

  function discardWorking() {
    const rec = emptyWorking();
    rec.working_copy_id = BC.wc.working_copy_id;
    rec.generation = (BC.wc.generation || 0) + 1;
    const touched = new Set([...Object.keys(BC.wc.content), ...Object.keys(BC.wc.added)]);
    const content = new Map();
    touched.forEach((u) => { const c = BC.base.content.get(u); if (c) content.set(u, c); });
    State.pages = State.pages.filter((p) => !BC.wc.added[p.id]);
    applyToScreen(rec, touched, content);
    persistNow().catch(storageFailed);
    refreshStatus("작업창 변경 비움");
  }

  // Aside용: 블록만 주면 HTML을 이 편집기로 만들어 수정안 등록 (본문·저장과 무관)
  async function apiSubmitProposal(input) {
    if (!BC.enabled) throw new Error("협업이 켜진 책이 아니에요");
    const conv = liveHandle();
    const pages = [];
    for (const p of input.pages || []) {
      pages.push({ page_uid: p.page_uid, blocks: p.blocks, html: p.html != null ? p.html : await conv.htmlOf(p.blocks), renderer_version: RENDERER });
    }
    const r = await submitProposal({ changes: { pages, structure: input.structure || [] }, title: input.title || "", summary: input.summary || "",
      authorSource: input.author_source || "aside", meta: input.meta || null });
    if (!r) throw new Error("수정안 등록 실패");
    return r;
  }

  // ------------------------------------------------------------------
  // 버전 패널
  // ------------------------------------------------------------------
  function setPanelHead(text) {
    const h = document.querySelector("#versionModal .bookedit-modal-head h2");
    if (h) h.innerHTML = '<i class="fas fa-clock-rotate-left"></i> ' + esc(text);
  }

  async function openPanel() {
    const modal = document.getElementById("versionModal");
    modal.classList.add("open");
    modal.querySelector(".bookedit-modal").classList.add("bc-panel");
    setPanelHead("수정안·저장 이력");
    await renderPanel();
  }
  function closePanel() { document.getElementById("versionModal").classList.remove("open"); }

  function proposalState(r) {
    if ((BC.wc.loaded_sources || []).some((s) => s.revision_id === r.id && s.pages.length)) return { cls: "loaded", text: "이 작업창에 불러옴 · 저장 전" };
    if (r.used_in && r.used_in.length) {
      const u = r.used_in[r.used_in.length - 1];
      const edited = (u.links || []).some((l) => l.mode === "edited");
      return { cls: "used", text: "저장에 사용됨 V" + u.seq + (edited ? " · 수정 후 반영" : " · 그대로 반영") };
    }
    if (r.kind === "proposal") return r.seen ? { cls: "seen", text: "확인함" } : { cls: "new", text: "새 수정안" };
    return null;
  }

  async function renderPanel() {
    const body = document.getElementById("versionList");
    const tabs = [["history", "수정안·저장 이력"], ["backup", "교체 전 백업"], ["legacy", "이전 쪽별 기록"], ["deleted", "삭제된 쪽"]];
    body.innerHTML =
      '<div class="bc-tabs">' + tabs.map(([k, l]) => '<button class="bc-tab' + (BC.panelTab === k ? " on" : "") + '" data-tab="' + k + '">' + l + "</button>").join("") + "</div>" +
      '<div class="bc-actions"><span class="bc-head-info">서버 기준 V' + BC.head.seq + (BC.latest && BC.latest.seq > BC.head.seq ? " · 서버 최신 V" + BC.latest.seq : "") + "</span>" +
      '<button class="btn-secondary" data-act="propose"><i class="fas fa-paper-plane"></i> 현재 변경을 수정안으로 보내기</button></div>' +
      '<div class="bc-list" id="bcList"><div class="bookedit-empty">불러오는 중…</div></div>';
    body.onclick = async (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) { BC.panelTab = t.dataset.tab; await renderPanel(); return; }
      const a = e.target.closest("[data-act]");
      if (!a) return;
      if (a.dataset.act === "propose") await submitProposalUi();
      if (a.dataset.act === "detail") await openDetail(a.dataset.id);
      if (a.dataset.act === "legacy") await loadLegacyVersion(a.dataset.id);
      if (a.dataset.act === "restore") restoreDeletedPage(a.dataset.id);
    };
    const list = document.getElementById("bcList");
    try {
      if (BC.panelTab === "legacy") return renderLegacy(list);
      if (BC.panelTab === "deleted") return renderDeleted(list);
      const all = await C.listRevisions(BC.book, 120);
      BC.revisions = all;
      BC.unread = all.filter((r) => r.kind === "proposal" && !r.seen).length;
      refreshStatus();
      const rows = all.filter((r) => (BC.panelTab === "backup" ? r.kind === "backup" : r.kind !== "backup"));
      if (!rows.length) { list.innerHTML = '<div class="bookedit-empty">' + (BC.panelTab === "backup" ? "교체 전 백업이 없어요." : "아직 이력이 없어요.") + "</div>"; return; }
      list.innerHTML = "";
      rows.forEach((r) => {
        const st = proposalState(r);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "bc-item" + (r.kind === "proposal" && !r.seen ? " is-new" : "") + (r.id === BC.head.id ? " is-head" : "");
        row.dataset.act = "detail";
        row.dataset.id = r.id;
        const scope = r.kind === "baseline" ? "책 전체" : pageLabelRange(r.scope_pages) + (r.structure_count ? " · 구조 " + r.structure_count : "");
        row.innerHTML =
          '<span class="bc-kind bc-kind-' + r.kind + '">' + esc(kindLabel(r)) + "</span>" +
          '<span class="bc-item-main"><span class="bc-item-title"></span>' +
          '<span class="bc-item-meta"></span></span>' +
          (st ? '<span class="bc-chip bc-chip-' + st.cls + '">' + esc(st.text) + "</span>" : "") +
          (r.id === BC.head.id ? '<span class="bc-chip bc-chip-head">현재 서버 기준</span>' : "");
        row.querySelector(".bc-item-title").textContent = r.title || (r.kind === "baseline" ? "기존 저장본 가져옴" : "제목 없음");
        row.querySelector(".bc-item-meta").textContent = authorLabel(r) + " · " + fmtTime(r.created_at) + " · " + scope +
          (r.base_seq ? " · 기준 V" + r.base_seq : "");
        list.appendChild(row);
      });
    } catch (e) {
      if (handleAuthError(e)) { list.innerHTML = '<div class="bookedit-empty">관리자 확인이 필요해요.</div>'; return; }
      list.innerHTML = '<div class="bookedit-empty">이력을 불러오지 못했어요.<br>' + esc(e.message) + "</div>";
    }
  }

  async function openDetail(id) {
    const body = document.getElementById("versionList");
    body.innerHTML = '<div class="bookedit-empty">불러오는 중…</div>';
    let r;
    try {
      r = await C.getRevision(id, false);
      if (!r.seen) { await C.markSeen(id).catch(() => {}); BC.unread = Math.max(0, BC.unread - (r.kind === "proposal" ? 1 : 0)); refreshStatus(); }
    } catch (e) {
      if (handleAuthError(e)) { body.innerHTML = '<div class="bookedit-empty">관리자 확인이 필요해요.</div>'; return; }
      body.innerHTML = '<div class="bookedit-empty">상세를 불러오지 못했어요.<br>' + esc(e.message) + "</div>";
      return;
    }
    setPanelHead(kindLabel(r));
    const meta = BC.revisions.find((x) => x.id === id) || {};
    const st = proposalState({ ...meta, ...r, used_in: meta.used_in || [] });
    const scopePages = (r.scope && r.scope.pages) || [];
    const lines = [];
    lines.push(authorLabel(r) + (r.author_source === "aside" ? " · 등록 계정 " + (r.submitted_label || "대표") : r.submitted_label ? " · " + r.submitted_label : ""));
    lines.push("서버 시각 " + new Date(r.created_at).toLocaleString("ko-KR"));
    if (r.base_seq) lines.push("기준 V" + r.base_seq + (r.base_seq !== BC.head.seq ? " (지금 작업창 기준 V" + BC.head.seq + ")" : ""));
    const structure = (r.scope && r.scope.structure) || [];
    const warn = [];
    if ((r.changed_since_base || []).length) warn.push("기준 이후 V" + r.head_seq + "까지 대상 " + r.changed_since_base.length + "쪽이 바뀌었어요. 불러오면 그 쪽은 이 버전 내용으로 교체돼요.");
    const canLoad = r.kind !== "baseline" || false;
    body.innerHTML =
      '<button class="btn-ghost bc-back" data-act="back"><i class="fas fa-arrow-left"></i> 목록</button>' +
      '<div class="bc-detail">' +
        '<div class="bc-detail-title"></div>' +
        (st ? '<span class="bc-chip bc-chip-' + st.cls + '">' + esc(st.text) + "</span>" : "") +
        '<div class="bc-detail-summary"></div>' +
        '<ul class="bc-detail-meta">' + lines.map((l) => "<li>" + esc(l) + "</li>").join("") +
          "<li>" + esc((r.kind === "baseline" ? "책 전체 " + (r.manifest || []).filter((m) => !m.is_deleted).length + "쪽" : pageLabelRange(scopePages)) +
            (structure.length ? " · 쪽 구조 동작 " + structure.length + "개" : "")) + "</li></ul>" +
        warn.map((w) => '<p class="bc-warn">' + esc(w) + "</p>").join("") +
        '<div class="bc-detail-pages"></div>' +
        '<div class="bc-detail-actions">' +
          (canLoad ? '<button class="btn-grad" data-act="load">이 작업창에 불러오기</button>' : "") +
          (r.manifest_complete ? '<button class="btn-secondary" data-act="full">책 전체를 이 버전으로</button>' : "") +
        "</div>" +
        '<p class="bc-hint">불러오기는 이 작업창만 바꿔요. 서버 본문은 저장을 눌러야 바뀌고, 공개 여부는 바뀌지 않아요.</p>' +
      "</div>";
    body.querySelector(".bc-detail-title").textContent = r.title || kindLabel(r);
    body.querySelector(".bc-detail-summary").textContent = r.summary || "";
    const pl = body.querySelector(".bc-detail-pages");
    (r.pages || []).slice(0, 40).forEach((p) => {
      const li = document.createElement("div");
      li.className = "bc-page-row";
      const n = pageIndex(p.page_uid) + 1;
      li.textContent = (n > 0 ? n + "쪽" : "새 쪽/목록 밖") + " · " + (firstText(p.blocks) || "(빈 쪽)") +
        ((r.changed_since_base || []).includes(p.page_uid) ? " · 기준 이후 바뀜" : "") +
        (BC.wc.content[p.page_uid] ? " · 이 작업창에서 수정 중" : "");
      pl.appendChild(li);
    });
    if ((r.pages || []).length > 40) pl.insertAdjacentHTML("beforeend", '<div class="bc-page-row">… 외 ' + (r.pages.length - 40) + "쪽</div>");
    body.onclick = async (e) => {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      if (a.dataset.act === "back") { setPanelHead("수정안·저장 이력"); await renderPanel(); }
      if (a.dataset.act === "load") await loadRevision(r.id, "scope");
      if (a.dataset.act === "full") await loadRevision(r.id, "full");
    };
  }

  async function renderLegacy(list) {
    const pid = State.currentId;
    const n = pageIndex(pid) + 1;
    const rows = await supabaseAPI.query("tr_book_page_versions", { page_id: "eq." + pid, order: "created_at.desc", limit: "30",
      select: "id,created_at,created_by" });
    if (!rows || !rows.length) { list.innerHTML = '<div class="bookedit-empty">' + n + "쪽의 이전 쪽별 기록이 없어요.</div>"; return; }
    list.innerHTML = '<p class="bc-hint">협업 전 저장 방식에서 남은 ' + n + "쪽 기록이에요. 불러오면 이 쪽만 바뀌고(저장 전), 미저장 작업은 먼저 서버에 백업돼요.</p>";
    rows.forEach((v) => {
      const row = document.createElement("div");
      row.className = "bookedit-version-item";
      row.innerHTML = '<div><div class="bookedit-version-when">' + esc(new Date(v.created_at).toLocaleString("ko-KR")) + '</div><div class="bookedit-version-who"></div></div>' +
        '<button class="btn-secondary" data-act="legacy" data-id="' + esc(v.id) + '">이 쪽에 불러오기</button>';
      row.querySelector(".bookedit-version-who").textContent = v.created_by || "-";
      list.appendChild(row);
    });
  }

  async function loadLegacyVersion(versionId) {
    if (BC.busy) return;
    const pid = State.currentId;
    const rows = await supabaseAPI.query("tr_book_page_versions", { id: "eq." + versionId, select: "id,page_id,blocks" });
    const v = rows && rows[0];
    if (!v || v.page_id !== pid) return;
    const d = await dialog({ title: (pageIndex(pid) + 1) + "쪽을 이전 기록으로", lines: ["이 쪽만 바꿔요. 저장을 누르기 전에는 서버 본문이 바뀌지 않아요.",
      hasChanges() ? "지금 미저장 작업은 먼저 서버에 백업돼요." : ""], buttons: [{ label: "불러오기", value: "ok", primary: true }] });
    if (!d) return;
    lockUi(true);
    try {
      if (hasChanges()) await createBackupOfCurrent("교체 전 백업 · 이전 쪽별 기록", { reason: "legacy-version", page: pid });
      const rec = clone(BC.wc);
      rec.generation = (rec.generation || 0) + 1;
      rec.content[pid] = { blocks: Array.isArray(v.blocks) ? v.blocks : [] };
      await W.putWorking(rec);
      applyToScreen(rec, new Set([pid]), null);
      closePanel();
      refreshStatus("이전 쪽별 기록 불러옴");
    } catch (e) {
      if (!handleAuthError(e)) await notice("불러오지 못했어요", [e.message || String(e)]);
    } finally { lockUi(false); }
  }

  function renderDeleted(list) {
    const live = new Set(State.pages.map((p) => p.id));
    const items = [];
    BC.base.deleted.forEach((c, uid) => { if (!live.has(uid)) items.push({ uid, c, saved: true }); });
    BC.base.order.forEach((uid) => { if (!live.has(uid)) items.push({ uid, c: BC.base.content.get(uid), saved: false }); });
    if (!items.length) { list.innerHTML = '<div class="bookedit-empty">삭제된 쪽이 없어요.</div>'; return; }
    list.innerHTML = '<p class="bc-hint">되살리면 같은 쪽 ID로 지금 보고 있는 쪽 뒤에 들어가요(저장 전).</p>';
    items.forEach((it) => {
      const row = document.createElement("div");
      row.className = "bookedit-version-item";
      row.innerHTML = '<div><div class="bookedit-version-when"></div><div class="bookedit-version-who">' + (it.saved ? "서버에서 삭제됨" : "이 작업창에서 삭제 · 저장 전") + "</div></div>" +
        '<button class="btn-secondary" data-act="restore" data-id="' + esc(it.uid) + '">되살리기</button>';
      row.querySelector(".bookedit-version-when").textContent = firstText(it.c && it.c.blocks) || "(빈 쪽)";
      list.appendChild(row);
    });
  }

  function restoreDeletedPage(uid) {
    if (!canChangeStructure()) return;
    const c = BC.base.deleted.get(uid) || BC.base.content.get(uid);
    if (!c || pageIndex(uid) >= 0) return;
    const at = Math.max(0, pageIndex(State.currentId) + 1);
    State.pages.splice(at, 0, { id: uid, sort_order: 0, blocks: c.blocks, html: c.html });
    renderStack();
    structureChanged();
    renderPanel();
    goToPage(uid);
  }

  // ------------------------------------------------------------------
  // 알림 갱신 (보일 때만 약 30초 간격, 본문은 자동으로 바꾸지 않음)
  // ------------------------------------------------------------------
  async function poll() {
    if (!BC.enabled || document.visibilityState !== "visible" || !navigator.onLine || BC.busy) return;
    try {
      const st = await C.getState(BC.book, false);
      BC.latest = { id: st.head_revision_id, seq: st.head_seq };
      BC.unread = st.unread_proposals || 0;
      BC.structureAllowed = st.structure_allowed !== false;
      if (BC.authLost) BC.authLost = false;
      refreshStatus();
      flushOutbox();
    } catch (e) { handleAuthError(e); }
  }
  function startPolling() {
    clearInterval(BC.pollTimer);
    BC.pollTimer = setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") poll(); });
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
  }

  window.BookCollab = {
    get enabled() { return BC.enabled; },
    detect, loadPages, afterRender, onChange, blocksForPage, canChangeStructure, structureChanged,
    save, openPanel, closePanel, openDetail, loadRevision,
    // 시험·Aside용 (같은 화면 경로를 사용)
    api: {
      state: () => ({ enabled: BC.enabled, head: BC.head, latest: BC.latest, unread: BC.unread, changed: changedPageIds(),
        structureDiffers: structureDiffers(), loaded: (BC.wc && BC.wc.loaded_sources) || [], busy: BC.busy, authLost: BC.authLost,
        idbOk: BC.idbOk, recoveries: BC.recoveries.length, tab: W.getTabId() }),
      submitProposal: apiSubmitProposal,
      buildChanges,
      diffStructure,
    },
  };
})();
