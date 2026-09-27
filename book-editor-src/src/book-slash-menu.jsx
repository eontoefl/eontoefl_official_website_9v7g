import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { createDesignBlock, designPresets } from './design-blocks.jsx';

export const bookThemes = [['neutral','기본 안내'],['reading','리딩'],['listening','리스닝'],['writing','라이팅'],['speaking','스피킹']];
const customTypes = new Set(designPresets.map(p => p.type));
export function currentDesignBlock(editor) {
  let cursor;
  try { cursor = editor.getTextCursorPosition(); } catch (_) {}
  if (customTypes.has(cursor?.block?.type)) return cursor.block;
  if (customTypes.has(cursor?.prevBlock?.type)) return cursor.prevBlock;
  return null;
}
export function bookSlashItems(editor, {theme='neutral',onTheme=()=>{},onConfigure}={}) {
  // Keep BlockNote's own paragraph/headings/table/image/list commands unchanged.
  const items = [...getDefaultReactSlashMenuItems(editor)];
  for (const preset of designPresets) items.push({
    title:preset.label, subtext:preset.description, group:'교재 요소',
    aliases:[preset.type,preset.label.replace(/\s/g,'')],
    onItemClick:()=>insertOrUpdateBlockForSlashMenu(editor,createDesignBlock(preset.type,theme)),
  });
  const nativePresets = [
    {title:'기본 비교표',aliases:['비교표','table'],block:{type:'table',content:{type:'tableContent',rows:[{cells:['항목','대상 A','대상 B']},{cells:['비교 기준','내용을 입력하세요','내용을 입력하세요']}]}}},
    {title:'사진·캡션',aliases:['사진','캡션','image'],block:{type:'image',props:{caption:'사진 설명을 입력하세요'}}},
    {title:'체크리스트 양식',aliases:['체크리스트','checklist'],block:{type:'checkListItem',content:'확인할 항목을 입력하세요'}},
  ];
  for (const preset of nativePresets) items.push({title:preset.title,aliases:preset.aliases,group:'교재 양식',onItemClick:()=>insertOrUpdateBlockForSlashMenu(editor,preset.block)});
  const target = currentDesignBlock(editor);
  if (target && onConfigure) {
    const name = designPresets.find(p=>p.type===target.type)?.label || '요소';
    items.push({title:name+' 설정',subtext:'선택한 요소의 색상·항목·정답 등을 변경합니다',group:'선택 요소',aliases:['설정','서식','색상','항목','정답'],onItemClick:()=>onConfigure(target.id)});
  }
  for (const [value,label] of bookThemes) items.push({
    title:'새 요소 색상 · '+label, subtext:value===theme?'현재 선택된 새 요소 색상':'앞으로 추가할 교재 요소의 색상',
    group:'새 요소 색상',aliases:[label,value,'테마','색상'],onItemClick:()=>onTheme(value),
  });
  return items;
}
export function filteredBookSlashItems(editor,query,options) {
  return filterSuggestionItems(bookSlashItems(editor,options),query);
}
