-- Explain: the first model output, and the cache in front of it.
--
-- Explanations are cached on the content of what was explained, not on the
-- analysis: store_parse replaces an analysis's rows on every run, but a file
-- whose bytes and neighbours haven't changed still has the same explanation.
-- The key is a hash the server computes from the model name, the prompt
-- version and every input the prompt is built from, so re-pinning a model or
-- changing a prompt invalidates only its own entries.
--
-- Writes come from server actions as the signed-in user, so these are the
-- first insert policies: members write their own organization's rows and
-- nothing else.

-- ---------------------------------------------------------------------------
-- The cache
-- ---------------------------------------------------------------------------

create table public.explanation_cache (
  org_id     text not null references public.organizations (id) on delete cascade,
  -- sha256 hex of the model, prompt version and the subject's content.
  key        text not null check (key ~ '^[0-9a-f]{64}$'),
  kind       text not null check (kind in ('file', 'folder')),
  model      text not null,
  body       text not null,
  -- Set only when the explanation also classified a file no adapter
  -- identified. Never a structural role: see file_roles below.
  role       text check (role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')),
  rationale  text,
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);

revoke all on public.explanation_cache from anon;
alter table public.explanation_cache enable row level security;

create policy "Members read their organization's cached explanations"
  on public.explanation_cache for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

-- Insert only: an entry is never rewritten, because its key already says
-- everything it was made from. A second writer racing the first does nothing.
create policy "Members cache explanations for their organization"
  on public.explanation_cache for insert to authenticated
  with check (org_id = (select auth.jwt() -> 'o' ->> 'id'));

-- ---------------------------------------------------------------------------
-- File roles: labels for files no adapter identified
-- ---------------------------------------------------------------------------

-- Page, route, controller and the other structural roles decide the route
-- table and the entry-point colouring, and convention owns them. A model may
-- only answer with a role that changes neither. Seeded rows predate this.
delete from public.file_roles
where role not in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook');

alter table public.file_roles
  add constraint file_roles_role_not_structural
  check (role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook'));

-- One answer per file per model, replacing one per file per role: a model
-- asked again may answer differently, and the newer answer wins.
alter table public.file_roles drop constraint file_roles_file_id_role_key;
delete from public.file_roles a
using public.file_roles b
where a.file_id = b.file_id and a.model = b.model and (a.created_at, a.id) < (b.created_at, b.id);
alter table public.file_roles add constraint file_roles_file_id_model_key unique (file_id, model);

create policy "Members label their organization's files"
  on public.file_roles for insert to authenticated
  with check (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members relabel their organization's files"
  on public.file_roles for update to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'))
  with check (org_id = (select auth.jwt() -> 'o' ->> 'id'));

-- Only the columns a server action sets. created_at stays the database's.
-- An upsert updates every column it inserts, so file_roles' update grant
-- matches its insert grant; the policy still pins org_id, and the composite
-- foreign keys keep the file and analysis in that organization.
revoke insert, update, delete on public.explanation_cache, public.file_roles from authenticated;
grant insert (org_id, key, kind, model, body, role, rationale) on public.explanation_cache to authenticated;
grant insert (org_id, analysis_id, file_id, role, rationale, model) on public.file_roles to authenticated;
grant update (org_id, analysis_id, file_id, role, rationale, model) on public.file_roles to authenticated;
