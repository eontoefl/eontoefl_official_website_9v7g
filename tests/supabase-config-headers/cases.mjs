// 합성 입력과 가짜 응답. 전부 지어낸 값이며 실제 학생·회원 자료가 아니다.
// args 는 호출할 때마다 새로 만든다(변경 전·후가 같은 입력을 받도록).

const utf8Base64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const hexOfBase64 = (b64) => Buffer.from(b64, 'base64').toString('hex');

// ---------------------------------------------------------------------------
// 가짜 응답 18종: 정상 JSON / 빈 본문 / Content-Range / 4xx·5xx 오류 본문
// ---------------------------------------------------------------------------
const rows = JSON.stringify([
    { id: 'a1', name: '가나다 & 라 마', n: 1 },
    { id: 'b2', name: null },
]);

export const responses = [
    { name: '정상 JSON 배열', status: 200, body: rows, headers: { 'Content-Type': 'application/json' } },
    { name: '정상 JSON 빈 배열', status: 200, body: '[]' },
    { name: '정상 JSON 객체', status: 200, body: JSON.stringify({ ok: true, value: 3, message: '본문 안의 message' }) },
    { name: '정상 JSON null', status: 200, body: 'null' },
    { name: '정상인데 JSON 아님', status: 200, body: 'OK 처리됨' },
    { name: '빈 본문 200', status: 200, body: '' },
    { name: '빈 본문 204', status: 204, body: null },
    { name: 'Content-Range 0-1/8310', status: 206, body: rows, headers: { 'Content-Range': '0-1/8310' } },
    { name: 'Content-Range */0', status: 200, body: '[]', headers: { 'Content-Range': '*/0' } },
    { name: 'Content-Range 0-14/* (건수 없음)', status: 200, body: rows, headers: { 'Content-Range': '0-14/*' } },
    { name: '400 message', status: 400, body: JSON.stringify({ message: '중복된 값 & 오류', code: '23505' }) },
    { name: '401 msg', status: 401, body: JSON.stringify({ msg: '권한 없음' }) },
    { name: '404 hint', status: 404, body: JSON.stringify({ hint: '힌트만 있음' }) },
    { name: '400 error', status: 400, body: JSON.stringify({ error: 'Bucket not found', statusCode: '404' }) },
    { name: '409 빈 객체', status: 409, body: '{}' },
    { name: '403 빈 본문', status: 403, body: '' },
    { name: '400 JSON 아님', status: 400, body: '<html>Bad Request</html>' },
    { name: '500 message', status: 500, body: JSON.stringify({ message: '서버 오류' }) },
];

// ---------------------------------------------------------------------------
// 입력 묶음
// ---------------------------------------------------------------------------
const getInputs = [
    { label: '인자 없음', args: () => ['applications'] },
    { label: '빈 객체', args: () => ['applications', {}] },
    { label: 'limit·page·내림차순', args: () => ['applications', { limit: 10, page: 2, sort: '-created_at' }] },
    { label: '문자열 숫자·오름차순·검색(한글, &, 공백)', args: () => ['applications', { limit: '5', page: '1', sort: 'name', search: '홍 길동 & 김' }] },
    { label: '한글 표 이름·limit 없는 page', args: () => ['한글 표', { page: 3 }] },
    { label: '특수문자 표 이름·필터(+, 한글, &, 빈 값)', args: () => ['a&b c', { filter: { email: 'eq.user+tag@gmail.com', '이름': 'like.*홍 길동*', 'a&b': 'x y', empty: '' } }] },
    { label: '0과 빈 문자열', args: () => ['applications', { limit: 0, page: 0, search: '', sort: '' }] },
    { label: '전부 null', args: () => ['applications', { limit: null, page: null, search: null, sort: null }] },
    { label: 'params 가 null', args: () => ['applications', null], noFetch: '오류' },
];

