-- The pipeline: an analysis is now produced by a run (fetch, select, parse,
-- store) rather than seeded, and stores everything the parser produced.
--
-- Runs write with the secret key from server code, never as the signed-in
-- user: a run outlives the request that started it, and the session token
-- with it. Storing happens in one transaction (public.store_parse), so a run
-- either replaces an analysis's rows completely or leaves them as they were.

-- ---------------------------------------------------------------------------
-- One analysis per repository
-- ---------------------------------------------------------------------------

-- Rows that predate this rule were seeded. Keep one per project: a complete
-- one if there is one, otherwise the newest.
delete from public.analyses a
using (
  select id, row_number() over (
    partition by project_id
    order by (status = 'complete') desc, created_at desc, id
  ) as n
  from public.analyses
) ranked
where a.id = ranked.id and ranked.n > 1;

alter table public.analyses add constraint analyses_project_id_key unique (project_id);

-- ---------------------------------------------------------------------------
-- Stages
-- ---------------------------------------------------------------------------

-- status is the lifecycle (queued, parsing, ..., complete, failed); stage is
-- the step a run is on, or was on when it finished or failed.
create type public.analysis_stage as enum ('fetch', 'select', 'parse', 'store');

alter table public.analyses
  add column stage         public.analysis_stage,
  add column stage_message text,
  -- When the stage last moved. An unfinished run whose stage hasn't moved in
  -- a while has died without failing.
  add column stage_at      timestamptz,
  -- Everything in the parse result that isn't a row: adapter, modules,
  -- coverage, entry points, excluded files, config notes, stats, and what the
  -- select stage left out of the archive.
  add column summary       jsonb;

-- Seeded failures predate stages; nothing recorded which one they died in.
update public.analyses set stage = 'parse' where status = 'failed' and stage is null;
update public.analyses set stage_at = coalesce(started_at, created_at) where stage_at is null;

-- A failed run always says which stage it failed in (error already says why).
alter table public.analyses add constraint analyses_failed_has_stage
  check (status <> 'failed' or stage is not null);

-- ---------------------------------------------------------------------------
-- Files: the rest of the parser's FileNode
-- ---------------------------------------------------------------------------

alter table public.files
  add column hash    text,
  add column module  text,
  add column fan_in  integer not null default 0 check (fan_in >= 0),
  add column fan_out integer not null default 0 check (fan_out >= 0);

-- Seeded rows were never parsed, so they have no content to hash.
update public.files set hash = '', module = '.' where hash is null;

alter table public.files
  alter column hash set not null,
  alter column module set not null;

-- ---------------------------------------------------------------------------
-- Edges: one row per import, with what became of it
-- ---------------------------------------------------------------------------

-- status is the parser's resolution status. Only an internal import has a
-- target file. reason is the external kind, exclusion reason or unresolved
-- reason; detail is the package name, the excluded target path, or the
-- unresolved detail. The map's edges (one per source/target pair) are derived
-- from the internal rows.
alter table public.edges
  add column status    text check (status in ('internal', 'external', 'excluded', 'unresolved')),
  add column reason    text,
  add column detail    text,
  add column installed boolean,
  add column type_only boolean not null default false,
  add column line      integer check (line >= 1);

-- Seeded rows: a target means internal; the one without a target was seeded
-- as an alias that matches nothing.
update public.edges
set status = case when target_file_id is not null then 'internal' else 'unresolved' end,
    reason = case when target_file_id is not null then null else 'unknown-alias' end,
    type_only = (kind = 'type'),
    line = 1
where status is null;

alter table public.edges
  alter column status set not null,
  alter column line set not null,
  add constraint edges_internal_has_target check ((status = 'internal') = (target_file_id is not null)),
  add constraint edges_reason_unless_internal check ((status = 'internal') = (reason is null));

-- ---------------------------------------------------------------------------
-- Storing a parse
-- ---------------------------------------------------------------------------

-- Replaces everything an analysis holds with one parse result and marks the
-- run complete, in one transaction. Rows hang off files by path, so callers
-- pass paths and never invent ids. AI output about the previous parse goes
-- with it: it described code that may no longer exist.
create function public.store_parse(
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

  insert into public.files (org_id, analysis_id, path, folder, language, line_count, hash, module, fan_in, fan_out)
  select v_org_id, p_analysis_id, f.path, f.folder, f.language, f.line_count, f.hash, f.module, f.fan_in, f.fan_out
  from jsonb_to_recordset(p_files) as f (
    path text, folder text, language text, line_count integer, hash text, module text, fan_in integer, fan_out integer
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

  insert into public.routes (org_id, analysis_id, file_id, path, kind, methods)
  select v_org_id, p_analysis_id, f.id, r.path, r.kind, r.methods
  from jsonb_to_recordset(p_routes) as r (file text, path text, kind text, methods text[])
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

-- Only the pipeline stores parses. Functions are executable by everyone by
-- default, so that has to be taken away explicitly.
revoke execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse(uuid, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
