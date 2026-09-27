import { createExtension } from '@blocknote/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

// Use editor decorations, not direct DOM mutations: ProseMirror owns these nodes.
// Decorations change appearance only, never the stored block content or IDs.
export const PageFooterExtension = createExtension({
  key:'bookPageFooter',
  prosemirrorPlugins:[new Plugin({
    key:new PluginKey('bookPageFooter'),
    props:{decorations(state) {
      const group=state.doc.firstChild;
      if (!group || group.type.name!=='blockGroup') return DecorationSet.empty;
      const footers=[];
      group.forEach((block,offset)=>{
        const paragraph=block.firstChild;
        if (block.type.name==='blockContainer' && paragraph?.type.name==='paragraph' &&
            paragraph.attrs.textAlignment==='center' && /^\s*-\s*\d{1,4}\s*-\s*$/.test(paragraph.textContent)) {
          footers.push(Decoration.node(1+offset,1+offset+block.nodeSize,{class:'book-page-number'}));
        }
      });
      if (footers.length!==1) return DecorationSet.empty;
      return DecorationSet.create(state.doc,[Decoration.node(0,group.nodeSize,{class:'book-numbered-page'}),...footers]);
    }},
  })],
});
