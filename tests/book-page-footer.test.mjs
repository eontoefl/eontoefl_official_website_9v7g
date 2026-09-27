import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {Schema} from '../book-editor-src/node_modules/prosemirror-model/dist/index.js';
import {EditorState} from '../book-editor-src/node_modules/prosemirror-state/dist/index.js';
const source=await fs.readFile(new URL('../book-editor-src/src/page-footer.js',import.meta.url),'utf8');
const base=new URL('../book-editor-src/node_modules/',import.meta.url);
const moduleSource=source.replace("import { createExtension } from '@blocknote/core';","const createExtension = value => value;")
 .replace("'prosemirror-state'",JSON.stringify(new URL('prosemirror-state/dist/index.js',base).href))
 .replace("'prosemirror-view'",JSON.stringify(new URL('prosemirror-view/dist/index.js',base).href));
const {PageFooterExtension}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
const schema=new Schema({nodes:{doc:{content:'blockGroup'},blockGroup:{content:'blockContainer+'},blockContainer:{content:'paragraph blockGroup?'},paragraph:{content:'text*',attrs:{textAlignment:{default:'left'}}},text:{}}});
const block=(text,align='left',children)=>schema.node('blockContainer',null,[schema.node('paragraph',{textAlignment:align},text?schema.text(text):null),...(children?[schema.node('blockGroup',null,children)]:[])]);
function decorate(blocks){const doc=schema.node('doc',null,schema.node('blockGroup',null,blocks));const before=JSON.stringify(doc.toJSON());const found=PageFooterExtension.prosemirrorPlugins[0].props.decorations(EditorState.create({schema,doc})).find();assert.equal(JSON.stringify(doc.toJSON()),before);return found;}
test('one centered printed footer receives layout-only decorations',()=>{const found=decorate([block('body'),block('- 123 -','center')]);assert.equal(found.length,2);assert.deepEqual(found.map(x=>x.type.attrs.class),['book-numbered-page','book-page-number']);});
test('ordinary numbers, headings and nested examples are not footers',()=>{for(const body of [[block('123','center')],[block('- 123 -')],[block('body','left',[block('- 1 -','center')])]])assert.equal(decorate(body).length,0);});
test('ambiguous duplicate numbers are not silently reformatted',()=>assert.equal(decorate([block('- 1 -','center'),block('- 2 -','center')]).length,0));
test('footer remains detectable when more body text is added afterwards',()=>{const found=decorate([block('- 1 -','center'),block('added paragraph')]);assert.equal(found.length,2);assert.equal(found[1].from,1);});
