// =====================================================================
// 입문서 버전 협업 — 서버 통신 (관리자 Auth 세션 + 전용 RPC)
//
// * 기존 supabaseAPI(공용 anon 키)와 분리한다. 협업 RPC는 검증된 관리자 JWT로만 부른다.
// * 세션은 기존 관리자 로그인 화면(login.html)에서만 만든다. 별도 교재 로그인 화면은 없다.
// * 쓰기 RPC는 모두 요청 번호(request_id)를 가지므로, 응답을 못 받으면 "결과 불명"으로 처리하고
//   같은 번호로 결과를 다시 확인한다(중복 저장 없음).
// =====================================================================
(function () {
  "use strict";

  const SESSION_KEY = "eon_book_auth_v1";
  const REFRESH_MARGIN_SEC = 90;
  const TIMEOUT_MS = 45000;

  class CollabError extends Error {
    constructor(code, message, extra) {
      super(message || code);
      this.code = code;
      Object.assign(this, extra || {});
    }
  }

  function baseUrl() { return typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : ""; }
  function anonKey() { return typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : ""; }

  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.access_token && s.refresh_token && s.user && s.user.id) return s;
    } catch (_) {}
    return null;
  }
  function writeSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }
  function sessionFromAuthResponse(body) {
    if (!body || !body.access_token || !body.user) return null;
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at || (now + (body.expires_in || 3600)),
      user: { id: body.user.id, email: body.user.email || "" },
    };
  }

  async function authRequest(grant, payload) {
    const resp = await fetch(baseUrl() + "/auth/v1/token?grant_type=" + grant, {
      method: "POST",
      headers: { apikey: anonKey(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await resp.json(); } catch (_) {}
    if (!resp.ok) {
      throw new CollabError("AUTH_FAILED", (body && (body.error_description || body.msg || body.message)) || ("인증 실패 (" + resp.status + ")"));
    }
    return body;
  }

  // 기존 관리자 로그인 폼에서만 호출 (login.js)
  async function signInWithPassword(email, password) {
    const body = await authRequest("password", { email, password });
    const s = sessionFromAuthResponse(body);
    if (!s) throw new CollabError("AUTH_FAILED", "인증 응답이 올바르지 않아요");
    writeSession(s);
    return s;
  }

  let refreshing = null;
  async function refreshSession() {
    const s = readSession();
    if (!s) return null;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const body = await authRequest("refresh_token", { refresh_token: s.refresh_token });
          const ns = sessionFromAuthResponse(body);
          if (!ns || ns.user.id !== s.user.id) { writeSession(null); return null; }
          writeSession(ns);
          return ns;
        } catch (e) {
          // 네트워크 오류는 세션을 지우지 않는다(다시 시도 가능). 인증 거부만 세션 종료.
          if (e && e.code === "AUTH_FAILED") writeSession(null);
          return null;
        } finally {
          setTimeout(() => { refreshing = null; }, 0);
        }
      })();
    }
    return refreshing;
  }

  async function validSession() {
    let s = readSession();
    if (!s) return null;
    const now = Math.floor(Date.now() / 1000);
    if (!s.expires_at || s.expires_at - now < REFRESH_MARGIN_SEC) s = await refreshSession();
    return s;
  }

  function signOut() { writeSession(null); }

  function parseRpcError(status, body) {
    const msg = (body && (body.message || body.msg || body.hint)) || ("서버 오류 (" + status + ")");
    const m = /^(BOOK_COLLAB_[A-Z_]+)/.exec(msg);
    let code = m ? m[1].replace("BOOK_COLLAB_", "") : "SERVER";
    if (status === 401 || /JWT|jwt/.test(msg) || (body && body.code === "PGRST301")) code = "AUTH_REQUIRED";
    if (status === 403 && !m) code = "FORBIDDEN";
    const text = msg.replace(/^BOOK_COLLAB_[A-Z_]+:\s*/, "");
    return new CollabError(code, text, { status });
  }

  // 서버 로그인 세션이 있으면 그것으로, 없으면 기존 관리자 화면과 같은 공용 키로 부른다.
  // (책이 'jwt' 방식이면 서버가 AUTH_REQUIRED로 거부한다 — 사이트 보안 작업 뒤 사용)
  async function rpc(name, args, opts) {
    const o = opts || {};
    let s = await validSession();
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeout || TIMEOUT_MS);
      let resp;
      try {
        resp = await fetch(baseUrl() + "/rest/v1/rpc/" + name, {
          method: "POST",
          headers: {
            apikey: anonKey(),
            Authorization: "Bearer " + (s ? s.access_token : anonKey()),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args || {}),
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        // 요청이 서버에 닿았는지 알 수 없음
        throw new CollabError("UNKNOWN_RESULT", "서버 응답을 받지 못했어요", { cause: e });
      }
      clearTimeout(timer);
      const text = await resp.text().catch(() => "");
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) {}
      if (resp.ok) return body;
      const err = parseRpcError(resp.status, body);
      if (err.code === "AUTH_REQUIRED" && attempt === 0 && s) {
        s = await refreshSession();
        if (s) continue;
      }
      if (resp.status >= 500 && !/^BOOK_COLLAB_/.test((body && body.message) || "")) {
        // 서버 내부 오류: 트랜잭션은 롤백됐을 가능성이 높지만 확정하지 않는다
        err.code = err.code === "SERVER" ? "UNKNOWN_RESULT" : err.code;
      }
      throw err;
    }
    throw new CollabError("AUTH_REQUIRED", "관리자 확인이 필요해요");
  }

  // 익명 호출 가능한 상태 조회 (행을 만들지 않음)
  async function status(bookIds) {
    const resp = await fetch(baseUrl() + "/rest/v1/rpc/book_collab_status", {
      method: "POST",
      headers: { apikey: anonKey(), Authorization: "Bearer " + anonKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_book_ids: bookIds }),
    });
    if (resp.status === 404) return {}; // 마이그레이션 전: 모든 책이 기존 방식
    if (!resp.ok) {
      let body = null;
      try { body = await resp.json(); } catch (_) {}
      // 함수 없음(PGRST202)도 기존 방식으로 본다
      if (body && (body.code === "PGRST202" || body.code === "42883")) return {};
      throw parseRpcError(resp.status, body);
    }
    return (await resp.json()) || {};
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  window.BookRevisionClient = {
    CollabError,
    SESSION_KEY,
    readSession,
    validSession,
    signInWithPassword,
    signOut,
    status,
    uuid,
    getState: (book, includePages) => rpc("book_collab_get_state", { p_book: book, p_include_pages: includePages !== false }),
    listRevisions: (book, limit) => rpc("book_collab_list_revisions", { p_book: book, p_limit: limit || 80 }),
    getRevision: (id, includeAll) => rpc("book_collab_get_revision", { p_revision: id, p_include_all: !!includeAll }),
    commit: (a) => rpc("book_collab_commit", {
      p_book: a.book, p_expected_head: a.expectedHead, p_request_id: a.requestId, p_changes: a.changes,
      p_title: a.title || "", p_summary: a.summary || "", p_source_links: a.sourceLinks || [],
    }, { timeout: 90000 }),
    submitProposal: (a) => rpc("book_collab_submit_proposal", {
      p_book: a.book, p_base_revision: a.base, p_request_id: a.requestId, p_title: a.title || "",
      p_summary: a.summary || "", p_changes: a.changes, p_author_source: a.authorSource || "aside", p_meta: a.meta || null,
    }, { timeout: 90000 }),
    createBackup: (a) => rpc("book_collab_create_backup", {
      p_book: a.book, p_base_revision: a.base, p_request_id: a.requestId, p_title: a.title || "교체 전 백업",
      p_changes: a.changes, p_meta: a.meta || null,
    }, { timeout: 90000 }),
    getRequestResult: (book, requestId) => rpc("book_collab_get_request_result", { p_book: book, p_request_id: requestId }),
    markSeen: (id) => rpc("book_collab_mark_seen", { p_revision: id }),
    recordLoad: (a) => rpc("book_collab_record_load", {
      p_book: a.book, p_event_id: a.eventId, p_revision: a.revision, p_backup_revision: a.backup || null,
      p_working_copy_id: a.workingCopyId || "", p_device_id: a.deviceId || "", p_tab_id: a.tabId || "",
    }),
    updateMetadata: (book, requestId, patch) => rpc("book_collab_update_metadata", { p_book: book, p_request_id: requestId, p_patch: patch }),
  };
})();
