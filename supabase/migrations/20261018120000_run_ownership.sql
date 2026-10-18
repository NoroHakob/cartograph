-- Run ownership: a run writes to its analysis only while it still holds it.
--
-- A run that goes quiet for STALE_AFTER_MS can be claimed by a new run. The
-- old run isn't stopped; it carries on, and before this its writes filtered
-- by analysis id alone. So when A went stale, B claimed the analysis, and A
-- then failed (or finished), A's write landed on B's row: B's progress
-- replaced by A's error, or B's stored graph replaced by A's.
--
-- Each claim now stamps a fresh run_id, and every later write requires it.
-- A run whose id is no longer on the row has been superseded and writes
-- nothing.

-- Null until the first claim made after this migration. Runs write it as the
-- service role; members can read analyses but have no update grant.
alter table public.analyses add column run_id uuid;

-- The signature gains p_run_id, so the old function is dropped rather than
-- overloaded: a caller still passing seven arguments should fail loudly, not
-- reach a version that skips the check.
drop function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb, jsonb);

create function public.store_parse(
  p_analysis_id    uuid,
  p_run_id         uuid,
  p_commit_sha     text,
  p_default_branch text,
  p_summary        jsonb,
  p_files          jsonb,
  p_imports        jsonb,
  p_routes         jsonb
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id     text;
  v_project_id uuid;
  v_owner      uuid;
  v_files      integer;
  v_imports    integer;
  v_routes     integer;
  v_edges      integer;
begin
  -- The row lock is held to commit, so no claim can slip in between this
  -- check and the writes below.
  select org_id, project_id, run_id into v_org_id, v_project_id, v_owner
  from public.analyses where id = p_analysis_id
  for update;
  if not found then
    raise exception 'analysis % does not exist', p_analysis_id;
  end if;
  if v_owner is distinct from p_run_id then
    -- CG001: Cartograph's own code, so the caller can tell "another run holds
    -- this analysis" from a real failure without matching on message text.
    raise exception 'analysis % is held by another run', p_analysis_id using errcode = 'CG001';
  end if;

  -- Cascades to edges, routes, and file-level explanations and roles.
  delete from public.files where analysis_id = p_analysis_id;
  delete from public.explanations where analysis_id = p_analysis_id;
  delete from public.insights where analysis_id = p_analysis_id;

  insert into public.files (org_id, analysis_id, path, folder, language, line_count, hash, module, fan_in, fan_out, role)
  select v_org_id, p_analysis_id, f.path, f.folder, f.language, f.line_count, f.hash, f.module, f.fan_in, f.fan_out, f.role
  from jsonb_to_recordset(p_files) as f (
    path text, folder text, language text, line_count integer, hash text, module text, fan_in integer, fan_out integer, role text
  );
  get diagnostics v_files = row_count;

  -- An import whose source isn't a stored file would vanish in the join, so
  -- the count is checked rather than trusted.
  insert into public.edges (org_id, analysis_id, source_file_id, target_file_id, specifier, kind, status, reason, detail, installed, type_only, line)
  select v_org_id, p_analysis_id, s.id, t.id, i.specifier, i.kind, i.status, i.reason, i.detail, i.installed, i.type_only, i.line
  from jsonb_to_recordset(p_imports) as i (
    source text, target text, specifier text, kind text, status text, reason text, detail text,
    installed boolean, type_only boolean, line integer
  )
  join public.files s on s.analysis_id = p_analysis_id and s.path = i.source
  left join public.files t on t.analysis_id = p_analysis_id and t.path = i.target;
  get diagnostics v_imports = row_count;
  if v_imports <> jsonb_array_length(p_imports) then
    raise exception 'stored % of % imports: some name a source file that was not stored', v_imports, jsonb_array_length(p_imports);
  end if;

  insert into public.routes (org_id, analysis_id, file_id, path, kind, methods, line)
  select v_org_id, p_analysis_id, f.id, r.path, r.kind, r.methods, r.line
  from jsonb_to_recordset(p_routes) as r (file text, path text, kind text, methods text[], line integer)
  join public.files f on f.analysis_id = p_analysis_id and f.path = r.file;
  get diagnostics v_routes = row_count;
  if v_routes <> jsonb_array_length(p_routes) then
    raise exception 'stored % of % routes: some name a file that was not stored', v_routes, jsonb_array_length(p_routes);
  end if;

  select count(*) into v_edges
  from (
    select distinct source_file_id, target_file_id
    from public.edges
    where analysis_id = p_analysis_id and status = 'internal'
  ) pairs;

  update public.projects set default_branch = p_default_branch where id = v_project_id;

  update public.analyses set
    status        = 'complete',
    stage         = 'store',
    stage_message = format('Stored %s files and %s edges', v_files, v_edges),
    commit_sha    = p_commit_sha,
    file_count    = v_files,
    edge_count    = v_edges,
    summary       = p_summary,
    error         = null,
    finished_at   = now()
  where id = p_analysis_id;
end;
$$;

-- A new function starts with execute granted to public; only runs call it.
revoke execute on function public.store_parse(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
