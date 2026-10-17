-- Framework adapters: every file has a role the parser's adapter assigned
-- (from its path, file name or directives), and every route records the line
-- that declares it. Both are parser output, stored as the parser produced
-- them, like the rest of the file and route rows.

-- Null on rows stored before adapters assigned roles; the explorer asks for a
-- re-run rather than guessing one. Not file_roles: that table is for AI output
-- and says which model wrote it.
alter table public.files add column role text;

-- Null when a file's path alone declares the route (a Next.js page).
alter table public.routes add column line integer check (line >= 1);

-- Same signature and grants as before; only what is inserted changes.
create or replace function public.store_parse(
  p_analysis_id    uuid,
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
  v_files      integer;
  v_imports    integer;
  v_routes     integer;
  v_edges      integer;
begin
  select org_id, project_id into v_org_id, v_project_id
  from public.analyses where id = p_analysis_id
  for update;
  if not found then
    raise exception 'analysis % does not exist', p_analysis_id;
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
    stage_at      = now(),
    commit_sha    = p_commit_sha,
    file_count    = v_files,
    edge_count    = v_edges,
    summary       = p_summary,
    error         = null,
    finished_at   = now()
  where id = p_analysis_id;
end;
$$;

-- create or replace keeps the existing grants; restated so this file says
-- what it relies on.
revoke execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
