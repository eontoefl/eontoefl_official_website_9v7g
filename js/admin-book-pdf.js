// 2026-11-17 관리자 "PDF 저장": 이름 없는 원본 PDF(210×280). 보이지 않는 칸에 인쇄용 쪽을 그려 두고 바로 인쇄 창을 띄운다.
// (학생 화면의 인쇄 버튼은 쪽마다 학생 이름·이메일이 찍힌 PDF, 이건 인쇄소·보관용 원본)
window.AdminBookPdf = (function () {
  let busy = false;
  async function save(bookId, opts) {
    opts = opts || {};
    if (busy || !bookId) return; busy = true;
    const say = opts.onState || function () {};
    say('PDF 준비 중이에요… 쪽이 많으면 잠깐 걸려요');
    const old = document.getElementById('adminPdfFrame'); if (old) old.remove();
    const f = document.createElement('iframe'); f.id = 'adminPdfFrame'; f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:1200px;border:0;visibility:hidden';
    const q = new URLSearchParams({ book: bookId }); if (opts.dev) q.set('dev', '1');
    f.src = 'admin-book-preview-v2.html?' + q.toString();
    document.body.appendChild(f);
    try {
      const t0 = Date.now();
      while (!(f.contentWindow && f.contentWindow.__pvReady)) {
        if (Date.now() - t0 > 120000) throw new Error('시간이 너무 오래 걸려요');
        const st = f.contentDocument && f.contentDocument.getElementById('status');
        if (st && /옮기지 않은|없어요/.test(st.textContent)) throw new Error(st.textContent);
        await new Promise((r) => setTimeout(r, 300));
      }
      const w = f.contentWindow; if (w.document.fonts) await w.document.fonts.ready;
      await Promise.all([...w.document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
      say('');
      w.focus(); w.print();
    } catch (e) { say('PDF를 만들지 못했어요: ' + e.message, true); }
    finally { busy = false; setTimeout(() => { const x = document.getElementById('adminPdfFrame'); if (x) x.remove(); }, 1000); }
  }
  return { save: save };
})();
