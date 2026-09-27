import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('js/book-admin-preview.js', root), 'utf8');
const html = fs.readFileSync(new URL('admin-book-preview.html', root), 'utf8');
const css = fs.readFileSync(new URL('css/private-book-preview.css', root), 'utf8');
const book = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const base = 'https://example.test/admin-book-preview.html';
const window = {};
vm.runInNewContext(source, {window, URL, URLSearchParams});
const helpers = window.BookAdminPreview;
const storage = value => ({getItem: key => { assert.equal(key, 'iontoefl_user'); return value; }});

test('UUID required; legacy private query tolerated, never required', () => {
  assert.equal(helpers.bookFrom('?book='+book), book);
  assert.equal(helpers.bookFrom('?private=1&book='+book), book);
  for (const q of ['', '?private=1', '?book=public', '?book=../a', '?book='+book+'&book='+book]) assert.throws(() => helpers.bookFrom(q));
});
test('page jump clamps to 292 and rejects fractional/unsafe values', () => {
  for (const [input, expected] of [['2',2],['999',292],['0',1],['-1',1],['2.5',1],['NaN',1],['999999999999999999999',1]]) assert.equal(helpers.pageNumber(input,292),expected);
});
test('generated URLs have no private or arbitrary return parameters', () => {
  const url = helpers.previewURL(base+'?private=1&next=https://evil.test',book,7);
  assert.equal(url.origin, new URL(base).origin);
  assert.equal(url.search, '?book='+book+'&p=7');
});
test('exact existing admin role required; bad storage fails closed', () => {
  assert.equal(helpers.hasAdmin(base,storage('{"role":"admin"}')),true);
  for (const value of [null, '', '{}', '{', 'null', '{"role":"student"}', '{"role":"Admin"}', 'true']) assert.equal(helpers.hasAdmin(base,storage(value)),false);
  assert.equal(helpers.hasAdmin(base,{getItem(){throw Error('blocked');}}),false);
});
test('dev bypass explicit and loopback-only; retained in local navigation', () => {
  for (const host of ['localhost','127.0.0.1','[::1]']) {
    const local = 'http://'+host+':8000/admin-book-preview.html?dev=1';
    assert.equal(helpers.hasAdmin(local,storage(null)),true);
    assert.equal(helpers.previewURL(local,book,2).searchParams.get('dev'),'1');
  }
  for (const url of [base+'?dev=1','http://localhost.evil.test/?dev=1','http://192.168.1.1/?dev=1','http://localhost/','http://localhost/?dev=0','file:///x?dev=1']) assert.equal(helpers.hasAdmin(url,storage(null)),false);
});
test('printed internal links enforce selected book and unambiguous page', () => {
  assert.equal(helpers.linkTarget('admin-book-preview.html?book='+book+'&p=12',base,book,292).page,12);
  for (const suffix of ['book='+other+'&p=12','book='+book+'&p=-1','book='+book+'&p=12&p=13','book='+book+'&book='+other+'&p=12']) assert.equal(helpers.linkTarget('admin-book-preview.html?'+suffix,base,book,292),null);
  assert.equal(helpers.linkTarget('#chapter',base,book,292).hash,'chapter');
});
test('external navigation only HTTPS without credentials', () => {
  assert.equal(helpers.linkTarget('https://www.ets.org/toefl',base,book,292).external,'https://www.ets.org/toefl');
  for (const raw of ['javascript:alert(1)','data:text/html,x','http://example.org','https://user:secret@example.org','/book.html?book=public']) assert.equal(helpers.linkTarget(raw,base,book,292),null);
});
test('image allowlist: selected migration plus future own-project book uploads', () => {
  const [migration, uploaded] = helpers.assetPrefixes(book);
  for (const url of [migration+'page-1/image.png',uploaded+'new-image.webp',uploaded+'%ED%95%9C%EA%B8%80.png']) assert.equal(helpers.assetURL(url,book),url);
  for (const url of [migration.replace(book,other)+'image.png',migration.replace('qpqjevecjejvbeuogtbx','foreign')+'image.png',migration.replace('guide-images','other')+'image.png',migration+'x.png?token=x',migration+'x.png#hash',migration+'%2e%2e%2fescape.png',migration+'%252e%252e/escape.png',migration+'bad%5cname.png','data:image/png,x','javascript:alert(1)','/storage/v1/object/public/guide-images/book/a.png',migration.replace('https:','http:')+'x.png',migration.replace('https://','https://user:pass@')+'x.png']) assert.equal(helpers.assetURL(url,book),null,url);
});

