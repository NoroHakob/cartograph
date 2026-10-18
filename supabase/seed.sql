-- Seed data for two organizations, until something creates real rows.
--
-- To see these on the dashboard, replace the two ids below with the Clerk ids
-- of two organizations you belong to (Clerk dashboard > Organizations, or the
-- "Organization" value on the workspace page). Everything else hangs off them.
--
-- Safe to re-run: deleting each organization cascades to all of its rows.
-- Run as the database owner (SQL editor, `supabase db reset`); API roles have
-- no insert policy.

begin;

create temp table seed_orgs (id text primary key, slug text not null, name text not null) on commit drop;
insert into seed_orgs (id, slug, name) values
  ('org_3KlcDKciHUKQRTAaaO8suJIjkYg', 'my-organization-1792135466961179746', 'My Organization'),  -- first organization
  ('org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ', 'second-team', 'Second team');  -- second organization

delete from public.organizations where id in (select id from seed_orgs);
insert into public.organizations (id, slug, name) select id, slug, name from seed_orgs;

-- Projects --------------------------------------------------------------------

insert into public.projects (org_id, repo_owner, repo_name, default_branch)
select o.id, p.owner, p.name, p.branch
from seed_orgs o
join (values
  ('my-organization-1792135466961179746', 'vercel',    'swr',        'main'),
  ('my-organization-1792135466961179746', 'pmndrs',    'zustand',    'main'),
  ('my-organization-1792135466961179746', 'sindresorhus', 'ky',      'main'),
  ('my-organization-1792135466961179746', 'tanstack',  'query',      'main'),
  ('second-team', 'colinhacks', 'zod',       'main'),
  ('second-team', 'trpc',       'trpc',      'main')
) as p (slug, owner, name, branch) on p.slug = o.slug;

-- Analyses: one per state, so the dashboard shows each, and one per project --

insert into public.analyses
  (org_id, project_id, status, stage, stage_message, stage_at, commit_sha, file_count, edge_count, error,
   started_at, finished_at, created_at)
select p.org_id, p.id, a.status::public.analysis_status, a.stage::public.analysis_stage, a.message,
       case when a.stage is not null then now() - a.age + coalesce(a.took, interval '0') end,
       a.sha, a.files, a.edges, a.error,
       case when a.status <> 'queued' then now() - a.age end,
       case when a.status in ('complete', 'failed') then now() - a.age + a.took end,
       now() - a.age
from public.projects p
join seed_orgs o on o.id = p.org_id
join (values
  ('vercel',     'swr',     'complete',   'store', 'Stored 74 files and 162 edges', '3f9c2a1', 74,  162,  null,  interval '2 days',   interval '41 seconds'),
  ('pmndrs',     'zustand', 'parsing',    'parse', 'Parsing 112 files',             '8be41d0', null, null, null,  interval '3 minutes', null),
  ('sindresorhus','ky',     'failed',     'parse', null,                            'c01d77e', null, null, 'Repository has no tsconfig.json or package.json at its root.', interval '5 hours', interval '6 seconds'),
  ('tanstack',   'query',   'queued',     null,    null,                            null,      null, null, null,  interval '20 seconds', null),
  ('colinhacks', 'zod',     'complete',   'store', 'Stored 211 files and 538 edges', 'a7d0e93', 211, 538,  null,  interval '1 day',    interval '1 minute 52 seconds'),
  ('trpc',       'trpc',    'explaining', 'store', 'Stored 486 files and 1204 edges', '5e6f1b4', 486, 1204, null, interval '9 minutes', null)
) as a (owner, name, status, stage, message, sha, files, edges, error, age, took)
  on a.owner = p.repo_owner and a.name = p.repo_name;

-- Parser and AI output for each organization's completed analysis -------------
-- A handful of rows per table, so every table has something to isolate.

create temp table seed_done on commit drop as
select a.id as analysis_id, a.org_id
from public.analyses a
join seed_orgs o on o.id = a.org_id
where a.status = 'complete';

-- Seeded files were never parsed, so they have no content to hash.
insert into public.files (org_id, analysis_id, path, folder, language, line_count, hash, module, fan_in, fan_out)
select d.org_id, d.analysis_id, f.path, f.folder, f.lang, f.lines, '', '.', f.fan_in, f.fan_out
from seed_done d
cross join (values
  ('src/index.ts',        'src',       'ts', 48,  0, 1),
  ('src/core/client.ts',  'src/core',  'ts', 212, 1, 1),
  ('src/core/types.ts',   'src/core',  'ts', 96,  1, 0),
  ('src/app/api/route.ts','src/app/api','ts', 31, 0, 0)
) as f (path, folder, lang, lines, fan_in, fan_out);

insert into public.edges
  (org_id, analysis_id, source_file_id, target_file_id, specifier, kind, status, reason, type_only, line)
select d.org_id, d.analysis_id, src.id, tgt.id, e.specifier, e.kind, e.status, e.reason, e.type_only, e.line
from seed_done d
cross join (values
  ('src/index.ts',        'src/core/client.ts', './core/client',      'reexport', 'internal',   null,            false, 1),
  ('src/core/client.ts',  'src/core/types.ts',  './types',            'static',   'internal',   null,            true,  3),
  ('src/app/api/route.ts', null,                '@/lib/missing-alias', 'static',  'unresolved', 'unknown-alias', false, 2)
) as e (source, target, specifier, kind, status, reason, type_only, line)
join public.files src on src.analysis_id = d.analysis_id and src.path = e.source
left join public.files tgt on tgt.analysis_id = d.analysis_id and tgt.path = e.target;

insert into public.routes (org_id, analysis_id, file_id, path, kind, methods)
select f.org_id, f.analysis_id, f.id, '/api', 'route_handler', '{GET,POST}'
from public.files f
join seed_done d on d.analysis_id = f.analysis_id
where f.path = 'src/app/api/route.ts';

insert into public.explanations (org_id, analysis_id, file_id, body, model)
select f.org_id, f.analysis_id, f.id,
       'Entry point. Re-exports the client from src/core/client.ts.', 'seed'
from public.files f
join seed_done d on d.analysis_id = f.analysis_id
where f.path = 'src/index.ts';

insert into public.file_roles (org_id, analysis_id, file_id, role, rationale, model)
select f.org_id, f.analysis_id, f.id, 'service', 'Re-exports the core client for the rest of the package.', 'seed'
from public.files f
join seed_done d on d.analysis_id = f.analysis_id
where f.path = 'src/index.ts';

insert into public.insights (org_id, analysis_id, kind, title, body, file_ids, model)
select d.org_id, d.analysis_id, 'unresolved_import', 'One import could not be resolved',
       'src/app/api/route.ts imports "@/lib/missing-alias", which matches no file in the repository.',
       array(select f.id from public.files f where f.analysis_id = d.analysis_id and f.path = 'src/app/api/route.ts'),
       'seed'
from seed_done d;

commit;