const idInputs = [
    { label: '보통 id', args: () => ['users', 'abc-123'] },
    { label: '한글·&·공백', args: () => ['한글 표', '가 나&다'] },
    { label: '빈 id', args: () => ['applications', ''] },
    { label: 'id 없음', args: () => ['applications', undefined] },
    { label: '숫자 id', args: () => ['applications', 42] },
    { label: '주소 특수문자', args: () => ['a&b', 'x?y=z#h'] },
];

const postInputs = [
    { label: '보통 본문(한글, &, 공백)', args: () => ['applications', { name: '홍길동', note: 'a & b c', n: 1, flag: true, nil: null }] },
    { label: '빈 객체', args: () => ['applications', {}] },
    { label: '한글 표·배열 본문', args: () => ['한글 표', [{ a: 1 }, { a: '둘' }]] },
    { label: 'null 본문', args: () => ['applications', null] },
    { label: '본문 없음', args: () => ['applications', undefined] },
    { label: '중첩·따옴표·줄바꿈·이모지·빈 값', args: () => ['a&b c', { nested: { deep: ['한글', '&', ' ', '"따옴표"', '웃음😀', '\n줄바꿈'] }, empty: '' }] },
];

const patchInputs = [
    { label: '보통 수정(한글, &)', args: () => ['applications', 'abc-123', { status: '승인 & 완료' }] },
    { label: '빈 id·빈 객체', args: () => ['applications', '', {}] },
    { label: '한글·&·공백·중첩', args: () => ['한글 표', '가 나&다', { a: null, b: [1, 2], c: { d: 'e f' } }] },
    { label: '숫자 id·본문 없음', args: () => ['applications', 7, undefined] },
    { label: 'id 없음·빈 값', args: () => ['applications', undefined, { x: '' }] },
];

const rpcInputs = [
    { label: '보통 인자(한글, &, 끝 공백)', args: () => ['pause_correction', { p_id: 'abc', p_reason: '사유 & 공백 ' }] },
    { label: '인자 생략', args: () => ['fn_no_args'] },
    { label: 'null 인자', args: () => ['fn_null', null] },
    { label: '한글·& 함수 이름·중첩 인자', args: () => ['한글함수 & 이름', { a: [1, 2, { b: 'c d' }], empty: '' }] },
    { label: '빈 객체', args: () => ['fn_empty', {}] },
    { label: '0 인자', args: () => ['fn_zero', 0] },
];

const deleteInputs = [
    { label: '보통 id', args: () => ['applications', 'abc-123'] },
    { label: '한글·&·공백', args: () => ['한글 표', '가 나&다'] },
    { label: '빈 id', args: () => ['applications', ''] },
    { label: 'id 없음', args: () => ['applications', undefined] },
    { label: '숫자 id', args: () => ['applications', 99] },
];

const queryInputs = [
    { label: '필터 생략', args: () => ['applications'] },
    { label: '빈 필터', args: () => ['applications', {}] },
    { label: '이메일의 +', args: () => ['users', { email: 'eq.user+tag@gmail.com' }] },
    { label: 'select·in·정렬·페이지(한글, 공백)', args: () => ['applications', { select: '*,users(name,email)', status: 'in.(대기,승인 완료)', order: 'created_at.desc', limit: 15, offset: 30 }] },
    { label: '한글 표·한글 키·&·빈 값·null·undefined', args: () => ['한글 표', { '이름': 'eq.홍 길동&김', empty: '', nil: null, undef: undefined, 'a&b': 'c=d' }] },
    { label: '필터가 null', args: () => ['applications', null], noFetch: '오류' },
];

// 파일 올리기: 기대 MIME 과 기대 바이트는 시험이 입력에서 직접 계산해 둔다.
const pngB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f, 0x80, 0x01]).toString('base64');
const allBytesB64 = Buffer.from(Array.from({ length: 256 }, (_, i) => i)).toString('base64');
const svgB64 = utf8Base64('<svg xmlns="http://www.w3.org/2000/svg"><text>한글 & 공백</text></svg>');
const textB64 = utf8Base64('메모 & 공백 한 줄\n둘째 줄');

