import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformSync } from '../book-editor-src/node_modules/rolldown/dist/experimental-index.mjs';
import { renderToStaticMarkup } from '../book-editor-src/node_modules/react-dom/server.node.js';
const root = new URL('../book-editor-src/', import.meta.url);
const url = (path) => new URL(path, root).href;
function compile(source, filename) {
  const result = transformSync(filename, source, { jsx: { runtime: 'classic' } });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  return result.code;
}
const toModule = (source) => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const reactImport = `import React from '${url('node_modules/react/index.js')}';\n`;
let helperSource = await readFile(new URL('src/design-editing.jsx', root), 'utf8');
helperSource = helperSource.replace('import "./design-editing.css";', '')
  .replace('from "react"', `from '${url('node_modules/react/index.js')}'`)
  .replace('from "react-dom"', `from '${url('node_modules/react-dom/index.js')}'`)
  .replace('from "./design-data.js"', `from '${url('src/design-data.js')}'`);
const helperUrl = toModule(compile(reactImport + helperSource, 'design-editing.jsx'));
const helper = await import(helperUrl);
const source = await readFile(new URL('src/design-blocks.jsx', root), 'utf8');
async function loadBlocks(text) {
  text = text.replace('import { createReactBlockSpec } from "@blocknote/react";',
    'const createReactBlockSpec = (config, implementation) => () => ({config, implementation});')
    .replaceAll('from "./design-editing.jsx"', `from '${helperUrl}'`)
    .replace('from "./design-data.js"', `from '${url('src/design-data.js')}'`);
  return import(toModule(compile(reactImport + text, 'design-blocks.jsx')));
}
const blocks = await loadBlocks(source);
function block(type, patch = {}) {
  const spec = blocks.designBlockSpecs[type];
  return { id: type, type, props: { ...Object.fromEntries(Object.entries(spec.config.propSchema).map(([key, schema]) => [key, schema.default])), ...patch } };
}
function html(type, value) { return renderToStaticMarkup(blocks.designBlockSpecs[type].implementation.toExternalHTML({ block: value })); }

test('seven schema types, no inline controls or details', () => {
  assert.deepEqual(Object.keys(blocks.designBlockSpecs), ['bookHeading', 'bookCallout', 'bookCompare', 'bookAnnotated', 'bookQuestion', 'bookFlow', 'bookMedia']);
  assert.doesNotMatch(source, /<details|<summary|디자인 편집/);
  assert.equal((source.match(/<EditorControls block=\{block\} editor=\{editor\}>/g) || []).length, 7);
});
test('all seven external exports contain no editing UI/attributes', () => {
  for (const type of Object.keys(blocks.designBlockSpecs)) {
    assert.doesNotMatch(html(type, block(type)), /contenteditable|data-design-inline|role="textbox"|디자인 설정|<dialog|<details|aria-invalid/i);
  }
});
test('unsafe URLs never become links; safe URLs retain rel safety', () => {
  assert.doesNotMatch(html('bookMedia', block('bookMedia', {url:'javascript:alert(1)'})), /href=/);
  assert.match(html('bookMedia', block('bookMedia', {url:'https://example.com/a'})), /rel="noopener noreferrer"/);
});
test('malformed arrays remain untouched and keep warnings', () => {
  for (const [type, field] of [['bookAnnotated','notes'], ['bookQuestion','options']]) {
    for (const raw of ['{bad', '[null]', '[]']) {
      const value = block(type, {[field]:raw}); html(type, value); assert.equal(value.props[field], raw);
    }
  }
});
test('stale settings updates and wrong-type blocks cannot overwrite', () => {
  const before = block('bookCompare'); let current = structuredClone(before); let count = 0;
  const editor = {getBlock: () => current, updateBlock: (_id, patch) => {count++; current.props = {...current.props,...patch.props};}};
  assert.equal(helper.updateDesignProps(editor,before,{title:'new'}),true);
  assert.equal(helper.updateDesignProps(editor,before,{title:'stale'}),false);
  current.type='paragraph'; assert.equal(helper.updateDesignProps(editor,before,{theme:'reading'}),false);
  assert.equal(count,1);
});
test('active target and empty flush contract', () => {
  const value=block('bookFlow'); const editor={getBlock:(id)=>id===value.id?value:null};
  assert.equal(helper.getActiveDesignBlock(editor),null);
  helper.designRootEvents(editor,value,true).onFocusCapture();
  assert.equal(helper.getActiveDesignBlock(editor),value);
  assert.equal(helper.flushDesignEdits(editor),true);
  assert.deepEqual(helper.designRootEvents(editor,value,false),{});
});
// Optional local baseline comparison, with no dependency on git or stored pages.
if (process.env.DESIGN_BLOCKS_BASELINE) {
  test('all schemas and external HTML exactly match pre-edit baseline', async () => {
    const old = await loadBlocks(await readFile(process.env.DESIGN_BLOCKS_BASELINE,'utf8'));
    for (const type of Object.keys(blocks.designBlockSpecs)) {
      assert.deepEqual(blocks.designBlockSpecs[type].config, old.designBlockSpecs[type].config);
      for (const patch of [{}, {title:'한글 < & >',url:'https://example.com/a',passage:'a\nb'}, {notes:'[null]',options:'{bad'}]) {
        const value=block(type,patch);
        assert.equal(html(type,value),renderToStaticMarkup(old.designBlockSpecs[type].implementation.toExternalHTML({block:value})));
      }
    }
  });
}
