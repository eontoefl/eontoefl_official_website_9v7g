import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../js/private-book-list.js',import.meta.url),'utf8');
const id='11111111-1111-4111-8111-111111111111';
function setup({allowed=true,rows=[{id,title:'Private title <script>',total_pages:292}],deferred}={}) {
 class Element {constructor(tag){this.tag=tag;this.children=[];this.hidden=false;this.textContent='';}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this[k]=fn;}}
 const nodes=Object.fromEntries(['privateBookList','privateBookListStatus','privateBookListLogin','privateBookLogout'].map(k=>[k,new Element('div')]));
 const calls=[],events={};
 const window={addEventListener:(name,fn)=>events[name]=fn,PrivateBook:{ready:async()=>{calls.push('ready');if(!allowed)throw Error('denied');},query:async(name)=>{calls.push(name);return deferred?await deferred:rows;}}};
 vm.runInNewContext(source,{window,document:{getElementById:k=>nodes[k],createElement:t=>new Element(t)},encodeURIComponent,Number,Object});
 return {api:window.PrivateBookList,nodes,calls,events};
}
test('no private metadata query before server authorization',async()=>{const x=setup({allowed:false});assert.equal(await x.api.load(),false);assert.deepEqual(x.calls,['ready']);assert.equal(x.nodes.privateBookList.children.length,0);assert.equal(x.nodes.privateBookListLogin.hidden,false);});
test('authorized card uses private editor/preview and text-only title',async()=>{const x=setup();assert.equal(await x.api.load(),true);assert.deepEqual(x.calls,['ready','pb_book_documents']);const card=x.nodes.privateBookList.children[0];assert.equal(card.children[0].children[0].children[0].textContent,'Private title <script>');const toggle=card.children[1].children[0];assert.equal(toggle.children[0].checked,false);assert.equal(toggle.children[0].disabled,true);const actions=card.children[1].children.filter(a=>a.tag==='a');assert.equal(actions.length,2);assert.ok(actions.every(a=>a.tag==='a'&&a.href.endsWith('?private=1&book='+id)));assert.equal(x.nodes.privateBookListLogin.hidden,true);});
test('deleted and invalid book identifiers are not rendered',async()=>{const x=setup({rows:[{id,deleted_at:'2026-01-01'}, {id:'unsafe',title:'bad'}]});await x.api.load();assert.equal(x.nodes.privateBookList.children.length,0);});
test('logout clears metadata and prevents a pending request from repopulating',async()=>{let done;const x=setup({deferred:new Promise(r=>done=r)});const pending=x.api.load();await Promise.resolve();x.events['privatebook:signed-out']();done([{id,title:'private'}]);assert.equal(await pending,false);assert.equal(x.nodes.privateBookList.children.length,0);assert.equal(x.nodes.privateBookListLogin.hidden,false);});
test('legacy actions remain separate and catalog adapter never writes',()=>{const html=fs.readFileSync(new URL('../admin-book-list.html',import.meta.url),'utf8');const legacy=fs.readFileSync(new URL('../js/admin-book-list.js',import.meta.url),'utf8');assert.match(html,/id="legacyBookActions" hidden/);assert.match(legacy,/if \(legacyAllowed\) load\(\)/);assert.doesNotMatch(source,/\.post\(|\.patch\(|\.hardDelete\(|tr_book_|togglePublish/);assert.match(html,/next=%2Fadmin-book-list\.html/);});
