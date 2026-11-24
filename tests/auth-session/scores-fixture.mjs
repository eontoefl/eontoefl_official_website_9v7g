// 계약 3C-2a 의 합성 성적 행(전부 지어낸 값). 한 곳에 적어 두고 셋이 같이 쓴다:
//   * 넣는 SQL(b3c2a_scores_up.sql)의 값 — 회귀시험이 SQL 의 글자와 이 값이 같은지 본다
//   * 실행기(screen.mjs)의 --fake 가짜 서버가 갖는 행
//   * 실행기가 응답의 행을 "누구의 합성 행인가"로 가리는 지문(성적 응답에는 주인 열이 없다 — 날짜·점수로 가린다)
// 날짜는 일부러 아주 옛날(1999년)로 잡았다 — 실제 성적과 겹치지 않게.
// A 는 둘(가장 최근 것이 점수 칸의 미리 채움에 쓰인다), B 는 하나. 성적이 0건인 회원은 GM(6자리 전)이다 — 행을 넣지 않는다.

export const SCORE_MARK = 'zzb3c2a';       // 넣는 행의 user_name·memo 에 붙는 표식(지울 때 번호·주인·지문과 함께 본다)

export const SCORE_FIXTURE = {
    A: [
        { tag: 'A1', test_date: '1999-01-11', reading: 3.0, listening: 3.0, speaking: 3.0, writing: 3.0, overall: 3.0, legacy_total: null },
        { tag: 'A2', test_date: '1999-03-13', reading: 4.5, listening: 3.5, speaking: 2.5, writing: 5.5, overall: 4.0, legacy_total: 81 },
    ],
    B: [
        { tag: 'B1', test_date: '1999-02-12', reading: 2.0, listening: 2.5, speaking: 1.5, writing: 2.0, overall: 2.0, legacy_total: 45 },
    ],
};
export const SCORE_COLUMNS = ['test_date', 'reading', 'listening', 'speaking', 'writing', 'overall', 'legacy_total'];

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const printOf = (r) => [String(r.test_date), num(r.reading), num(r.listening), num(r.speaking), num(r.writing), num(r.overall), num(r.legacy_total)].join('|');
const PRINTS = new Map();
for (const [owner, rows] of Object.entries(SCORE_FIXTURE)) for (const r of rows) PRINTS.set(printOf(r), owner);

// 응답의 행 하나가 누구의 합성 행인가: 'A' / 'B' / 'other'(합성 행이 아니다 — 있으면 안 된다)
export const ownerOfRow = (row) => (row && typeof row === 'object' && PRINTS.get(printOf(row))) || 'other';
// 응답의 행들을 이름표로 센다(값은 돌려주지 않는다)
export function countRows(rows) {
    const out = { A: 0, B: 0, other: 0 };
    if (Array.isArray(rows)) for (const r of rows) out[ownerOfRow(r)]++;
    return out;
}
