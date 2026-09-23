import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../admin-private-books.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function run({allowed=true,next=''}={}) {
 const nodes=new Map(),redirects=[];
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:'',addEventListener(){}});return nodes.get(id);}};
 const search=next?'?next='+encodeURIComponent(next):'';
 const location={origin:'https://eonfl.com',href:'https://eonfl.com/admin-private-books.html'+search,search,replace:url=>redirects.push(url)};
 vm.runInNewContext(source,{document,location,window:{addEventListener(){}},URL,URLSearchParams,PrivateBook:{ready:async()=>{if(!allowed)throw Error('denied');}}});
 await new Promise(resolve=>setImmediate(resolve));return {redirects,nodes};
}
test('login-only entry sends existing authenticated administrators to the common catalog',async()=>{const x=await run();assert.deepEqual(x.redirects,['admin-book-list.html']);assert.doesNotMatch(html,/id="booksPanel"|PrivateBook\.query/);});
test('unauthenticated entry shows login without rendering or redirecting to private content',async()=>{const x=await run({allowed:false});assert.equal(x.redirects.length,0);assert.equal(x.nodes.get('loginPanel').hidden,false);});
test('return URLs retain only allowed same-origin destinations',async()=>{for(const next of ['https://evil.example/','javascript:alert(1)','/index.html','/admin-book-editor.html?book=bad']){const x=await run({next});assert.deepEqual(x.redirects,['admin-book-list.html']);}const x=await run({next:'/admin-book-list.html?dev=1'});assert.deepEqual(x.redirects,['https://eonfl.com/admin-book-list.html']);const y=await run({next:'/admin-book-preview.html?book=11111111-1111-4111-8111-111111111111&p=94'});assert.match(y.redirects[0],/^https:\/\/eonfl\.com\/admin-book-preview\.html\?/);assert.match(y.redirects[0],/private=1/);});
test('duplicate management navigation is removed but the common catalog remains',()=>{const settings=fs.readFileSync(new URL('../admin-settings.html',import.meta.url),'utf8');assert.doesNotMatch(settings,/href="admin-private-books\.html"/);assert.match(settings,/href="admin-book-list\.html"/);const list=fs.readFileSync(new URL('../admin-book-list.html',import.meta.url),'utf8');assert.doesNotMatch(list,/<h2>비공개 교재/);});
