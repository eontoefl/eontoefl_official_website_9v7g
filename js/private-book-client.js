/* Private books only. Authorization is enforced by Auth + server allowlist/RLS, never legacy identity. */
(function (global) {
  'use strict';
  const enabled = new URLSearchParams(location.search).get('private') === '1' || /admin-(private-books|book-preview)\.html$/.test(location.pathname);
  if (!enabled) return;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const bucket = 'book-private';
  const origin = new URL(SUPABASE_URL).origin;
  const client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storageKey: 'eontoefl-private-book-auth-v1', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const tables = Object.freeze({ tr_book_documents: 'pb_book_documents', tr_book_pages: 'pb_book_pages', tr_book_page_versions: 'pb_book_page_versions', pb_book_documents: 'pb_book_documents', pb_book_pages: 'pb_book_pages', pb_book_page_versions: 'pb_book_page_versions' });
  const cache = new Map();
  let user = null;
  const selectedBook = new URLSearchParams(location.search).get('book');
  if (selectedBook && !UUID.test(selectedBook)) throw new Error('Invalid private book ID');
  async function ready() {
    const result = await client.auth.getUser();
    if (result.error || !result.data?.user) { user = null; throw new Error('비공개 관리자 로그인이 필요합니다'); }
    const check = await client.rpc('private_book_is_admin');
    if (check.error || check.data !== true) { user = null; throw new Error('비공개 교재 관리자 권한이 없습니다'); }
    user = result.data.user;
    return user;
  }
  function objectPath(value, bookId = selectedBook) {
    let p;
    if (value.startsWith('private-book://')) p = value.slice(15);
    else {
      const u = new URL(value);
      if (u.origin !== origin || u.username || u.password || !u.pathname.startsWith('/storage/v1/object/sign/' + bucket + '/')) throw new Error('Untrusted private asset URL');
      p = u.pathname.slice(('/storage/v1/object/sign/' + bucket + '/').length);
    }
    try { p = decodeURIComponent(p); } catch (_) { throw new Error('Invalid asset encoding'); }
    const parts = p.split('/');
    if (!UUID.test(parts[0]) || (bookId && parts[0].toLowerCase() !== bookId.toLowerCase())) throw new Error('Private asset book mismatch');
    const files = parts.slice(1);
    if (!((files.length === 1) || (files.length === 2 && files[0] === 'uploads')) || files.some(x => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(x) || x.includes('..')) || !/\.(png|jpe?g|webp)$/i.test(files.at(-1))) throw new Error('Invalid private image path');
    return p;
  }
  function mapDeep(value, fn) {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map(v => mapDeep(v, fn));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, mapDeep(v,fn)]));
    return value;
  }
  const assetPattern = /private-book:\/\/[^\s"'<>\\)]+|https?:\/\/[^\s"'<>\\)]+\/storage\/v1\/object\/sign\/[^\s"'<>\\)]+/g;
  function canonicalizeAssets(value, bookId = selectedBook) {
    return mapDeep(value, text => text.replace(assetPattern, uri => 'private-book://' + objectPath(uri.replace(/&amp;/g, '&'), bookId)));
  }
  // Inert parsing: no remote image loads. Stored HTML is never allowed to run code or embed third-party resources.
  function cleanHTML(html) {
    if (!html || typeof DOMParser === 'undefined') return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,meta,base,style,form,svg,math').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || /^(srcset|poster|background)$/i.test(a.name) || (a.name === 'style' && /url\s*\(|expression|@import/i.test(a.value))) el.removeAttribute(a.name);
        if (a.name === 'src' && !a.value.startsWith('private-book://')) el.removeAttribute(a.name);
        if (a.name === 'href' && !/^(https?:|mailto:|#|private-book:\/\/|admin-book-preview\.html\?)/i.test(a.value)) el.removeAttribute(a.name);
      }
    });
    return doc.body.innerHTML;
  }
  function validateBlocks(value, bookId) {
    if (!value || typeof value !== 'object') return;
    if (value.props?.url && /^(image|video|audio|file)$/.test(value.type || '')) objectPath(value.props.url, bookId);
    for (const v of Object.values(value)) if (v && typeof v === 'object') validateBlocks(v, bookId);
  }
  async function resolveAssets(value, bookId = selectedBook, force = false) {
    await ready();
    let canonical = canonicalizeAssets(value, bookId);
    // Apply HTML sanitization to row fields, preserving the surrounding record shape.
    function clean(v) {
      if (!v || typeof v !== 'object') return;
      if (typeof v.html === 'string') v.html = cleanHTML(v.html);
      if (v.blocks) validateBlocks(v.blocks, bookId);
      for (const child of Object.values(v)) if (child && typeof child === 'object') clean(child);
    }
    clean(canonical);
    const paths = new Set();
    mapDeep(canonical, s => { for (const uri of s.match(/private-book:\/\/[^\s"'<>\\)]+/g) || []) paths.add(objectPath(uri, bookId)); return s; });
    const pending = [...paths].filter(p => force || !cache.has(p) || cache.get(p).until < Date.now());
    for (let i = 0; i < pending.length; i += 100) {
      const batch = pending.slice(i, i + 100);
      const result = await client.storage.from(bucket).createSignedUrls(batch, 900);
      if (result.error) throw result.error;
      for (const item of result.data || []) {
        if (item.error || !item.signedUrl || !batch.includes(item.path) || objectPath(item.signedUrl, bookId) !== item.path) throw new Error('Private image signing failed');
        cache.set(item.path, { url: item.signedUrl, until: Date.now() + 600000 });
      }
      if (batch.some(p => !cache.has(p))) throw new Error('Missing private image signature');
    }
    return mapDeep(canonical, s => s.replace(/private-book:\/\/[^\s"'<>\\)]+/g, uri => cache.get(objectPath(uri, bookId)).url));
  }
  function resolveCached(value, bookId = selectedBook) {
    return mapDeep(canonicalizeAssets(value, bookId), s => s.replace(/private-book:\/\/[^\s"'<>\\)]+/g, uri => cache.get(objectPath(uri, bookId))?.url || uri));
  }
  function tableName(name) { if (!Object.hasOwn(tables, name)) throw new Error('Table not allowed'); return tables[name]; }
  function prepare(name, data) {
    const copy = canonicalizeAssets(data);
    if (copy.blocks) validateBlocks(copy.blocks, selectedBook);
    if (typeof copy.html === 'string') copy.html = cleanHTML(copy.html);
    if (name === 'pb_book_documents') copy.is_active = false;
    if (name === 'pb_book_page_versions') delete copy.created_by; // server default auth.uid(), never the legacy email string
    if (selectedBook && copy.book_id && copy.book_id !== selectedBook) throw new Error('Book mismatch');
    return copy;
  }
  async function resultOf(request) {
    const result = await request;
    if (result.error) throw result.error;
    return resolveAssets(result.data);
  }
  const api = {
    async query(table, params = {}) {
      await ready();
      let q = client.from(tableName(table)).select('*');
      for (const [key, value] of Object.entries(params)) {
        if (key === 'order') {
          for (const item of String(value).split(',')) {
            const match = /^(sort_order|created_at|updated_at)\.(asc|desc)$/.exec(item);
            if (!match) throw new Error('Invalid order');
            q = q.order(match[1], { ascending: match[2] === 'asc' });
          }
        } else if (key === 'limit') {
          if (!/^\d+$/.test(String(value))) throw new Error('Invalid limit');
          q = q.limit(Math.min(1000, Number(value)));
        } else {
          if (!['id','book_id','page_id','kind','is_active'].includes(key) || !String(value).startsWith('eq.')) throw new Error('Invalid query filter');
          q = q.eq(key, String(value).slice(3));
        }
      }
      // The editor may have 292+ pages. PostgREST default row caps must not silently truncate it.
      const all = [];
      if (params.limit) return resultOf(q);
      for (let start = 0; ; start += 500) {
        const result = await q.range(start, start + 499);
        if (result.error) throw result.error;
        all.push(...(result.data || []));
        if ((result.data || []).length < 500) break;
      }
      return resolveAssets(all);
    },
    async post(table, data) { await ready(); const name = tableName(table); return resultOf(client.from(name).insert(prepare(name, data)).select().single()); },
    async patch(table, id, data) { await ready(); if (!UUID.test(id)) throw new Error('Invalid row ID'); const name = tableName(table); return resultOf(client.from(name).update(prepare(name,data)).eq('id',id).select().single()); },
    async hardDelete(table, id) { await ready(); if (!UUID.test(id)) throw new Error('Invalid row ID'); const result = await client.from(tableName(table)).delete().eq('id',id); if (result.error) throw result.error; },
  };
  api.delete = api.hardDelete;
  async function uploadFile(file, bookId = selectedBook) {
    await ready();
    const ext = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp' }[file.type];
    if (!UUID.test(bookId || '') || !ext || file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error('PNG/JPEG/WebP 이미지만 최대 20MiB까지 업로드할 수 있습니다');
    const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
    const valid = ext === 'png' ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) : ext === 'jpg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP';
    if (!valid) throw new Error('이미지 파일 형식이 올바르지 않습니다');
    const p = bookId + '/uploads/' + crypto.randomUUID() + '.' + ext;
    const result = await client.storage.from(bucket).upload(p, file, { contentType:file.type, upsert:false });
    if (result.error) throw result.error;
    return resolveAssets('private-book://' + p, bookId);
  }
  async function login(email,password) {
    const result = await client.auth.signInWithPassword({email,password});
    if (result.error) throw new Error('로그인 정보를 확인해주세요');
    try { return await ready(); } catch (e) { await client.auth.signOut({scope:'local'}); throw e; }
  }
  async function logout() { user = null; cache.clear(); const r = await client.auth.signOut({scope:'local'}); if (r.error) throw r.error; }
  client.auth.onAuthStateChange?.((event) => {
    if (event !== 'SIGNED_OUT') return;
    user = null; cache.clear();
    if (typeof global.CustomEvent === 'function') global.dispatchEvent(new global.CustomEvent('privatebook:signed-out'));
  });
  global.PrivateBook = Object.freeze({ ready, client, api, query:api.query, post:api.post, patch:api.patch, hardDelete:api.hardDelete, canonicalizeAssets, resolveAssets, resolveCached, objectPath, uploadFile, login, logout, get user() { return user; }, selectedBook, refreshInterval: 600000 });
  if (new URLSearchParams(location.search).get('private') === '1') global.supabaseAPI = api;
})(window);
