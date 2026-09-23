import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root,'js/private-book-client.js'),'utf8');
const book='11111111-1111-4111-8111-111111111111';
const row='22222222-2222-4222-8222-222222222222';
const project='https://example.supabase.co';
function setup({authenticated=true, admin=true, legacy=false}={}) {
  const calls=[];
  let config;
  let payload;
  const chain={select(){return this;},eq(k,v){calls.push(['eq',k,v]);return this;},order(){return this;},limit(){return this;},range(){return Promise.resolve({data:[],error:null});},insert(data){payload=data;calls.push(['insert',data]);return this;},update(data){payload=data;calls.push(['update',data]);return this;},delete(){calls.push(['delete']);return this;},single(){return Promise.resolve({data:{id:row,...payload},error:null});},then(resolve){resolve({data:[],error:null});}};
  const client={auth:{getUser:async()=>({data:{user:authenticated?{id:row,email:'admin@example.test'}:null}}),signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null})},rpc:async name=>{calls.push(['rpc',name]);return {data:admin};},from(name){calls.push(['from',name]);return chain;},storage:{from(name){calls.push(['bucket',name]);return {createSignedUrls:async paths=>{calls.push(['sign',paths]);return {data:paths.map(p=>({path:p,signedUrl:project+'/storage/v1/object/sign/book-private/'+p+'?token=ephemeral'}))};},upload:async(p)=>{calls.push(['upload',p]);return {error:null};}};}}};
  const window={supabase:{createClient(url,key,options){config=options;return client;}}};
  const context=vm.createContext({window,location:{pathname:'/admin-book-editor.html',search:legacy?'':'?private=1&book='+book},SUPABASE_URL:project,SUPABASE_ANON_KEY:'public-placeholder',URL,URLSearchParams,Map,Set,Date,Uint8Array,crypto:{randomUUID:()=>row}});
  vm.runInContext(source,context);
  return {api:window.PrivateBook,calls,config,window};
}
test('isolated session key and legacy page remains untouched',()=>{assert.equal(setup().config.auth.storageKey,'eontoefl-private-book-auth-v1');const x=setup({legacy:true});assert.equal(x.api,undefined);assert.equal(x.window.supabaseAPI,undefined);});
test('unauthenticated and non-admin requests never reach database or storage',async()=>{for(const options of [{authenticated:false},{admin:false}]){const x=setup(options);await assert.rejects(x.api.query('tr_book_pages'));await assert.rejects(x.api.resolveAssets('private-book://'+book+'/a.png'));assert.equal(x.calls.some(c=>['from','bucket'].includes(c[0])),false);}});
test('canonical image URLs batch deduplicate and reverse on write',async()=>{const x=setup();const canonical='private-book://'+book+'/page-001.png';const resolved=await x.api.resolveAssets({blocks:[{type:'image',props:{url:canonical}}],html:'<img src="'+canonical+'">'});assert.equal(x.calls.filter(c=>c[0]==='sign').length,1);assert.equal(x.calls.find(c=>c[0]==='sign')[1].length,1);assert.match(resolved.html,/token=ephemeral/);assert.equal(x.api.canonicalizeAssets(resolved).blocks[0].props.url,canonical);await x.api.patch('tr_book_pages',row,resolved);const data=x.calls.find(c=>c[0]==='update')[1];assert.equal(JSON.stringify(data).includes('token='),false);assert.equal(x.calls.some(c=>c[0]==='from'&&c[1]==='pb_book_pages'),true);});
test('strict URL origin bucket book-prefix and traversal checks',()=>{const x=setup();for(const bad of ['https://evil.example/storage/v1/object/sign/book-private/'+book+'/a.png?token=x',project+'/storage/v1/object/sign/guide-images/'+book+'/a.png','private-book://'+row+'/a.png','private-book://'+book+'/%2e%2e/a.png','private-book://'+book+'/a.svg','private-book://'+book+'/a%252epng','private-book://'+book+'/nested/a.png'])assert.throws(()=>x.api.objectPath(bad));assert.equal(x.api.objectPath('private-book://'+book+'/uploads/a.webp'),book+'/uploads/a.webp');});
test('no publication and no legacy-table escape',async()=>{const x=setup();await x.api.patch('tr_book_documents',book,{is_active:true});assert.equal(x.calls.find(c=>c[0]==='update')[1].is_active,false);await assert.rejects(x.api.query('users'));await assert.rejects(x.api.query('tr_book_pages',{or:'id.eq.bad'}));});
test('private uploads validate type size and content and never use legacy bucket',async()=>{const x=setup();await assert.rejects(x.api.uploadFile({type:'image/svg+xml',size:2}));await assert.rejects(x.api.uploadFile({type:'image/png',size:21*1024*1024}));await assert.rejects(x.api.uploadFile({type:'image/png',size:8,slice(){return {arrayBuffer:async()=>new Uint8Array(12).buffer};}}));const png={type:'image/png',size:8,slice(){return {arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer};}};const result=await x.api.uploadFile(png);assert.match(result,/book-private/);assert.equal(x.calls.some(c=>c[0]==='bucket'&&c[1]!=='book-private'),false);assert.match(x.calls.find(c=>c[0]==='upload')[1],new RegExp('^'+book+'/uploads/'));});
test('editor uses private adapter before load and loopback-only legacy dev bypass',()=>{const editor=fs.readFileSync(path.join(root,'js/admin-book-editor.js'),'utf8');assert.match(editor,/privateMode \? window\.PrivateBook\.api : supabaseAPI/);assert.ok(editor.indexOf('await window.PrivateBook.ready()')<editor.indexOf('await loadBooks()'));assert.match(editor,/\["localhost", "127\.0\.0\.1", "\[::1\]"\]\.includes\(location.hostname\)/);assert.equal((editor.match(/supabaseAPI\./g)||[]).length,0);assert.match(editor,/if \(privateMode\) return window\.PrivateBook\.uploadFile/);});
