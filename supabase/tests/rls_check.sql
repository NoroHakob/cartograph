-- Phase 2 acceptance checks, as SQL. Read-only: everything runs inside a
-- transaction that is rolled back. Run in the SQL editor after seed.sql.

-- 1. Every table in public has row-level security on and at least one policy,
--    and signed-out (anon) requests can't select from any of them.
--    Expect every row: rls_enabled = true, policies >= 1, anon_can_select = false,
--    except analyses, projects, files, edges, routes and file_roles: since the
--    Ask credential migration anon may select those, and RLS shows it rows only
--    with a valid credential. Section 4 checks that.
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

-- 3. Progress channels (after the progress migration). A member can join their
--    own organization's analysis channel and not another's. Realtime decides
--    a join by selecting from realtime.messages with realtime.topic set to the
--    channel, as the subscriber; this does the same.
--    Expect: own_channel = true, other_channel = false, not_ours = false.
--    If own_channel is false too, the day's realtime.messages partition may not
--    exist yet: it's created once a client connects. Open any page and re-run.
begin;

create temp table channels on commit drop as
select
  (select public.analysis_topic(id) from public.analyses where org_id = 'org_3KlcDKciHUKQRTAaaO8suJIjkYg' limit 1) as own,
  (select public.analysis_topic(id) from public.analyses where org_id = 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ' limit 1) as other;
grant select on channels to authenticated;

select realtime.send('{}'::jsonb, 'check', own, true) from channels;
select realtime.send('{}'::jsonb, 'check', other, true) from channels;
select realtime.send('{}'::jsonb, 'check', 'room-1', true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"user_check","role":"authenticated","o":{"id":"org_3KlcDKciHUKQRTAaaO8suJIjkYg"}}';

select set_config('realtime.topic', own, true) from channels;
create temp table own_channel on commit drop as select exists (select 1 from realtime.messages) as visible;
select set_config('realtime.topic', other, true) from channels;
create temp table other_channel on commit drop as select exists (select 1 from realtime.messages) as visible;
select set_config('realtime.topic', 'room-1', true);
create temp table not_ours on commit drop as select exists (select 1 from realtime.messages) as visible;

select (select visible from own_channel) as own_channel,
       (select visible from other_channel) as other_channel,
       (select visible from not_ours) as not_ours;

rollback;

-- 4. Ask credentials (after the ask_credential migration). A member mints a
--    credential for their own organization's analysis and not another's; anon
--    with that credential sees that one analysis and nothing else; a tampered,
--    expired or missing credential sees nothing.
--    Expect: own_minted = true, other_refused = true, then for each "as" row
--    analyses = 1 and files = files_total for 'credential', and every count 0
--    for 'tampered', 'expired' and 'none'.
begin;

create temp table pick on commit drop as
select
  (select id from public.analyses where org_id = 'org_3KlcDKciHUKQRTAaaO8suJIjkYg' and status = 'complete' limit 1) as own,
  (select id from public.analyses where org_id = 'org_3Kmj3beZ8qWs6bNnIiGYXAPlQwJ' limit 1) as other;
create temp table minted (credential text, other_refused boolean) on commit drop;
grant select, insert, update on pick, minted to authenticated, anon;

set local role authenticated;
set local request.jwt.claims = '{"sub":"user_check","role":"authenticated","o":{"id":"org_3KlcDKciHUKQRTAaaO8suJIjkYg"}}';
insert into minted (credential) select public.mint_ask_credential(own) from pick;
do $$
begin
  perform public.mint_ask_credential((select other from pick));
  update minted set other_refused = false;
exception when others then
  update minted set other_refused = true;
end $$;

-- An expired credential, signed with the real key: built as the owner.
reset role;
create temp table expired on commit drop as
select p || '.' || private.ask_sign(p) as credential
from (select private.b64url(convert_to(jsonb_build_object('a', own, 'o', 'org_3KlcDKciHUKQRTAaaO8suJIjkYg', 'exp', 1)::text, 'UTF8')) as p from pick) x;
grant select on expired to anon;

set local role anon;
create temp table seen ("as" text, analyses bigint, files bigint, edges bigint, foreign_files bigint) on commit drop;

select set_config('request.headers', json_build_object('x-ask-credential', credential)::text, true) from minted;
insert into seen select 'credential', (select count(*) from public.analyses), (select count(*) from public.files), (select count(*) from public.edges),
  (select count(*) from public.files where analysis_id <> (select own from pick));

select set_config('request.headers', json_build_object('x-ask-credential', credential || 'x')::text, true) from minted;
insert into seen select 'tampered', (select count(*) from public.analyses), (select count(*) from public.files), (select count(*) from public.edges), 0;

select set_config('request.headers', json_build_object('x-ask-credential', credential)::text, true) from expired;
insert into seen select 'expired', (select count(*) from public.analyses), (select count(*) from public.files), (select count(*) from public.edges), 0;

select set_config('request.headers', '{}', true);
insert into seen select 'none', (select count(*) from public.analyses), (select count(*) from public.files), (select count(*) from public.edges), 0;

reset role;
select (select credential is not null from minted) as own_minted,
       (select other_refused from minted) as other_refused,
       s.*,
       (select count(*) from public.files where analysis_id = (select own from pick)) as files_total
from seen s;

rollback;
