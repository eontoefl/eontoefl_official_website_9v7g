-- 단계별 실제형 샘플은 실제 발송 장부와 완전히 분리한다.
create table if not exists public.followup_sample_previews (
  id text primary key,
  application_id uuid not null references public.applications(id) on delete restrict,
  stage text not null unique check (stage in ('stage1','stage2','stage3a','stage3b')),
  name text not null,
  subject text not null,
  body text not null,
  attachment_asset_id text,
  source_note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint followup_sample_previews_id_check check (id = 'sample-' || stage)
);

comment on table public.followup_sample_previews is
  'Read-only previews for the administrator. This table is intentionally separate from followup_jobs and has no send path.';

alter table public.followup_sample_previews enable row level security;
revoke all on table public.followup_sample_previews from public, anon, authenticated;
revoke all on table public.followup_sample_previews from service_role;
grant select on table public.followup_sample_previews to service_role;

-- 이전에 실제 장부에 잘못 끼워 넣었던 네 개의 가짜 샘플만 정확한 번호로 제거한다.
-- applications의 자식 샘플 기록은 기존 외래키 규칙에 따라 함께 제거된다.
delete from public.applications
where id in (
  '98000000-0000-0000-0000-000000000101'::uuid,
  '98000000-0000-0000-0000-000000000102'::uuid,
  '98000000-0000-0000-0000-000000000103'::uuid,
  '98000000-0000-0000-0000-000000000104'::uuid
)
and coalesce(deleted,false)=true
and lower(coalesce(email,'')) like 'followup-stage%-sample@invalid.test';

delete from public.followup_suppressions
where lower(coalesce(email,'')) in (
  'followup-stage1-sample@invalid.test',
  'followup-stage2-sample@invalid.test',
  'followup-stage3a-sample@invalid.test',
  'followup-stage3b-sample@invalid.test'
)
and reason='test'
and label like '[샘플]%';

insert into public.followup_sample_previews
  (id,application_id,stage,name,subject,body,attachment_asset_id,source_note,created_at,updated_at)
values
('sample-stage1','d591a443-875d-4af0-863d-8b4a7d70aca3'::uuid,'stage1','박규현','규현님, 이온입니다','규현님 안녕하세요, 이온입니다!
현재 61점(지금 기준 3.0레벨과 3.5레벨 사이)에서 100점(5.0레벨)을 목표로 잡으셨고, 스피킹이 가장 막힌다고 적어주신 게 눈에 들어와 연락드려요 :) 구점수랑 신점수 환산표는 이 메일에 파일로 첨부해뒀어요! 확인해보세요 :)

스피킹은 답을 많이 외우면 안전할 것 같지만 시험에서는 주제 단어 하나만 달라져도 외운 문장을 전부 바꿔야 해요. 채점할 때도 외운 답처럼 들리면 오히려 점수가 낮아질 수 있어서, 즉석에서 내 생각을 만드는 연습이 먼저예요. 더 답답한 건 내 답변을 내가 들으면 어떤 문법과 속도가 문제인지 잘 안 보인다는 거예요. 모범답안을 따라 해도 같은 자리에서 맴도는 이유가 여기에 있어요ㅠ

근데 여기서 뚫고 올라가신 분들도 있어요. 방법이 없는 게 아니라 방향이 다른 거예요. 규현님과 같은 61점에서 시작해 87점까지 올린 분도 있었고, 그분이 어떻게 공부했는지 남긴 후기예요. 목표 점수까지 갔다는 뜻은 아니지만 출발점이 같아서 참고하실 만해요!
https://eonfl.com/reviews.html?id=749

지금은 스피킹에서 무엇을 바꿔야 하는지 방향까지는 말씀드릴 수 있지만, 몇 주차에 무엇부터 하고 시험을 언제 볼지는 규현님 상황을 더 봐야 정할 수 있어요. 상황을 알려주시면 제가 직접 한 자 한 자 읽고 개별분석과 플랜을 무료로 짜드릴게요. 한 명씩 직접 쓰다 보니 한 주에 봐드릴 수 있는 인원이 정해져 있어서 9월 3일 목요일까지 주시면 이번 순서로 보고, 그 뒤에는 다음 순서로 밀려요ㅠ

첫 시험은 준비를 다 끝낸 뒤 보려고 미루지 마세요. 중간에 한번 부딪혀봐야 다음 공부 순서가 빨리 잡혀요!

(100% 무료이고 수강하지 않으셔도 상관 없습니다!)
규현님 상황부터 알려주시면 제가 다음 순서를 잡아둘게요.

이온 드림
(로그인 해주세요!)
https://eonfl.com/application-form.html','score-conversion-2026-v1','실제 학생의 최신 신청서 자료로 새로 작성한 읽기 전용 샘플입니다. 발송 장부와 연결되지 않아 발송될 수 없습니다.',now(),now()),
('sample-stage2','d6a2aba7-66b3-45ac-bcb8-c3e950f92d19'::uuid,'stage2','이유림','유림님, 개별분석 관련해서 연락드립니다!','유림님 안녕하세요, 이온입니다!
첫 시험에서 리딩과 리스닝은 받쳐주는데 라이팅만 2.0레벨로 내려간 건 영어 전체가 부족해서가 아니에요. 시간 안에 직접 써본 횟수와 컴퓨터로 답을 만드는 연습이 거의 없었던 게 점수에 그대로 보였어요 :)

