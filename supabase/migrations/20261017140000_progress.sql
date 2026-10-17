-- Live progress, and starting an analysis as the signed-in user.
--
-- Progress is pushed by the database, not polled by the browser: a trigger on
-- public.analyses publishes each stage change to that analysis's private
-- Realtime channel, and the progress page subscribes to it.

-- ---------------------------------------------------------------------------
-- The channel: one per analysis, named analysis:<uuid>
-- ---------------------------------------------------------------------------

-- The topic pattern is declared here, once. The trigger publishes with
-- analysis_topic(); the subscribe policy reads topics back with
-- analysis_id_from_topic(). A topic built any other way matches nothing, so a
-- typo on either side can't publish to (or authorize) a channel nobody uses.

create function public.analysis_topic(p_analysis_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'analysis:' || p_analysis_id::text
$$;

-- The analysis a topic belongs to, or null if the topic isn't one of ours.
create function public.analysis_id_from_topic(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(p_topic, 10)::uuid
  end
$$;

-- ---------------------------------------------------------------------------
-- Publishing: a trigger on our own table
-- ---------------------------------------------------------------------------

-- Publishes the stage and what to say about it, not the row: the page has
-- nothing to filter and nothing to interpret. status rides along because the
-- page must know when to stop listening; on failure the message is the error.
--
-- security definer: runs write as the service role, and publishing is an
-- insert into realtime.messages that the caller's role needn't be granted.
create function public.publish_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status',  new.status,
      'stage',   new.stage,
      'message', case when new.status = 'failed' then new.error else new.stage_message end,
      'at',      new.stage_at
    ),
    'progress',
    public.analysis_topic(new.id),
    true -- private: only subscribers the policy below admits
  );
  return null;
end;
$$;

revoke execute on function public.publish_analysis_progress() from public, anon, authenticated;

create trigger analyses_publish_progress
after update of status, stage, stage_message, error on public.analyses
for each row
when (
  old.status is distinct from new.status
  or old.stage is distinct from new.stage
  or old.stage_message is distinct from new.stage_message
)
execute function public.publish_analysis_progress();

-- ---------------------------------------------------------------------------
-- Subscribing: the same rule as reading the row
-- ---------------------------------------------------------------------------

-- A member may join an analysis's channel exactly when they may read the
-- analysis. The subquery runs under the subscriber's own RLS, so another
-- organization's analysis isn't there to match. No insert policy: clients
-- can listen, never broadcast.
create policy "Members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.analyses a
      where a.id = public.analysis_id_from_topic((select realtime.topic()))
    )
  );

-- ---------------------------------------------------------------------------
-- Starting an analysis, as the signed-in user
-- ---------------------------------------------------------------------------

-- Members may create rows in their own organization, and only the columns a
-- submission sets. Status, stage, results and errors are written by runs.
create policy "Members add their organization"
  on public.organizations for insert to authenticated
  with check (id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members add projects to their organization"
  on public.projects for insert to authenticated
  with check (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members add analyses to their organization"
  on public.analyses for insert to authenticated
  with check (org_id = (select auth.jwt() -> 'o' ->> 'id'));

revoke insert on public.organizations, public.projects, public.analyses from authenticated;
grant insert (id, slug, name) on public.organizations to authenticated;
grant insert (org_id, repo_owner, repo_name, default_branch) on public.projects to authenticated;
grant insert (org_id, project_id) on public.analyses to authenticated;

-- One analysis per repository, found or created atomically. Returns the
-- analysis and whether this call created it: an existing one is returned as
-- it is, never duplicated and never restarted. Re-running is a separate,
-- deliberate act.
--
-- security invoker: every insert and select below goes through the policies
-- and grants above, as the caller. The organization comes from the token.
create function public.start_analysis(p_owner text, p_name text, p_default_branch text)
returns table (analysis_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id     text := (select auth.jwt() -> 'o' ->> 'id');
  v_org_slug   text := (select auth.jwt() -> 'o' ->> 'slg');
  v_project_id uuid;
  v_id         uuid;
begin
  if v_org_id is null then
    raise exception 'no active organization on the session token' using errcode = '42501';
  end if;

  -- Organizations are mirrored lazily: the first submission creates the row.
  -- The token carries the slug but not the display name, so the slug stands
  -- in until something syncs the name.
  insert into public.organizations (id, slug, name)
  values (v_org_id, coalesce(v_org_slug, v_org_id), coalesce(v_org_slug, v_org_id))
  on conflict do nothing;

  insert into public.projects (org_id, repo_owner, repo_name, default_branch)
  values (v_org_id, p_owner, p_name, p_default_branch)
  on conflict (org_id, repo_owner, repo_name) do nothing;

  select p.id into v_project_id
  from public.projects p
  where p.org_id = v_org_id and p.repo_owner = p_owner and p.repo_name = p_name;

  insert into public.analyses (org_id, project_id)
  values (v_org_id, v_project_id)
  on conflict (project_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, true;
  else
    return query select a.id, false from public.analyses a where a.project_id = v_project_id;
  end if;
end;
$$;

revoke execute on function public.start_analysis(text, text, text) from public, anon;
grant execute on function public.start_analysis(text, text, text) to authenticated;
