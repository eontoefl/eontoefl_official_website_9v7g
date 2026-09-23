import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('js/private-book-preview.js', root), 'utf8');
const html = fs.readFileSync(new URL('admin-book-preview.html', root), 'utf8');
const css = fs.readFileSync(new URL('css/private-book-preview.css', root), 'utf8');
const book = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const base = 'https://example.test/admin-book-preview.html';
const window = {};
vm.runInNewContext(source, {window, URL, URLSearchParams});
const helpers = window.PrivateBookPreview;

test('UUID is mandatory even without private flag; duplicates and malformed IDs fail', () => {
  assert.equal(helpers.bookFrom('?book=' + book), book);
  assert.equal(helpers.bookFrom('?private=1&book=' + book), book);
  for (const q of ['', '?private=1', '?book=public', '?book=../a', '?book=' + book + '&book=' + book]) assert.throws(() => helpers.bookFrom(q));
});
test('page jump clamps to actual pages and rejects noninteger/unsafe values', () => {
  for (const [input, expected] of [['2',2],['999',292],['0',1],['-1',1],['2.5',1],['NaN',1],['999999999999999999999',1]]) assert.equal(helpers.pageNumber(input,292),expected);
});
test('login return destination is constructed from the same-origin preview allowlist', () => {
  const u = helpers.loginURL(base + '?next=https://evil.test',book,7);
  assert.equal(u.origin,'https://example.test');
  assert.equal(u.pathname,'/admin-private-books.html');
  const next = new URL(u.searchParams.get('next'), base);
  assert.equal(next.origin,u.origin); assert.equal(next.pathname,'/admin-book-preview.html');
  assert.equal(next.searchParams.get('book'),book); assert.equal(next.searchParams.get('p'),'7');
  assert.equal(next.searchParams.has('next'),false);
});
test('printed contents links resolve only to the selected private book', () => {
  assert.equal(helpers.linkTarget('admin-book-preview.html?book='+book+'&p=12',base,book,292).page,12);
  assert.equal(helpers.linkTarget('admin-book-preview.html?book='+other+'&p=12',base,book,292),null);
  assert.equal(helpers.linkTarget('admin-book-preview.html?book='+book+'&p=-1',base,book,292),null);
  assert.equal(helpers.linkTarget('#chapter',base,book,292).hash,'chapter');
});
test('external links require HTTPS and cannot carry credentials or script schemes', () => {
  assert.equal(helpers.linkTarget('https://www.ets.org/toefl',base,book,292).external,'https://www.ets.org/toefl');
  for (const raw of ['javascript:alert(1)','data:text/html,x','http://example.org','https://user:secret@example.org','/book.html?book=public']) assert.equal(helpers.linkTarget(raw,base,book,292),null);
});

// These are source-contract checks, not claims of a real browser, deployed RLS,
// network timing, or full HTML exploit-suite verification.
test('shell loads only the private adapter chain in order', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts,['js/supabase-config.js','vendor/supabase-2.116.0.js','js/private-book-client.js','js/private-book-preview.js']);
  assert.match(html,/ADMIN ONLY/); assert.match(html,/no-referrer/);
});
test('preview source contains no database mutation or legacy/progress adapters', () => {
  assert.doesNotMatch(source,/\.(?:post|patch|insert|update|delete|hardDelete|upsert|uploadFile)\s*\(/);
  assert.doesNotMatch(source,/supabaseAPI|localStorage|sessionStorage|tr_book_progress|tr_book_memos/);
  assert.match(source,/api\.api\.query\('tr_book_documents', \{id:'eq\.' \+ book\}\)/);
  assert.match(source,/api\.api\.query\('tr_book_pages', \{book_id:'eq\.' \+ book, order:'sort_order\.asc'\}\)/);
  const startup = source.slice(source.indexOf('async function start()'));
  assert.ok(startup.indexOf('await verify()') < startup.indexOf("api.api.query('tr_book_documents'"));
});
test('sandbox has no script capability and CSP disallows foreign resources', () => {
  assert.match(source,/setAttribute\('sandbox','allow-same-origin'\)/);
  assert.doesNotMatch(source,/setAttribute\('sandbox',[^\n]*allow-scripts/);
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(source.includes(directive));
  assert.match(source,/img-src \$\{assetPrefix\}/);
  assert.match(source,/api\.objectPath\(img\.getAttribute\('src'\)/);
  assert.match(source,/css\/book-design-system\.css/); assert.match(source,/css\/book-design-viewer\.css/);
});
test('refresh contract changes image URLs in place with auth and generation guards', () => {
  const refresh = source.slice(source.indexOf('async function refresh()'),source.indexOf('async function start()'));
  assert.match(refresh,/await verify\(\)/); assert.match(refresh,/resolveAssets\(rows\[current - 1\], book, true\)/);
  assert.match(refresh,/ticket !== generation/); assert.match(refresh,/setAttribute\('src',signed\)/);
  assert.doesNotMatch(refresh,/replaceChildren|scrollTo|history\.|show\(/);
  assert.match(source,/setInterval\(refresh, api\.refreshInterval \|\| 600000\)/);
  assert.match(source,/visibilitychange/); assert.match(source,/SIGNED_OUT/);
  const clear = source.slice(source.indexOf('function clearPrivate'),source.indexOf('async function verify'));
  assert.match(clear,/rows = \[\]/); assert.match(clear,/replaceChildren\(\)/); assert.match(clear,/clearInterval\(timer\)/);
});
test('controls include source sort_order, mobile layout, zoom and no save UI', () => {
  assert.match(source,/rows\[current - 1\]\.sort_order/);
  assert.match(html,/min="80" max="150"/); assert.match(css,/@media\(max-width:760px\)/);
  assert.doesNotMatch(html,/id="save|id="memo|id="progress/);
});

async function failureHarness(search, authFails = false) {
  const calls = [], elements = new Map();
  function element(id) { if (!elements.has(id)) elements.set(id,{hidden:false,textContent:'',addEventListener(){},replaceChildren(){calls.push(['clear',id]);}}); return elements.get(id); }
  const client = {ready:async()=>{calls.push(['ready']); if(authFails) throw new Error('no session');},client:{auth:{getUser:async()=>({data:{user:null}})}},api:{query:async()=>{calls.push(['query']); return [];}}};
  const win = {PrivateBook:client,addEventListener(){}};
  vm.runInNewContext(source,{window:win,document:{getElementById:element,addEventListener(){}},location:{href:base,search,replace:url=>calls.push(['redirect',url])},URL,URLSearchParams,clearInterval(){},setInterval(){}});
  await new Promise(resolve=>setImmediate(resolve)); return {calls,elements};
}
test('runtime: invalid UUID fails closed without auth/database reads', async () => {
  const h = await failureHarness('?book=invalid');
  assert.equal(h.calls.some(c=>c[0]==='query'||c[0]==='ready'),false);
  assert.equal(h.elements.get('reader').hidden,true);
});
test('runtime: missing session clears content and redirects without a database read', async () => {
  const h = await failureHarness('?book='+book,true);
  assert.equal(h.calls.some(c=>c[0]==='ready'),true);
  assert.equal(h.calls.some(c=>c[0]==='query'),false);
  assert.match(h.calls.find(c=>c[0]==='redirect')[1],/admin-private-books\.html\?next=/);
  assert.equal(h.elements.get('reader').hidden,true);
});