// Source contracts and VM runtime checks, not deployed authorization or a browser exploit audit.
test('entry loads ordinary API then renamed preview; no private login/logout', () => {
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]),['js/supabase-config.js','js/book-admin-preview.js']);
  assert.match(html,/href="admin-book-list.html"/);
  assert.doesNotMatch(html,/private-book-client|vendor\/supabase|id="logout"|admin-private-books/);
  assert.doesNotMatch(source,/PrivateBook|resolveAssets|canonicalizeAssets|onAuthStateChange|loginURL|서버 인증 완료/);
});
test('no database/storage writes or progress/private adapters', () => {
  assert.doesNotMatch(source,/\.(?:post|patch|insert|update|delete|hardDelete|upsert|uploadFile|setItem|removeItem)\s*\(/);
  assert.doesNotMatch(source,/tr_book_progress|tr_book_memos|book-private|object\/sign/);
  assert.match(source,/api\.query\('tr_book_documents', \{id:'eq\.' \+ book\}\)/);
  assert.match(source,/api\.query\('tr_book_pages', \{book_id:'eq\.' \+ book, order:'sort_order\.asc'\}\)/);
});
test('script-disabled sandbox, restrictive CSP and resource sanitation retained', () => {
  assert.match(source,/setAttribute\('sandbox','allow-same-origin'\)/);
  assert.doesNotMatch(source,/setAttribute\('sandbox',[^\n]*allow-scripts/);
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(source.includes(directive));
  assert.match(source,/assetPrefixes\(book\)\.join\(' '\)/);
  assert.match(source,/assetURL\(attr.value, book\)/);
  assert.match(source,/name.startsWith\('on'\)/);
  assert.match(source,/srcset.*srcdoc.*action.*formaction.*ping.*xlink:href/);
  assert.match(source,/css\/book-design-system\.css/); assert.match(source,/css\/book-design-viewer\.css/);
});
test('TOC, source numbering, responsive layout, keyboard and zoom retained', () => {
  assert.match(source,/rows\[current - 1\]\.sort_order/);
  assert.match(source,/headingsIn\(inert\(row.html\)\)/);
  assert.match(source,/ArrowLeft/); assert.match(source,/ArrowRight/);
  assert.match(html,/min="80" max="150"/); assert.match(css,/@media\(max-width:760px\)/);
  assert.doesNotMatch(html,/id="save|id="memo|id="progress/);
});

async function harness({search='?book='+book, role='{"role":"admin"}', url=base, pages, documents, onQuery}={}) {
  const calls=[], elements=new Map(), events={}, docEvents={}, intervals=[];
  let stored=role;
  class Element {
    constructor(id){this.id=id;this.hidden=false;this.children=[];this.events={};this.attributes=[];this.style={setProperty:(...args)=>calls.push(['style',...args])};this.dataset={};this.value=id==='zoom'?'100':'1';}
    addEventListener(name,fn){this.events[name]=fn;}
    replaceChildren(...children){this.children=children;}
    querySelectorAll(){return [];}
    setAttribute(name,value){this[name]=value;}
    removeAttribute(name){delete this[name];}
    append(el){this.children.push(el);}
    get childElementCount(){return this.children.length;}
  }
  const element=id=>{if(!elements.has(id)) elements.set(id,new Element(id));return elements.get(id);};
  const document={visibilityState:'visible',getElementById:element,addEventListener:(name,fn)=>docEvents[name]=fn,createElement(tag){const el=new Element(tag);if(tag==='template')el.content=new Element('fragment');if(tag==='iframe')el.contentDocument={getElementById:()=>element('frame-content')};return el;}};
  const win={localStorage:{getItem:()=>stored},addEventListener:(name,fn)=>events[name]=fn,open:(...args)=>calls.push(['open',...args])};
  const api={query:async(table,filters)=>{calls.push(['query',table,filters]);if(onQuery) await onQuery(table,{setRole:value=>stored=value});return table==='tr_book_documents'?(documents??[{id:book,title:'292-page hidden book',is_active:false}]):(pages??Array.from({length:292},(_,index)=>({book_id:book,sort_order:index+1,html:'<h1>Page '+(index+1)+'</h1>'})));}};
  vm.runInNewContext(source,{window:win,document,location:{href:url+search,search},supabaseAPI:api,history:{replaceState:(_a,_b,url)=>calls.push(['history',url])},URL,URLSearchParams,clearInterval:()=>calls.push(['clearInterval']),setInterval:fn=>{intervals.push(fn);return 1;}});
  await new Promise(resolve=>setImmediate(resolve));
  return {calls,elements,events,docEvents,intervals,document,setRole:value=>stored=value,load(){elements.get('pageHost').children[0]?.events.load?.();}};
}
test('runtime: invalid UUID and absent/student/malformed role never read tables', async () => {
  for (const options of [{search:'?book=invalid'},{role:null},{role:'{"role":"student"}'},{role:'{'}]) {
    const h=await harness(options);assert.equal(h.calls.some(c=>c[0]==='query'),false);assert.equal(h.elements.get('reader').hidden,true);
  }
});
test('runtime: admin reads hidden document and 292 ordered ordinary pages', async () => {
  const h=await harness({search:'?book='+book+'&p=292'});h.load();
  assert.deepEqual(h.calls.filter(c=>c[0]==='query').map(c=>[c[1],JSON.parse(JSON.stringify(c[2]))]),[['tr_book_documents',{id:'eq.'+book}],['tr_book_pages',{book_id:'eq.'+book,order:'sort_order.asc'}]]);
  assert.equal(h.elements.get('reader').hidden,false);
  assert.equal(h.elements.get('pageNumber').value,'292');
  assert.equal(h.elements.get('next').disabled,true);
  assert.equal(h.elements.get('previous').disabled,false);
  assert.equal(h.elements.get('totalPages').textContent,'/ 292');
  assert.match(h.elements.get('editorLink').href,/admin-book-editor.html\?book=/);
  assert.doesNotMatch(h.elements.get('editorLink').href,/private=/);
  const frame=h.elements.get('pageHost').children[0];assert.equal(frame.sandbox,'allow-same-origin');
  assert.match(frame.srcdoc,/script-src 'none'/);
  assert.match(h.elements.get('status').textContent,/기존 관리자 역할 확인/);
});
test('runtime: previous/next and page jump clamp to actual book bounds', async () => {
  const h=await harness();
  h.elements.get('next').events.click();assert.equal(h.elements.get('pageNumber').value,'2');
  h.elements.get('previous').events.click();assert.equal(h.elements.get('pageNumber').value,'1');
  h.elements.get('pageNumber').value='999';h.elements.get('jumpForm').events.submit({preventDefault(){}});assert.equal(h.elements.get('pageNumber').value,'292');
});
test('runtime: wrong document, cross-book rows and empty books fail closed', async () => {
  for(const options of [{documents:[{id:other}]},{pages:[{book_id:other,html:'x'}]},{pages:[]}]){
    const h=await harness(options);assert.equal(h.elements.get('reader').hidden,true);assert.equal(h.elements.get('pageHost').children.length,0);
  }
});
test('runtime: revocation during fetch rejected before render', async () => {
  const h=await harness({onQuery:async(table,state)=>{if(table==='tr_book_pages') state.setRole(null);}});
  assert.equal(h.elements.get('reader').hidden,true);assert.equal(h.elements.get('pageHost').children.length,0);
});
test('runtime: revocation before frame load prevents insertion', async () => {
  const h=await harness();h.setRole(null);h.load();
  assert.equal(h.elements.get('reader').hidden,true);assert.equal(h.elements.get('pageHost').children.length,0);
});
test('runtime: visibility/pageshow recheck without refetch or signed refresh', async () => {
  const h=await harness();h.load();const frame=h.elements.get('pageHost').children[0];
  h.document.visibilityState='hidden';h.docEvents.visibilitychange();assert.equal(frame.hidden,true);
  h.document.visibilityState='visible';h.docEvents.visibilitychange();assert.equal(frame.hidden,false);
  h.events.pageshow({persisted:true});assert.equal(h.elements.get('pageHost').children[0],frame);
  assert.equal(h.calls.filter(c=>c[0]==='query').length,2);
  h.setRole(null);h.docEvents.visibilitychange();assert.equal(h.elements.get('reader').hidden,true);
});
test('runtime: storage/focus/periodic checks clear stale admin content', async () => {
  for(const trigger of [h=>h.events.storage({key:'iontoefl_user'}),h=>h.events.storage({key:null}),h=>h.events.focus(),h=>h.intervals[0]()]){
    const h=await harness();h.load();h.setRole('{"role":"student"}');trigger(h);
    assert.equal(h.elements.get('reader').hidden,true);assert.equal(h.elements.get('pageHost').children.length,0);assert.equal(h.elements.get('toc').children.length,0);assert.equal(h.elements.get('editorLink').hidden,true);
  }
});
test('runtime: production dev flag rejected; explicit local dev accepted', async () => {
  const production=await harness({search:'?book='+book+'&dev=1',role:null});assert.equal(production.calls.some(c=>c[0]==='query'),false);
  const local=await harness({url:'http://127.0.0.1:8000/admin-book-preview.html',search:'?book='+book+'&dev=1',role:null});assert.equal(local.elements.get('reader').hidden,false);assert.match(local.elements.get('editorLink').href,/dev=1/);
});

test('runtime: a stale frame load cannot replace the current page', async () => {
  const h=await harness();
  const oldFrame=h.elements.get('pageHost').children[0];
  h.elements.get('next').events.click();
  const currentFrame=h.elements.get('pageHost').children[0];
  oldFrame.events.load();
  assert.equal(h.elements.has('frame-content'),false);
  currentFrame.events.load();
  assert.equal(h.elements.get('pageNumber').value,'2');
  assert.equal(h.elements.get('pageHost').children[0],currentFrame);
});
test('runtime: pages created while hidden remain hidden until role recheck', async () => {
  const h=await harness();h.document.visibilityState='hidden';
  h.elements.get('next').events.click();
  const frame=h.elements.get('pageHost').children[0];assert.equal(frame.hidden,true);
  h.document.visibilityState='visible';h.docEvents.visibilitychange();assert.equal(frame.hidden,false);
});
test('sanitizer runtime: resource attributes and handlers stripped; approved images retained', () => {
  const migration=helpers.assetPrefixes(book)[0];
  function node(tag, initial) {
    const attrs=new Map(Object.entries(initial));
    return {tag,removed:false,events:{},get attributes(){return [...attrs].map(([name,value])=>({name,value}));},remove(){this.removed=true;},getAttribute:name=>attrs.get(name)??null,setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),matches:selector=>selector.split(',').includes(tag),addEventListener(name,fn){this.events[name]=fn;}};
  }
  const good=node('img',{src:migration+'image.png',onerror:'alert(1)',srcset:'https://evil.test/image.png 2x'});
  const bad=node('img',{src:'https://evil.test/track.png'});
  const svg=node('image',{'xlink:href':'https://evil.test/a.svg',href:'https://evil.test/b.svg'});
  const poster=node('video',{poster:'https://evil.test/poster.png',src:'https://evil.test/movie.mp4'});
  const script=node('script',{});
  const internal=node('a',{href:'admin-book-preview.html?book='+book+'&p=12',target:'_top',ping:'https://evil.test/ping'});
  const invalid=node('a',{href:'javascript:alert(1)',onclick:'alert(2)'});
  const nodes=[good,bad,svg,poster,script,internal,invalid];
  const fragment={querySelectorAll(selector){return nodes.filter(el=>!el.removed&&(selector==='*'||selector.split(',').includes(el.tag)));}};
  const start=source.indexOf('  function prepareContent(html)');
  const end=source.indexOf('  function frameShell()',start);
  const targets=[];
  const ctx={inert:()=>fragment,assetURL:helpers.assetURL,linkTarget:helpers.linkTarget,base,book,rows:Array(292),navigateLink:target=>targets.push(target)};
  vm.runInNewContext(source.slice(start,end)+'\nprepareContent("fixture");',ctx);
  assert.equal(script.removed,true);
  assert.equal(good.getAttribute('src'),migration+'image.png');
  assert.equal(good.getAttribute('srcset'),null);assert.equal(good.getAttribute('onerror'),null);
  assert.equal(good.getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(bad.getAttribute('src'),null);
  assert.equal(svg.getAttribute('href'),null);assert.equal(svg.getAttribute('xlink:href'),null);
  assert.equal(poster.getAttribute('poster'),null);assert.equal(poster.getAttribute('src'),null);
  assert.equal(internal.getAttribute('href'),null);assert.equal(internal.getAttribute('target'),null);assert.equal(internal.getAttribute('ping'),null);
  assert.equal(internal.getAttribute('role'),'link');
  internal.events.click({preventDefault(){}});assert.equal(targets[0].page,12);
  assert.equal(invalid.getAttribute('href'),null);assert.equal(invalid.getAttribute('onclick'),null);assert.equal(invalid.events.click,undefined);
});
