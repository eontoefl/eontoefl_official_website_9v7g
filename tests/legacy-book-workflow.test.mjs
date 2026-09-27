import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const list=read('js/admin-book-list.js'), editor=read('js/admin-book-editor.js');
function setup(source,{user={role:'admin'},search='',hostname='eonfl.com'}={}){
 const calls=[],events={},nodes=new Map();
 const document={addEventListener:(name,fn)=>events[name]=fn,getElementById:id=>{if(!nodes.has(id))nodes.set(id,{style:{},hidden:false,textContent:'',innerHTML:''});return nodes.get(id);}};
 const context=vm.createContext({document,window:{},location:{search,hostname},URLSearchParams,localStorage:{getItem:()=>typeof user==='string'?user:JSON.stringify(user)},alert:()=>calls.push(['alert']),console,supabaseAPI:{query:async(t)=>{calls.push(['query',t]);return[]},patch:async(t,id,data)=>{calls.push(['patch',t,id,data]);return{id,...data};}}});
 vm.runInContext(source,context);return{context,calls,events};
}
test('list and editor use the existing administrator session, not a dedicated login',()=>{for(const source of [list,editor]){assert.equal(vm.runInContext('checkAuth()',setup(source).context),true);for(const user of [null,{role:'student'},'broken-json'])assert.equal(vm.runInContext('checkAuth()',setup(source,{user}).context),false);}});
test('production dev and old private parameters do not bypass the existing gate',()=>{for(const source of [list,editor]){for(const search of ['?dev=1','?private=1&book=11111111-1111-4111-8111-111111111111'])assert.equal(vm.runInContext('checkAuth()',setup(source,{user:null,search}).context),false);assert.equal(vm.runInContext('checkAuth()',setup(source,{user:null,search:'?dev=1',hostname:'localhost'}).context),true);}});
test('unauthenticated list startup performs no data lookup',()=>{const x=setup(list,{user:null});x.events.DOMContentLoaded();assert.equal(x.calls.some(c=>c[0]==='query'),false);});
test('ordinary toggle still supports both states through the legacy document API',async()=>{const x=setup(list);await vm.runInContext("togglePublish({id:'target',is_active:false},true)",x.context);await vm.runInContext("togglePublish({id:'target',is_active:true},false)",x.context);assert.deepEqual(JSON.parse(JSON.stringify(x.calls.filter(c=>c[0]==='patch'))),[['patch','tr_book_documents','target',{is_active:true}],['patch','tr_book_documents','target',{is_active:false}]]);});
test('management entrypoints have no private sections, special account controls or SDK dependencies',()=>{for(const p of ['admin-book-list.html','admin-book-editor.html']){const html=read(p);assert.doesNotMatch(html,/private-book-client|private-book-list|supabase-2\.116|privateBookBadge|privateBookLogout|교재 관리자 로그인|보호된 숨김 교재/);}assert.doesNotMatch(editor,/PrivateBook|privateMode|pb_book_/);assert.match(editor,/supabaseAPI\.post\("tr_book_page_versions"/);assert.match(editor,/STORAGE_BUCKET = "guide-images"/);assert.match(editor,/localStorage\.setItem\(draftKey/);});
test('old login bookmark is a fixed ordinary-list redirect with no login form',()=>{const html=read('admin-private-books.html');assert.match(html,/admin-book-list\.html/);assert.doesNotMatch(html,/<form|type="password"|PrivateBook|safeReturn/);});
test('editing preserves same-tab links to the normal administrator preview',()=>{assert.match(read('book-editor-src/src/main.jsx'),/book-v2\|admin-book-preview/);});
