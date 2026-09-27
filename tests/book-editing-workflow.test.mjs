import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const slashSource = await fs.readFile(new URL('../book-editor-src/src/book-slash-menu.jsx', import.meta.url),'utf8');
const stubs = `
const designPresets=['bookHeading','bookCallout','bookCompare','bookAnnotated','bookQuestion','bookFlow','bookMedia'].map(type=>({type,label:type}));
const getDefaultReactSlashMenuItems=editor=>editor.defaults;
const filterSuggestionItems=(items,query)=>items.filter(i=>i.title.includes(query));
const insertOrUpdateBlockForSlashMenu=(editor,block)=>editor.inserted.push(block);
const createDesignBlock=(type,theme)=>({type,props:{theme}});
`;
const menu = await import('data:text/javascript;base64,'+Buffer.from(stubs+slashSource.replace(/^import .*\n/gm,'')).toString('base64'));
function editor(cursor={block:{type:'paragraph'}}){return {defaults:[{title:'기본 제목'}],inserted:[],getTextCursorPosition:()=>cursor};}
test('default commands are retained and all ten former toolbar presets insert',()=>{
 const ed=editor(),items=menu.bookSlashItems(ed,{theme:'reading'});
 assert.equal(items[0],ed.defaults[0]);
 const presets=items.filter(i=>['교재 요소','교재 양식'].includes(i.group));
 assert.equal(presets.length,10);presets.forEach(i=>i.onItemClick());
 assert.equal(ed.inserted.length,10);
 assert.ok(ed.inserted.slice(0,7).every(b=>b.props.theme==='reading'));
 assert.equal(ed.inserted[7].content.rows[0].cells.length,3);
 assert.match(ed.inserted[8].props.caption,/사진/);
 assert.equal(ed.inserted[9].type,'checkListItem');
});
test('settings target current/adjacent block, never stale remembered A',()=>{
 const A={id:'A',type:'bookCompare'},B={id:'B',type:'bookFlow'};let configured;
 const ed=editor({block:{type:'paragraph'},prevBlock:B});
 menu.bookSlashItems(ed,{activeBlock:A,onConfigure:id=>configured=id}).find(i=>i.group==='선택 요소').onItemClick();
 assert.equal(configured,'B');
 assert.equal(menu.currentDesignBlock(editor({block:A,prevBlock:B})),A);
 assert.equal(menu.currentDesignBlock(editor(),A),null);
});
test('all five new-element colors are slash commands',()=>{
 const ed=editor();const selected=[];const items=menu.bookSlashItems(ed,{onTheme:t=>selected.push(t)}).filter(i=>i.group==='새 요소 색상');
 assert.equal(items.length,5);items.forEach(i=>i.onItemClick());assert.deepEqual(selected,['neutral','reading','listening','writing','speaking']);
});
const controller=await fs.readFile(new URL('../js/admin-book-editor.js',import.meta.url),'utf8');
function declaration(name,next){const start=controller.indexOf('function '+name+'(');assert.ok(start>=0);const end=controller.indexOf(next,start);assert.ok(end>start);return controller.slice(start,end);}
test('rejected restore cannot leave change tracking suppressed',()=>{
 const suppress=new Set();const error=new Error('unfinished input');
 const context={State:{suppress},ensureMounted:()=>({setBlocks:()=>{throw error;}}),setTimeout:fn=>fn()};
 vm.runInNewContext(declaration('setBlocksQuiet','// ---------------------------------------------------------------------'),context);
 assert.throws(()=>context.setBlocksQuiet('page',[]),/unfinished input/);assert.equal(suppress.size,0);
});
test('restore failure is visible and does not report a successful replacement',()=>{
 const messages=[];const context={confirm:()=>true,State:{currentId:'page'},setBlocksQuiet:()=>{throw Error('pending edit');},setStatus:(...args)=>messages.push(args),alert:m=>messages.push(m),closeVersions:()=>assert.fail('Must keep restore dialog open')};
 vm.runInNewContext(declaration('restoreVersion','function closeVersions'),context);
 context.restoreVersion({blocks:[]});assert.equal(messages[0][0],'error');assert.equal(messages[1],'pending edit');
});
