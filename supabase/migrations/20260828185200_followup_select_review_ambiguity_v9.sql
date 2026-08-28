-- Resolve the output-variable/table-column ambiguity found by the live
-- controlled-account writing test. Applied migrations remain untouched.

create or replace function public.followup_select_review(
  p_application_id uuid,
  p_current_score text,
  p_target_score text,
  p_referral_source text,
  p_created_at timestamptz,
  p_scheduled_at timestamptz
)
returns table(review_id text, selection_mode text, reached_target boolean)
language plpgsql
stable
set search_path = ''
as $$
<<followup_select_review_block>>
declare
  v_seed bigint := public.followup_fnv1a32(p_application_id::text);
  v_cur record;
  v_tgt record;
  v_cur_band text;
  v_tgt_band text;
  v_count integer;
  v_has_review boolean := false;
  v_candidates text[];
  v_elapsed integer := coalesce(floor(extract(epoch from (p_scheduled_at-p_created_at))/86400)::integer,0);
begin
  select * into v_cur from public.followup_writing_score(p_current_score,false);
  select * into v_tgt from public.followup_writing_score(p_target_score,true);

  if v_cur.is_blank and v_tgt.is_blank then
    review_id := case
      when coalesce(p_referral_source,'') ~* '(블로그|blog)' and v_elapsed <= 10 then 'blog1'
      when coalesce(p_referral_source,'') ~* '(블로그|blog)' then 'blog2'
      when v_elapsed <= 10 then '859'
      else '833'
    end;
    if not exists(
      select 1
      from public.followup_review_assets r
      where r.review_id = followup_select_review_block.review_id
    ) then
      review_id := '833';
    end if;
    selection_mode := '무점수무목표'; reached_target := false;
    return next; return;
  end if;

  if v_cur.is_blank then
    select count(*) into v_count
    from public.followup_review_assets r
    where r.band='무점수' and r.final_score >= v_tgt.score;
    if v_count > 0 then
      select r.review_id into review_id
      from public.followup_review_assets r
      where r.band='무점수' and r.final_score >= v_tgt.score
      order by r.sort_order
      offset (v_seed % v_count) limit 1;
      selection_mode := '무점수-도달'; reached_target := true;
    else
      select array_agg(r.review_id order by r.sort_order) into v_candidates
      from public.followup_review_assets r
      where r.band='무점수'
        and abs(r.final_score-v_tgt.score)=(select min(abs(x.final_score-v_tgt.score))
          from public.followup_review_assets x where x.band='무점수');
      review_id := v_candidates[1+(v_seed % cardinality(v_candidates))::integer];
      selection_mode := '무점수-폴백'; reached_target := false;
    end if;
    return next; return;
  end if;

  v_cur_band := case when v_cur.score < 60 then '40-50' when v_cur.score < 70 then '60s'
    when v_cur.score < 80 then '70s' when v_cur.score < 90 then '80s' else '90+' end;

  if v_tgt.is_blank then
    select array_agg(r.review_id order by r.sort_order) into v_candidates
    from public.followup_review_assets r
    where r.band=v_cur_band
      and abs(r.start_score-v_cur.score)=(select min(abs(x.start_score-v_cur.score))
        from public.followup_review_assets x where x.band=v_cur_band);
    review_id := v_candidates[1+(v_seed % cardinality(v_candidates))::integer];
    selection_mode := '유점수-무목표'; reached_target := false;
    return next; return;
  end if;

  v_tgt_band := case when v_tgt.score <= 80 then '≤80' when v_tgt.score <= 90 then '81-90'
    when v_tgt.score <= 100 then '91-100' when v_tgt.score <= 110 then '101-110' else '111-118' end;
  select coalesce(c.has_review,false) into v_has_review
  from public.review_combo c where c.current_band=v_cur_band and c.target_band=v_tgt_band;

  if v_has_review then
    select array_agg(r.review_id order by r.sort_order) into v_candidates
    from public.followup_review_assets r
    where r.band=v_cur_band and r.final_score >= v_tgt.score
      and abs(r.start_score-v_cur.score) <= 5;
    if coalesce(cardinality(v_candidates),0)=0 then
      select array_agg(r.review_id order by r.sort_order) into v_candidates
      from public.followup_review_assets r
      where r.band=v_cur_band and r.final_score >= v_tgt.score
        and abs(r.start_score-v_cur.score) <= 10;
    end if;
    if coalesce(cardinality(v_candidates),0)>0 then
      review_id := v_candidates[1+(v_seed % cardinality(v_candidates))::integer];
    end if;
    if review_id is not null then
      selection_mode := '유점수-도달'; reached_target := true;
      return next; return;
    end if;
  end if;

  select array_agg(r.review_id order by r.sort_order) into v_candidates
  from public.followup_review_assets r
  where r.band=v_cur_band
    and abs(r.start_score-v_cur.score)=(select min(abs(x.start_score-v_cur.score))
      from public.followup_review_assets x where x.band=v_cur_band);
  review_id := v_candidates[1+(v_seed % cardinality(v_candidates))::integer];
  selection_mode := '유점수-마스크폴백'; reached_target := false;
  return next;
end;
$$;

revoke all on function public.followup_select_review(uuid,text,text,text,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.followup_select_review(uuid,text,text,text,timestamptz,timestamptz)
  to service_role;
