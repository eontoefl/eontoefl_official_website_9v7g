create index if not exists followup_candidate_issues_member_idx
  on public.followup_candidate_issues (member_user_id)
  where member_user_id is not null;
