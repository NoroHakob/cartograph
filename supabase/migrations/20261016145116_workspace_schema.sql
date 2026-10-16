-- Workspace schema: who owns what, and who can read it.
--
-- Every row belongs to one Clerk organization. Ownership is a foreign key to
-- public.organizations with ON DELETE CASCADE, so deleting an organization
-- removes everything it owns. Tables that hang off another table (files off an
-- analysis, edges off files, ...) reference their parent by (id, org_id), so a
-- child row can never claim a different organization than its parent.
--
-- Authorization lives here, not in application code. RLS is enabled on every
-- table, and the read policies compare org_id with the organization claim on
-- the Clerk session token (auth.jwt()->'o'->>'id'). Nothing has an insert,
-- update or delete policy yet, so those are denied for API roles; they arrive
-- with the phase that first needs them.

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

-- Mirrors Clerk organizations. The id is Clerk's ("org_..."), so it matches the
-- token claim directly.
create table public.organizations (
  id         text primary key,
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Projects: a repository a team has added
-- ---------------------------------------------------------------------------

create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null references public.organizations (id) on delete cascade,
  repo_owner     text not null,
  repo_name      text not null,
  default_branch text,
  created_at     timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, repo_owner, repo_name)
);

-- ---------------------------------------------------------------------------
-- Analyses: one parse of a project at one commit
-- ---------------------------------------------------------------------------

create type public.analysis_status as enum ('queued', 'parsing', 'explaining', 'complete', 'failed');

create table public.analyses (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  project_id  uuid not null,
  status      public.analysis_status not null default 'queued',
  commit_sha  text,
  file_count  integer check (file_count >= 0),
  edge_count  integer check (edge_count >= 0),
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (id, org_id),
  foreign key (project_id, org_id) references public.projects (id, org_id) on delete cascade,
  -- Only a failed analysis carries an error message.
  check ((status = 'failed') = (error is not null))
);

-- ---------------------------------------------------------------------------
-- Parser output: files, the imports between them, and the routes they define
-- ---------------------------------------------------------------------------

create table public.files (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path        text not null,
  folder      text not null,
  language    text not null check (language in ('ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts')),
  line_count  integer not null check (line_count >= 0),
  unique (id, org_id),
  unique (analysis_id, path),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade
);

-- An import. When the parser can't resolve the specifier, target_file_id is
-- null and resolved is false: the map shows it as unresolved, never guessed.
create table public.edges (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null references public.organizations (id) on delete cascade,
  analysis_id    uuid not null,
  source_file_id uuid not null,
  target_file_id uuid,
  specifier      text not null,
  kind           text not null check (kind in ('static', 'dynamic', 'type', 'reexport', 'require')),
  resolved       boolean not null generated always as (target_file_id is not null) stored,
  unique (id, org_id),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (source_file_id, org_id) references public.files (id, org_id) on delete cascade,
  foreign key (target_file_id, org_id) references public.files (id, org_id) on delete cascade
);

create table public.routes (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id     uuid not null,
  path        text not null,
  kind        text not null check (kind in ('page', 'layout', 'route_handler', 'middleware', 'api')),
  methods     text[] not null default '{}',
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- AI output: always attached to something the parser produced
-- ---------------------------------------------------------------------------

-- Explains exactly one parser artifact: a file, an edge, or a folder of files.
create table public.explanations (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id     uuid,
  edge_id     uuid,
  folder      text,
  body        text not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade,
  foreign key (edge_id, org_id) references public.edges (id, org_id) on delete cascade,
  check (num_nonnulls(file_id, edge_id, folder) = 1)
);

create table public.file_roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id     uuid not null,
  role        text not null,
  rationale   text,
  model       text not null,
  created_at  timestamptz not null default now(),
  unique (file_id, role),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade
);

-- An observation about the graph as a whole (a cycle, a hub file, ...).
-- file_ids lists the parser files it refers to.
create table public.insights (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  kind        text not null,
  title       text not null,
  body        text not null,
  file_ids    uuid[] not null default '{}',
  model       text not null,
  created_at  timestamptz not null default now(),
  foreign key (analysis_id, org_id) references public.analyses (id, org_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes: every foreign key, plus org_id for the RLS predicate
-- ---------------------------------------------------------------------------

create index projects_org_id_idx on public.projects (org_id);

create index analyses_org_id_created_at_idx on public.analyses (org_id, created_at desc);
create index analyses_project_id_org_id_idx on public.analyses (project_id, org_id);

create index files_org_id_idx on public.files (org_id);
create index files_analysis_id_org_id_idx on public.files (analysis_id, org_id);

create index edges_org_id_idx on public.edges (org_id);
create index edges_analysis_id_org_id_idx on public.edges (analysis_id, org_id);
create index edges_source_file_id_org_id_idx on public.edges (source_file_id, org_id);
create index edges_target_file_id_org_id_idx on public.edges (target_file_id, org_id);

create index routes_org_id_idx on public.routes (org_id);
create index routes_analysis_id_org_id_idx on public.routes (analysis_id, org_id);
create index routes_file_id_org_id_idx on public.routes (file_id, org_id);

create index explanations_org_id_idx on public.explanations (org_id);
create index explanations_analysis_id_org_id_idx on public.explanations (analysis_id, org_id);
create index explanations_file_id_org_id_idx on public.explanations (file_id, org_id);
create index explanations_edge_id_org_id_idx on public.explanations (edge_id, org_id);

create index file_roles_org_id_idx on public.file_roles (org_id);
create index file_roles_analysis_id_org_id_idx on public.file_roles (analysis_id, org_id);
create index file_roles_file_id_org_id_idx on public.file_roles (file_id, org_id);

create index insights_org_id_idx on public.insights (org_id);
create index insights_analysis_id_org_id_idx on public.insights (analysis_id, org_id);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Signed-out requests have no business reading any of this.
revoke all on
  public.organizations, public.projects, public.analyses, public.files, public.edges,
  public.routes, public.explanations, public.file_roles, public.insights
from anon;

alter table public.organizations enable row level security;
alter table public.projects      enable row level security;
alter table public.analyses      enable row level security;
alter table public.files         enable row level security;
alter table public.edges         enable row level security;
alter table public.routes        enable row level security;
alter table public.explanations  enable row level security;
alter table public.file_roles    enable row level security;
alter table public.insights      enable row level security;

-- The predicate: the row's organization is the active organization on the
-- caller's Clerk session token. Wrapped in a subselect so it is evaluated once
-- per query rather than once per row.

create policy "Members read their organization"
  on public.organizations for select to authenticated
  using (id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's projects"
  on public.projects for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's analyses"
  on public.analyses for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's files"
  on public.files for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's edges"
  on public.edges for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's routes"
  on public.routes for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's explanations"
  on public.explanations for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's file roles"
  on public.file_roles for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));

create policy "Members read their organization's insights"
  on public.insights for select to authenticated
  using (org_id = (select auth.jwt() -> 'o' ->> 'id'));
