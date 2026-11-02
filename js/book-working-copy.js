// =====================================================================
// 입문서 버전 협업 — 브라우저 작업본 보관 (IndexedDB)
//
// * 작업본 = 서버 기준 버전(base) + 이 작업창에서 바꾼 쪽 내용 + 쪽 순서. 계정·책·작업창별로 따로 보관.
// * 수정안 불러오기처럼 작업본을 통째로 바꿀 때는 전환 기록(before/after)을 먼저 남긴다.
//   중간에 창이 닫히면 다음 진입 때 before로 되돌린다.
// * 서버로 보낼 기록(불러오기 완료 기록)은 outbox에 두고 성공할 때까지 다시 보낸다.
// =====================================================================
(function () {
  "use strict";

  const DB_NAME = "eon-book-collab";
  const DB_VERSION = 1;
  const DEVICE_KEY = "eon_book_device_id";
  const TAB_KEY = "eon_book_tab_id";
  let dbPromise = null;

  function uuid() { return window.BookRevisionClient ? window.BookRevisionClient.uuid() : String(Date.now()) + Math.random(); }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) { reject(new Error("이 브라우저는 작업본 보관(IndexedDB)을 지원하지 않아요")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("working")) {
          db.createObjectStore("working", { keyPath: "key" }).createIndex("ub", "ub");
        }
        if (!db.objectStoreNames.contains("transitions")) {
          db.createObjectStore("transitions", { keyPath: "id" }).createIndex("ub", "ub");
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id" }).createIndex("ub", "ub");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("작업본 보관소를 열 수 없어요"));
      req.onblocked = () => reject(new Error("다른 창이 작업본 보관소를 쓰고 있어요"));
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(out && out.__req ? out.__req.result : out);
      t.onerror = () => reject(t.error || new Error("작업본 저장 실패"));
      t.onabort = () => reject(t.error || new Error("작업본 저장이 취소됐어요 (저장 공간 부족일 수 있어요)"));
    }));
  }
  const wrap = (req) => ({ __req: req });

  function getAll(store, ub) {
    return tx(store, "readonly", (s) => wrap(s.index("ub").getAll(ub)));
  }

  // ----- 기기·작업창 식별 -----
  function deviceId() {
    let v = null;
    try { v = localStorage.getItem(DEVICE_KEY); } catch (_) {}
    if (!v) { v = uuid(); try { localStorage.setItem(DEVICE_KEY, v); } catch (_) {} }
    return v;
  }

  let tabId = null;
  const nonce = uuid();
  let channel = null;
  function ensureChannel() {
    if (channel || !("BroadcastChannel" in window)) return channel;
    channel = new BroadcastChannel("eon-book-collab-tabs");
    channel.addEventListener("message", (ev) => {
      const m = ev.data || {};
      if (m.type === "hello" && m.tab === tabId && m.nonce !== nonce) {
        channel.postMessage({ type: "taken", tab: tabId, nonce: m.nonce });
      } else if (m.type === "ping" && tabId) {
        channel.postMessage({ type: "pong", tab: tabId, ask: m.ask });
      }
    });
    return channel;
  }

  // 탭 복제 시 sessionStorage가 복사돼 같은 ID가 생길 수 있다 → 새 ID 발급
  async function claimTab() {
    try { tabId = sessionStorage.getItem(TAB_KEY); } catch (_) {}
    const ch = ensureChannel();
    let duplicated = false;
    if (tabId && ch) {
      await new Promise((resolve) => {
        const onMsg = (ev) => { const m = ev.data || {}; if (m.type === "taken" && m.nonce === nonce) { duplicated = true; } };
        ch.addEventListener("message", onMsg);
        ch.postMessage({ type: "hello", tab: tabId, nonce });
        setTimeout(() => { ch.removeEventListener("message", onMsg); resolve(); }, 300);
      });
    }
    const previous = tabId;
    if (!tabId || duplicated) {
      tabId = uuid();
      try { sessionStorage.setItem(TAB_KEY, tabId); } catch (_) {}
    }
    return { tabId, duplicatedFrom: duplicated ? previous : null };
  }

  async function aliveTabs() {
    const ch = ensureChannel();
    const alive = new Set();
    if (!ch) return alive;
    const ask = uuid();
    await new Promise((resolve) => {
      const onMsg = (ev) => { const m = ev.data || {}; if (m.type === "pong" && m.ask === ask && m.tab !== tabId) alive.add(m.tab); };
      ch.addEventListener("message", onMsg);
      ch.postMessage({ type: "ping", ask });
      setTimeout(() => { ch.removeEventListener("message", onMsg); resolve(); }, 300);
    });
    return alive;
  }

  // ----- 작업본 -----
  const keyOf = (user, book, tab) => user + "|" + book + "|" + tab;
  const ubOf = (user, book) => user + "|" + book;

  function getWorking(user, book, tab) {
    return tx("working", "readonly", (s) => wrap(s.get(keyOf(user, book, tab))));
  }
  function putWorking(rec) {
    rec.key = keyOf(rec.user_id, rec.book_id, rec.tab_id);
    rec.ub = ubOf(rec.user_id, rec.book_id);
    rec.saved_at = new Date().toISOString();
    return tx("working", "readwrite", (s) => { s.put(rec); }).then(() => rec);
  }
  function deleteWorking(user, book, tab) {
    return tx("working", "readwrite", (s) => { s.delete(keyOf(user, book, tab)); });
  }
  function listWorking(user, book) { return getAll("working", ubOf(user, book)); }

  // ----- 전환 기록 -----
  function putTransition(t) {
    t.ub = ubOf(t.user_id, t.book_id);
    t.updated_at = new Date().toISOString();
    return tx("transitions", "readwrite", (s) => { s.put(t); }).then(() => t);
  }
  async function incompleteTransitions(user, book, tab) {
    const all = await getAll("transitions", ubOf(user, book));
    return (all || []).filter((t) => t.tab_id === tab && t.phase !== "complete" && t.phase !== "aborted");
  }
  function deleteTransition(id) { return tx("transitions", "readwrite", (s) => { s.delete(id); }); }

  // ----- 보낼 기록 -----
  function putOutbox(item) {
    item.ub = ubOf(item.user_id, item.book_id);
    return tx("outbox", "readwrite", (s) => { s.put(item); }).then(() => item);
  }
  function listOutbox(user, book) { return getAll("outbox", ubOf(user, book)); }
  function deleteOutbox(id) { return tx("outbox", "readwrite", (s) => { s.delete(id); }); }

  window.BookWorkingCopy = {
    open, deviceId, claimTab, aliveTabs,
    getTabId: () => tabId,
    getWorking, putWorking, deleteWorking, listWorking,
    putTransition, incompleteTransitions, deleteTransition,
    putOutbox, listOutbox, deleteOutbox,
    channel: () => ensureChannel(),
  };
})();
