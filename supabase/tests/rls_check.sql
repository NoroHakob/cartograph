-- Phase 2 acceptance checks, as SQL. Read-only: everything runs inside a
-- transaction that is rolled back. Run in the SQL editor after seed.sql.

-- 1. Every table in public has row-level security on and at least one policy,
--    and signed-out (anon) requests can't select from any of them.
--    Expect every row: rls_enabled = true, policies >= 1, anon_can_select = false.
select c.relname as "table",
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 2. The same query, as each seeded organization's token, sees only that
--    organization's rows. Expect foreign_rows = 0 on every line.
begin;
set local role authenticated;

set local request.jwt.claims = '{"sub":"user_check","role":"authenticated","o":{"id":"org_3KlcDKciHUKQRTAaaO8suJIjkYg"}}';
create temp table as_first on commit drop as
select 'organizations' as "table", count(*) as visible, count(*) filter (where id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') as foreign_rows from public.organizations
union all select 'projects',     count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.projects
union all select 'analyses',     count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.analyses
union all select 'files',        count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.files
union all select 'edges',        count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.edges
union all select 'routes',       count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.routes
union all select 'explanations', count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.explanations
union all select 'file_roles',   count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.file_roles
union all select 'insights',     count(*), count(*) filter (where org_id <> 'org_3KlcDKciHUKQRTAaaO8suJIjkYg') from public.insights;

set local request.jwt.claims = '{"sub":"user_check","role":"authenticated","o":{"id":"org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ"}}';
create temp table as_second on commit drop as
select 'organizations' as "table", count(*) as visible, count(*) filter (where id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') as foreign_rows from public.organizations
union all select 'projects',     count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.projects
union all select 'analyses',     count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.analyses
union all select 'files',        count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.files
union all select 'edges',        count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.edges
union all select 'routes',       count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.routes
union all select 'explanations', count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.explanations
union all select 'file_roles',   count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.file_roles
union all select 'insights',     count(*), count(*) filter (where org_id <> 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ') from public.insights;

-- A token with no organization sees nothing at all.
set local request.jwt.claims = '{"sub":"user_check","role":"authenticated"}';
create temp table as_no_org on commit drop as
select count(*) as visible from public.analyses;

select 'my-organization' as "as", * from as_first
union all select 'second-team', * from as_second
union all select 'no org', 'analyses', visible, visible from as_no_org;

rollback;