const upload = (label, bucket, path, mimePart, mime, b64) => ({
    label,
    args: () => [bucket, path, `data:${mimePart};base64,${b64}`],
    expect: { mime, hex: hexOfBase64(b64) },
});

const uploadInputs = [
    upload('PNG 13바이트', 'guide-images', 'guide-images/abc123.png', 'image/png', 'image/png', pngB64),
    upload('0~255 전체 바이트·한글 경로(&, 공백)', 'book-assets', '한글 폴더/파일 이름&1.jpg', 'image/jpeg', 'image/jpeg', allBytesB64),
    upload('SVG(한글 본문)', 'docs', 'a/b/c.svg', 'image/svg+xml', 'image/svg+xml', svgB64),
    upload('빈 파일', 'docs', 'empty.bin', 'application/octet-stream', 'application/octet-stream', ''),
    upload('MIME 뒤에 charset', 'docs', 'note.txt', 'text/plain;charset=utf-8', 'text/plain', textB64),
    upload('대문자 MIME', 'docs', 'upper.PNG', 'IMAGE/PNG', 'IMAGE/PNG', pngB64),
    { label: 'base64 표시가 없는 data URI', args: () => ['docs', 'bad.txt', 'data:text/plain,hello'], noFetch: '오류' },
];

const body = (value) => JSON.stringify(value);

const fetchApiGetList = [
    { label: '옵션 없음', args: () => ['tables/applications'] },
    { label: 'limit·page·내림차순', args: () => ['tables/applications?limit=10&page=2&sort=-created_at'] },
    { label: '검색(한글, 공백)·오름차순·method 명시', args: () => ['tables/notices?limit=5&page=1&search=홍 길동&sort=title', { method: 'GET' }] },
    { label: '한글 표·인코딩된 검색(&)', args: () => ['tables/한글 표?search=%ED%95%9C%EA%B8%80%20%26%20x&limit=3', {}] },
];

const fetchApiGetOne = [
    { label: '보통 id', args: () => ['tables/users/abc-123'] },
    { label: '한글·&·공백', args: () => ['tables/한글 표/가 나&다', { method: 'GET' }] },
    { label: 'id 뒤에 쿼리', args: () => ['tables/applications/42?x=1'] },
];

const fetchApiPost = [
    { label: '보통 본문(한글, &)', args: () => ['tables/applications', { method: 'POST', body: body({ name: '홍길동', note: 'a & b' }) }] },
    { label: '한글 표·빈 객체', args: () => ['tables/한글 표', { method: 'POST', body: '{}' }] },
    { label: '배열 본문', args: () => ['tables/applications', { method: 'POST', body: body([{ a: 1 }, { a: '둘 & 셋' }]) }] },
    { label: '깨진 JSON 본문', args: () => ['tables/applications', { method: 'POST', body: '{잘못된 JSON' }], noFetch: '오류' },
    { label: '본문 없음', args: () => ['tables/applications', { method: 'POST' }], noFetch: '오류' },
];

const fetchApiWrite = (method) => [
    { label: '보통 수정(한글, &)', args: () => ['tables/applications/abc-123', { method, body: body({ status: '승인 & 완료' }) }] },
    { label: '한글·&·공백·빈 객체', args: () => ['tables/한글 표/가 나&다', { method, body: '{}' }] },
    { label: 'id 없음·null 값', args: () => ['tables/applications', { method, body: body({ a: null }) }] },
];

const fetchApiDelete = [
    { label: '보통 id', args: () => ['tables/applications/abc-123', { method: 'DELETE' }] },
    { label: '한글·&·공백', args: () => ['tables/한글 표/가 나&다', { method: 'DELETE' }] },
    { label: 'id 없음', args: () => ['tables/applications', { method: 'DELETE' }] },
];

const fetchApiOther = [
    { label: 'HEAD', args: () => ['tables/applications/abc', { method: 'HEAD' }], noFetch: '반환' },
    { label: '소문자 get', args: () => ['tables/applications', { method: 'get' }], noFetch: '반환' },
    { label: 'OPTIONS', args: () => ['tables/한글 표/가 나&다', { method: 'OPTIONS' }], noFetch: '반환' },
];