개별분석에는 전체 3.5레벨에서 목표인 4.0레벨로 가려면 무엇부터 고쳐야 하는지 순서를 적어뒀어요. 리딩과 리스닝을 처음부터 다시 하는 게 아니라 라이팅과 스피킹에서 빠지는 점수를 먼저 막아야 해요. 지금처럼 하루 4시간에서 5시간을 쓸 수 있다면 양을 더 늘리는 것보다 그 시간을 네 영역에 어떻게 나눌지가 더 중요해요.

9월 3일 목요일까지 분석 내용과 일정을 확인하고 동의해주시면 9월 6일 일요일 시작으로 이어갈 수 있어요. 시작하고 나면 제가 한 명씩 직접 답을 봐야 해서 한 주에 시작하는 인원이 정해져 있거든요. 읽다가 실제 상황과 다른 부분이 있으면 동의 전에 한 줄로 알려주세요.

유림님은 지금 공부를 다시 시작할 단계가 아니라, 이미 한 공부가 점수로 나오게 순서를 바로잡을 단계예요! 분석 내용 확인하고 다음 걸음만 마무리해주세요.

이온 드림
(로그인 해주세요!)
https://eonfl.com/application-detail.html?id=d6a2aba7-66b3-45ac-bcb8-c3e950f92d19#step2',null,'실제 학생의 최신 신청서 자료로 새로 작성한 읽기 전용 샘플입니다. 발송 장부와 연결되지 않아 발송될 수 없습니다.',now(),now()),
('sample-stage3a','37ea563c-c770-427a-b510-0491edbcee58'::uuid,'stage3a','유효정','효정님, 계약서 관련해서 연락드립니다!','효정님 안녕하세요, 이온입니다!
개별분석에서 공부한 시간은 길었지만 실제로 혼자 풀어본 시간이 적었다는 부분을 시작 전에 꼭 바로잡아야 했어요. 프로그램과 일정은 모두 확인하셨고 이제 계약서만 남아서 연락드려요 :)

계약서 문구를 보다가 실제로 정한 내용과 다른 부분이 있으면 그 부분만 알려주세요. 별문제 없으면 9월 3일 목요일까지 마무리해주시면 9월 6일 일요일 시작 순서로 이어갈게요. 제가 한 명씩 직접 봐야 해서 이 날짜를 넘기면 시작 순서가 뒤로 밀릴 수 있어요ㅠ

효정님은 공부 방향과 일정까지 이미 정해졌어요. 계약서만 마무리하면 끝이에요!

이온 드림
(로그인 해주세요!)
https://eonfl.com/application-detail.html?id=37ea563c-c770-427a-b510-0491edbcee58#step3',null,'실제 학생의 최신 신청서 자료로 새로 작성한 읽기 전용 샘플입니다. 발송 장부와 연결되지 않아 발송될 수 없습니다.',now(),now()),
('sample-stage3b','a197058c-4fbe-4817-81c1-1746749bca2f'::uuid,'stage3b','류완기','완기님, 등록 관련해서 연락드립니다!','완기님 안녕하세요, 이온입니다!
이미 높은 점수까지 만들어보신 분이라 처음부터 다시 배우는 계획이 아니라, 지금 감각을 되찾고 필요한 부분만 끌어올리는 일정으로 정리했어요. 갑자기 길어진 석사 과정 때문에 다시 토플을 잡으신 만큼 이번에는 시작만 더 미루지 않는 게 좋아요 :)

계약서까지 모두 끝났고 등록 확정만 남았어요. 9월 3일 목요일까지 마무리하면 9월 6일 일요일 시작 순서로 이어갈 수 있어요. 제가 한 명씩 직접 답을 보면서 진행해서 이 날짜를 넘기면 다음 시작 순서로 밀릴 수 있어요ㅠ

진행하다 걸리는 내용이 있으면 마무리하기 전에 알려주세요. 별문제 없다면 완기님은 등록 확정만 하면 끝이에요!

이온 드림
(로그인 해주세요!)
https://eonfl.com/application-detail.html?id=a197058c-4fbe-4817-81c1-1746749bca2f#step4',null,'실제 학생의 최신 신청서 자료로 새로 작성한 읽기 전용 샘플입니다. 발송 장부와 연결되지 않아 발송될 수 없습니다.',now(),now())
on conflict (id) do update set
  application_id=excluded.application_id,
  stage=excluded.stage,
  name=excluded.name,
  subject=excluded.subject,
  body=excluded.body,
  attachment_asset_id=excluded.attachment_asset_id,
  source_note=excluded.source_note,
  updated_at=now();

