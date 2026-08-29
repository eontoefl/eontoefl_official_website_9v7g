-- 운영 시작 전에 잘못된 읽기 전용 샘플과 오래된 발송 대기 기록을 정리한다.

delete from public.followup_sample_previews
where id in ('sample-stage2', 'sample-stage3a', 'sample-stage3b');

update public.followup_sample_previews
set body = $body$규현님 안녕하세요, 이온입니다!
현재 61점(지금 기준 3.0레벨과 3.5레벨 사이)에서 100점(5.0레벨)을 목표로 잡으셨고, 스피킹이 가장 막힌다고 적어주신 게 눈에 들어와 연락드려요. 구점수랑 신점수 환산표는 이 메일에 파일로 첨부해뒀어요! 확인해보세요 :)

스피킹은 답을 많이 외우면 안전할 것 같지만 시험에서는 주제 단어 하나만 달라져도 외운 문장을 전부 바꿔야 해요. 채점할 때도 외운 답처럼 들리면 오히려 점수가 낮아질 수 있어서, 즉석에서 내 생각을 만드는 연습이 먼저예요. 더 답답한 건 내 답변을 내가 들으면 어떤 문법과 속도가 문제인지 잘 안 보인다는 거예요. 모범답안을 따라 해도 같은 자리에서 맴도는 이유가 여기에 있어요ㅠ

근데 여기서 뚫고 올라가신 분들도 있어요. 방법이 없는 게 아니라 방향이 다른 거예요. 규현님과 같은 61점에서 시작해 87점까지 올린 분도 있었고, 그분이 어떻게 공부했는지 남긴 후기예요. 목표 점수까지 갔다는 뜻은 아니지만 출발점이 같아서 참고하실 만해요!
https://eonfl.com/reviews.html?id=749

지금은 스피킹에서 무엇을 바꿔야 하는지 방향까지는 말씀드릴 수 있지만, 몇 주차에 무엇부터 하고 시험을 언제 볼지는 규현님 상황을 더 봐야 정할 수 있어요. 상황을 알려주시면 신청 내용을 직접 읽고 개별분석과 플랜을 무료로 짜드릴게요. 다만 신청하신 모든 분께 바로 분석을 드리는 건 아니고, 내용을 확인한 뒤 이번 주 분석 가능 여부를 안내드려요. 한 주에 봐드릴 수 있는 인원이 정해져 있어서 9월 3일 목요일까지 주시면 이번 순서로 검토하고, 그 뒤에는 다음 순서로 밀려요ㅠ

첫 시험은 준비를 다 끝낸 뒤 보려고 미루지 마세요. 중간에 한번 부딪혀봐야 다음 공부 순서가 빨리 잡혀요!

(100% 무료이고 수강하지 않으셔도 상관 없습니다!)
규현님 상황부터 알려주시면 신청 내용을 확인해서 안내드릴게요.

이온 드림
(로그인 해주세요!)
https://eonfl.com/application-form.html$body$,
    source_note = '실제 학생의 최신 신청서 자료로 작성하고 콜드아이즈 검토를 반영한 읽기 전용 샘플입니다. 발송 장부와 연결되지 않아 발송될 수 없습니다.',
    updated_at = now()
where id = 'sample-stage1';

do $block$
declare
  v_job record;
  v_request_id uuid := 'c1ea0ed1-44cd-4b1b-a60b-7d0486d8c114';
begin
  for v_job in
    select j.id
    from public.followup_jobs j
    where j.id = any(array[
      '03608bb5-e65a-4a43-a9ee-f6c1a0d7e873'::uuid,
      '0e0abfa6-d2f5-4070-b6b8-02b1668d78c7'::uuid,
      '16e9b97c-728e-4d4b-8960-bcef8d3a7dc2'::uuid,
      '2add1d5e-3697-4d8f-9347-1ffbb3253ad6'::uuid,
      '2eb51444-4363-45d7-8dd1-67b3c62c3805'::uuid,
      '42405119-20b6-4256-a0b9-5e41be6c678f'::uuid,
      '5122ec5b-8bc5-4ef3-a187-d744ea2398ef'::uuid,
      '5b4b3f77-06d3-4ccd-92d8-54b6e8348b9e'::uuid,
      '6d22c4fb-eb20-432b-b6e4-f5559e9f1081'::uuid,
      '7ef3b532-365d-448f-86b1-3d0ecb03997a'::uuid,
      '81691c6d-1d15-49df-921e-ee7c667679a1'::uuid,
      '8e76bb0b-7e35-4311-bee0-fd76a1654a04'::uuid,
      'f066ae02-af50-4062-b893-30420738c5b2'::uuid,
      '498151c6-1fe3-49af-bcd7-7aab8635ca93'::uuid
    ])
      and j.status = 'scheduled'
      and j.candidate_first_seen_at is null
      and not exists (
        select 1 from public.followup_messages m where m.job_id = j.id
      )
  loop
    perform public.followup_skip_stale_job(
      v_job.id,
      v_request_id,
      '기존 발송 대기 기록 종료 — 운영 시작 전 정리',
      null
    );
  end loop;
end;
$block$;