// ---------------------------------------------------------------------------
// 진입점: shape 는 계약서의 헤더 모양
//   json = ① / json+return = ② / json+count = ③ / upload = ④
// ---------------------------------------------------------------------------
const REST = '/rest/v1/';
const api = (method) => (g, a) => g.supabaseAPI[method](...a);
const viaFetchAPI = (g, a) => g.fetchAPI(...a);

export const targets = [
    { name: 'supabaseAPI.get', method: 'GET', shape: 'json+return', urlPrefix: REST, hasBody: false, invoke: api('get'), inputs: getInputs },
    { name: 'supabaseAPI.getById', method: 'GET', shape: 'json', urlPrefix: REST, hasBody: false, invoke: api('getById'), inputs: idInputs },
    { name: 'supabaseAPI.post', method: 'POST', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: api('post'), inputs: postInputs },
    { name: 'supabaseAPI.patch', method: 'PATCH', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: api('patch'), inputs: patchInputs },
    { name: 'supabaseAPI.put', method: 'PATCH', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: api('put'), inputs: patchInputs },
    { name: 'supabaseAPI.rpc', method: 'POST', shape: 'json', urlPrefix: REST + 'rpc/', hasBody: true, invoke: api('rpc'), inputs: rpcInputs },
    { name: 'supabaseAPI.delete', method: 'PATCH', shape: 'json', urlPrefix: REST, hasBody: true, invoke: api('delete'), inputs: deleteInputs },
    { name: 'supabaseAPI.hardDelete', method: 'DELETE', shape: 'json', urlPrefix: REST, hasBody: false, invoke: api('hardDelete'), inputs: deleteInputs },
    { name: 'supabaseAPI.query', method: 'GET', shape: 'json', urlPrefix: REST, hasBody: false, invoke: api('query'), inputs: queryInputs },
    { name: 'supabaseAPI.queryWithCount', method: 'GET', shape: 'json+count', urlPrefix: REST, hasBody: false, invoke: api('queryWithCount'), inputs: queryInputs },
    { name: 'supabaseStorage.uploadBase64', method: 'POST', shape: 'upload', urlPrefix: '/storage/v1/object/', hasBody: true, invoke: (g, a) => g.supabaseStorage.uploadBase64(...a), inputs: uploadInputs },
    { name: 'fetchAPI GET 목록', method: 'GET', shape: 'json+return', urlPrefix: REST, hasBody: false, invoke: viaFetchAPI, inputs: fetchApiGetList },
    { name: 'fetchAPI GET 단건', method: 'GET', shape: 'json', urlPrefix: REST, hasBody: false, invoke: viaFetchAPI, inputs: fetchApiGetOne },
    { name: 'fetchAPI POST', method: 'POST', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: viaFetchAPI, inputs: fetchApiPost },
    { name: 'fetchAPI PATCH', method: 'PATCH', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: viaFetchAPI, inputs: fetchApiWrite('PATCH') },
    { name: 'fetchAPI PUT', method: 'PATCH', shape: 'json+return', urlPrefix: REST, hasBody: true, invoke: viaFetchAPI, inputs: fetchApiWrite('PUT') },
    { name: 'fetchAPI DELETE', method: 'PATCH', shape: 'json', urlPrefix: REST, hasBody: true, invoke: viaFetchAPI, inputs: fetchApiDelete },
    { name: 'fetchAPI 그 밖의 메서드', method: null, shape: null, urlPrefix: REST, hasBody: false, invoke: viaFetchAPI, inputs: fetchApiOther },
];

// 시험이 빠뜨린 메서드가 없는지 확인할 때 쓰는 목록
export const expectedApiMethods = ['get', 'getById', 'post', 'patch', 'put', 'rpc', 'delete', 'hardDelete', 'query', 'queryWithCount'];
export const expectedStorageMethods = ['uploadBase64'];
