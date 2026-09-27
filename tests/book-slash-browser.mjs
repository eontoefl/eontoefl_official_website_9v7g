import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const session=process.env.BOOK_QA_OUTPUT||path.join(tmpdir(),'book-editor-qa');
await fs.mkdir(path.join(session,'tmp'),{recursive:true});
if(!process.env.BOOK_EDITOR_FIXTURE)throw Error('Set BOOK_EDITOR_FIXTURE to an external {document,pages} export. Never commit book content.');
const require=createRequire(root+'/book-editor-src/package.json');const {chromium}=require('playwright-core');
const fixture=JSON.parse(await fs.readFile(process.env.BOOK_EDITOR_FIXTURE,'utf8'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.ttf':'font/ttf'};
const harness='<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="/js/book-editor.bundle.css"><link rel="stylesheet" href="/css/admin-book-editor.css"><link rel="stylesheet" href="/css/book-design-system.css"><link rel="stylesheet" href="/css/book-design-viewer.css"><link rel="stylesheet" href="/css/book-editor-reading.css"><body><button id="outside">편집 밖</button><main style="max-width:760px;margin:20px auto" class="bookedit-paper"><div id="editor" class="bookedit-mount"></div></main><script src="/js/book-editor.bundle.js"></script><script>window.h=BookEditor.mount("#editor",{initialBlocks:[{type:"paragraph"}],onChange:()=>window.changed=(window.changed||0)+1});</script></body></html>';
const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;if(p==='/__harness'){res.setHeader('Content-Type','text/html');return res.end(harness);}const f=path.resolve(root,'.'+decodeURIComponent(p));if(!f.startsWith(path.resolve(root)+path.sep)||!/^\/(js|css|assets)\/|^\/admin-book-(editor|preview)\.html$/.test(p)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',types[path.extname(f)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(f));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});const report={checks:[],errors:[]};
try{const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto(origin+'/__harness');await page.waitForFunction(()=>window.h?.getEditor());await page.evaluate(()=>h.ready);
 for(const [type,label] of [['bookHeading','교재 제목'],['bookCallout','강조 상자'],['bookCompare','비교'],['bookAnnotated','지문 해설'],['bookQuestion','확인 문제'],['bookFlow','판단 흐름'],['bookMedia','학습 자료']]){
  await page.evaluate(()=>{h.setBlocks([{type:'paragraph'}]);h.getEditor().setTextCursorPosition(h.getEditor().document[0]);h.getEditor().focus();});
  await page.keyboard.type('/');await page.getByRole('option').filter({hasText:label}).first().waitFor();
  await page.getByRole('option').filter({hasText:label}).first().click();
  await page.waitForFunction(t=>h.getBlocks().some(b=>b.type===t),type);
  if(await page.locator('.book-design-toolbar,.book-design-controls').count())throw Error('Persistent authoring controls');
  const html=await page.evaluate(()=>h.getHTML());if(/data-design-inline|contenteditable|디자인 편집|book-design-settings/.test(html))throw Error('Editing UI leaked to export');
  report.checks.push({name:'slash-insert',type,passed:true});
 }
 await page.evaluate(()=>{h.setBlocks([{...BookEditor.createDesignBlock('bookCompare'),id:'compare-test'},{type:'paragraph'}]);});
 const field=page.locator('.book-compare [data-design-inline][aria-label="leftBody"]');
 await field.fill('직접 수정 첫 줄\n두 번째 줄');
 const immediate=await page.evaluate(()=>h.getBlocks().find(b=>b.id==='compare-test').props.leftBody);
 if(immediate!=='직접 수정 첫 줄\n두 번째 줄')throw Error('No-blur flush lost line breaks: '+immediate);
 await page.keyboard.press('End');await page.keyboard.type(' caret');
 if(!(await field.innerText()).endsWith('caret'))throw Error('Caret typing failed');
 await page.locator('#outside').click();
 if(!(await page.evaluate(()=>h.getBlocks().find(b=>b.id==='compare-test').props.leftBody)).endsWith('caret'))throw Error('Blur commit lost input');
 report.checks.push({name:'direct-text-flush-caret',passed:true});
 await field.focus();await page.keyboard.press('Home');await page.keyboard.press('Control+Home');await page.keyboard.type('/');
 await page.getByRole('dialog',{name:'디자인 설정',exact:true}).waitFor();
 await page.getByRole('dialog').getByLabel('테마',{exact:true}).selectOption('reading');
 await page.getByRole('button',{name:'디자인 설정 닫기'}).click();
 if(await page.getByRole('dialog').count())throw Error('Settings remained in body');
 if(await page.evaluate(()=>h.getBlocks().find(b=>b.id==='compare-test').props.theme)!=='reading')throw Error('Settings theme failed');
 report.checks.push({name:'on-demand-settings',passed:true});
 // IME drafts must never be silently exported while composition is incomplete.
 await field.focus();await field.dispatchEvent('compositionstart');await field.fill('한글 조합');
 if(await page.evaluate(()=>h.flush())!==false)throw Error('Composition was not held');
 await field.dispatchEvent('compositionend');if(!await page.evaluate(()=>h.flush()))throw Error('Composition not released');
 report.checks.push({name:'ime-flush',passed:true});await page.locator('#outside').click();
 // Ordinary slash items remain alongside the additions.
 await page.evaluate(()=>{h.setBlocks([{type:'paragraph'}]);h.getEditor().setTextCursorPosition(h.getEditor().document[0]);h.getEditor().focus();});await page.keyboard.type('/');
 const labels=await page.getByRole('option').allTextContents();if(!labels.some(x=>x.includes('표'))||!labels.some(x=>x.includes('이미지')))throw Error('Default slash items lost');await page.keyboard.press('Escape');report.checks.push({name:'default-menu-retained',passed:true});
 // Retain the three former toolbar presets as slash commands.
 for(const [label,type] of [['기본 비교표','table'],['사진·캡션','image'],['체크리스트 양식','checkListItem']]){await page.evaluate(()=>{h.setBlocks([{type:'paragraph'}]);h.getEditor().setTextCursorPosition(h.getEditor().document[0]);h.getEditor().focus();});await page.keyboard.type('/'+label);await page.getByRole('option').filter({hasText:label}).first().click();await page.waitForFunction(t=>h.getBlocks().some(b=>b.type===t),type);report.checks.push({name:'native-preset',label,passed:true});}
 // All props-backed content types remain directly editable, not merely visible.
 for(const [type,key] of [['bookCallout','title'],['bookAnnotated','passage'],['bookQuestion','question'],['bookFlow','decision'],['bookMedia','description']]){await page.evaluate(t=>h.setBlocks([{...BookEditor.createDesignBlock(t),id:'direct-test'},{type:'paragraph'}]),type);await page.locator('[data-design-inline][aria-label="'+key+'"]').fill('직접 본문 수정\n두 줄');const value=await page.evaluate(k=>h.getBlocks().find(b=>b.id==='direct-test').props[k],key);if(value!=='직접 본문 수정\n두 줄')throw Error('Direct props editing '+type+' '+JSON.stringify({value}));report.checks.push({name:'direct-props',type,passed:true});}
 // Remembered A cannot steal the settings command of a newly inserted B.
 await page.evaluate(()=>h.setBlocks([{...BookEditor.createDesignBlock('bookCompare'),id:'old-A'},{...BookEditor.createDesignBlock('bookFlow'),id:'new-B'},{type:'paragraph',id:'after-B'}]));await page.locator('.book-compare [aria-label="leftBody"]').click();await page.evaluate(()=>{h.getEditor().setTextCursorPosition('after-B');h.getEditor().focus();});await page.keyboard.type('/설정');await page.getByRole('option').filter({hasText:'판단 흐름 설정'}).click();await page.getByRole('dialog').getByLabel('테마',{exact:true}).selectOption('speaking');await page.getByRole('button',{name:'디자인 설정 닫기'}).click();if(await page.evaluate(()=>h.getBlocks().find(b=>b.id==='new-B').props.theme)!=='speaking')throw Error('Wrong settings target');if(await page.evaluate(()=>h.getBlocks().find(b=>b.id==='old-A').props.theme)!=='neutral')throw Error('Previous block changed');report.checks.push({name:'settings-target-is-current',passed:true});
 // Render existing real content without mutating any database or uploaded file.
 for(const width of [1440,360]){await page.setViewportSize({width,height:1000});for(const n of [1,52,94,118,123,224]){const row=fixture.pages.find(p=>p.sort_order===n);await page.evaluate(blocks=>h.setBlocks(blocks),row.blocks);await page.locator('#outside').click();await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+2);const state=await page.evaluate(()=>({controls:document.querySelectorAll('.book-design-toolbar,.book-design-controls,dialog[open]').length,overflow:document.documentElement.scrollWidth>innerWidth+2,blockCount:h.getBlocks().length}));if(state.controls||state.overflow)throw Error('Reading layout '+n+' '+width+' '+JSON.stringify(state));report.checks.push({name:'reading-layout',page:n,width,...state,passed:true});if(width===1440&&n===94)await page.locator('main').screenshot({path:session+'/tmp/slash-flow-clean-local.png'});}}
 // Exercise the unmodified server API contract through the real page/controller.
 // All REST requests are intercepted: production data and publication remain untouched.
 await context.addInitScript(()=>localStorage.setItem('iontoefl_user',JSON.stringify({role:'admin'})));
 const rows=structuredClone(fixture.pages),doc=structuredClone(fixture.document),versions=[];const writes=[];
 await context.route('**/rest/v1/**',async route=>{const req=route.request(),u=new URL(req.url()),table=u.pathname.split('/').pop(),method=req.method();const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,authorization,content-type,prefer,range,x-client-info','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'};if(method==='OPTIONS')return route.fulfill({status:204,headers});let data=table==='tr_book_pages'?rows:table==='tr_book_documents'?[doc]:table==='tr_book_page_versions'?versions:[];const match=x=>[...u.searchParams].every(([k,v])=>!v.startsWith('eq.')||String(x[k])===v.slice(3));if(method==='PATCH'){const patch=req.postDataJSON();data=data.filter(match);data.forEach(x=>Object.assign(x,patch));writes.push({table,method});}else if(method==='POST'){const input=req.postDataJSON();data={...input,id:crypto.randomUUID(),created_at:new Date().toISOString()};if(table==='tr_book_page_versions')versions.push(data);data=[data];writes.push({table,method});}else {data=data.filter(match);if(table==='tr_book_pages'&&u.searchParams.has('order'))data.sort((a,b)=>a.sort_order-b.sort_order);}return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify(data)});});
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/admin-book-editor.html?book='+doc.id);await page.waitForFunction(()=>typeof State!=='undefined'&&State.pages.length===292&&State.editors.size>0);
 const actual94=rows.find(p=>p.sort_order===94),marker='슬래시 직접저장 검증';await page.evaluate(id=>goToPage(id),actual94.id);await page.waitForFunction(id=>State.editors.get(id)?.getEditor(),actual94.id);const decision=page.locator('.bookedit-page[data-id="'+actual94.id+'"] [data-design-inline][aria-label="decision"]');await decision.fill(marker);await page.locator('#btnSave').click();await page.waitForFunction(()=>!document.querySelector('#btnSave').disabled&&State.dirty.size===0);
 if(!JSON.stringify(actual94.blocks).includes(marker)||!actual94.html.includes(marker)||!versions.some(v=>v.page_id===actual94.id))throw Error('Controller save did not persist blocks/html/version');
 await page.reload();await page.waitForFunction(()=>typeof State!=='undefined'&&State.pages.length===292&&State.editors.size>0);await page.evaluate(id=>goToPage(id),actual94.id);await decision.waitFor();if(await decision.innerText()!==marker)throw Error('Reload lost directly edited text');report.checks.push({name:'controller-save-version-reload',requestsIntercepted:true,writes,passed:true});
 await page.goto(origin+'/admin-book-preview.html?book='+doc.id+'&p=94');await page.waitForFunction(()=>document.querySelector('iframe')?.contentDocument?.querySelector('.book-flow')?.textContent.includes('슬래시 직접저장 검증')).catch(async e=>{console.log('PREVIEW_DEBUG',await page.evaluate(()=>({url:location.href,status:document.querySelector('#status')?.textContent,page:document.querySelector('#pageNumber')?.value,hasFrame:!!document.querySelector('iframe')?.contentDocument?.body})));throw e;});if(await page.frameLocator('iframe').locator('[data-design-inline],.book-design-controls,dialog').count())throw Error('Preview contains editing UI');report.checks.push({name:'saved-student-preview',requestsIntercepted:true,passed:true});
 if(report.errors.length)throw Error('Browser errors');report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;throw e;}finally{await fs.writeFile(session+'/tmp/slash-browser-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await browser.close();await new Promise(r=>server.close(r));}
