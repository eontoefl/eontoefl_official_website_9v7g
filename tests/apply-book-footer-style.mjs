// Batch-update the shared footer style. No page-by-page edits or database writes.
// Usage: node tests/apply-book-footer-style.mjs <student-repository> [fontPx=10] [gapPx=10]
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const viewer=process.argv[2]&&path.resolve(process.argv[2]);
const font=Number(process.argv[3]||10),gap=Number(process.argv[4]||10);
if(!viewer||!Number.isFinite(font)||font<8||font>16||!Number.isFinite(gap)||gap<0||gap>24)throw Error('Provide student repository, font 8–16px and gap 0–24px.');
const normalize=s=>s.replace(/\r\n/g,'\n');
const editorFile=path.join(root,'css/book-page-footer.css'),viewerFile=path.join(viewer,'css/book-page-footer.css'),trialFile=path.join(root,'css/book-editor-reading.css');
const original=normalize(await fs.readFile(editorFile,'utf8'));
const viewerOriginal=normalize(await fs.readFile(viewerFile,'utf8'));
if((original.match(/font-size:\d+(?:\.\d+)?px!important/g)||[]).length!==2)throw Error('Unexpected footer font rules; inspect before applying.');
let next=original.replace(/font-size:\d+(?:\.\d+)?px!important/g,`font-size:${font}px!important`).replace(/\n?\/\* BEGIN BATCH FOOTER SPACING \*\/[\s\S]*?\/\* END BATCH FOOTER SPACING \*\/\n?/g,'\n').trimEnd();
next+=`\n\n/* BEGIN BATCH FOOTER SPACING */
/* Approved gap: ${gap}px. Use existing paper padding without moving body content. */
.bookedit-paper { --book-footer-offset:${48-gap}px; }
.preview-page .book-content { --book-footer-offset:${42-gap}px; }
.bookv2-paper { --book-footer-offset:${72-gap}px; }
.book-content.book-numbered-page > .book-page-number,
.bookedit-paper .bn-editor > .bn-block-group > .book-page-number {
  transform:translateY(var(--book-footer-offset,0px));
}
@media(max-width:760px) {
  .preview-page .book-content { --book-footer-offset:${20-gap}px; }
}
@media(max-width:720px) {
  .bookv2-paper { --book-footer-offset:${56-gap}px; }
}
@media(max-width:680px) {
  .bookedit-paper { --book-footer-offset:${28-gap}px; }
  .bookv2-paper { --book-footer-offset:${38-gap}px; }
}
/* END BATCH FOOTER SPACING */\n`;
if(viewerOriginal!==original&&viewerOriginal!==next)throw Error('Student stylesheet diverged; refusing to overwrite it.');
const trialOriginal=normalize(await fs.readFile(trialFile,'utf8'));
const trial=trialOriginal.replace(/\n\/\* Position trial:[\s\S]*?\n\}\n@media\(max-width:680px\) \{\n[\s\S]*?\n\}\n?$/,'\n').trimEnd()+'\n';
if(trial.includes('29e8f4be-dc14-4188-ba58-f343b9f51aeb'))throw Error('First-page trial rule remains.');
const plan=[[editorFile,original,next],[viewerFile,viewerOriginal,next],[trialFile,trialOriginal,trial]];
const changed=[];for(const [file,before,after] of plan){if(before!==after){await fs.writeFile(file,after);changed.push(file);}}
console.log(JSON.stringify({fontPx:font,bottomGapPx:gap,changedFiles:changed.length,files:changed,pageDataWrites:0}));
