# supabase-config.js 헤더 통합 회귀시험

`js/supabase-config.js`의 헤더 객체 10곳을 `supabaseHeaders()` 하나로 모은 뒤에도, 화면이 보내는 요청과 응답 처리가 전과 같은지 확인한다. (보안작업 묶음2 계약1, 기준 커밋 `8bddea5`)

## 실행

저장소 폴더에서, Node v26. 설치할 것은 없다.

```
node tests/supabase-config-headers/run.mjs
```

통과하면 마지막 줄이 `결과: 통과`이고 종료 코드가 0이다. 하나라도 다르면 `결과: 실패`와 종료 코드 1.

## 무엇을 비교하나

- 변경 전 파일(`git show 8bddea5:js/supabase-config.js`)과 지금 파일을 각각 가짜 브라우저 환경(vm)에 올린다.
- `supabaseAPI`의 메서드 10개, `supabaseStorage.uploadBase64`, `fetchAPI`의 갈래 7개(GET 목록·GET 단건·POST·PATCH·PUT·DELETE·그 밖의 메서드)를 같은 합성 입력으로 부른다.
- 호출마다 가짜 `fetch`에 넘어간 주소·메서드·헤더(이름·값·순서)·본문과, 가짜 응답 18종(정상 JSON / 빈 본문 / Content-Range / 4xx·5xx 오류 본문)에 대한 반환값 또는 오류 메시지를 대조한다. 파일 올리기는 `x-upsert` 헤더와 `Blob`의 MIME·바이트까지 본다.
- 헤더 10곳과 새 함수를 뺀 나머지 텍스트가 같은지 본다. 줄바꿈(CRLF/LF)은 맞춘 뒤 비교한다 — 이 저장소는 내려받을 때 CRLF로 바뀌고 커밋에는 LF로 들어가기 때문이다.
- 변경 후 파일을 메모리에서만 일부러 바꾼 사본 8개를 같은 방식으로 돌려, 시험이 차이를 실제로 잡는지 확인한다.

## 지키는 것

- 실제 네트워크 요청 0건. 시험은 가짜 `fetch`만 쓰고, Node의 연결 경로(net·tls·http·https·http2·dns·dgram·전역 fetch 등)를 막아 둔다. 막아 둔 길로 요청이 나가려 하면 실패한다.
- 공개 키 값은 출력하지 않는다. 차이가 나면 "어느 호출의 어느 항목(헤더 이름)"만 찍는다.
- 입력은 전부 지어낸 값이다.

## 파일

- `run.mjs` — 실행 파일. 텍스트 점검, 동작 비교, 감도 점검, 결과 요약.
- `harness.mjs` — 네트워크 차단, 가짜 환경, 호출 기록, 기록 비교.
- `cases.mjs` — 합성 입력과 가짜 응답.
