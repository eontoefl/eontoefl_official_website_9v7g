create index if not exists followup_writing_inputs_application_idx
  on public.followup_writing_inputs(application_id);

create index if not exists followup_writing_inputs_attachment_idx
  on public.followup_writing_inputs(attachment_asset_id)
  where attachment_asset_id is not null;

create index if not exists followup_writing_inputs_review_idx
  on public.followup_writing_inputs(used_review_id)
  where used_review_id is not null;
