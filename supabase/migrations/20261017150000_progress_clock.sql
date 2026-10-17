-- One clock for progress.
--
-- stage_at was written by the server running the pipeline, except at
-- completion, where store_parse stamps it with the database's now(). The two
-- clocks differ (by over a second in development), so a finished run could
-- carry an earlier time than the stage before it, and the progress page,
-- which orders what it receives by that time, went back to "Storing" after
-- "Mapped". Whatever moves the progress, the database stamps it.

create function public.stamp_analysis_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- clock_timestamp, not now(): now() is the transaction's start, and
  -- store_parse moves the stage at the end of a long transaction.
  new.stage_at := clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.stamp_analysis_progress() from public, anon, authenticated;

-- Before the publishing trigger (an after trigger), so what's published is
-- the stamped value.
create trigger analyses_stamp_progress
before update of status, stage, stage_message, error on public.analyses
for each row
when (
  old.status is distinct from new.status
  or old.stage is distinct from new.stage
  or old.stage_message is distinct from new.stage_message
)
execute function public.stamp_analysis_progress();
