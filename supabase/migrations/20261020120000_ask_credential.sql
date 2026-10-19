-- Ask: a short-lived credential naming exactly one analysis.
--
-- The agent reads an analysis through the app's tool surface, which has no
-- signed-in user of its own. It reads as anon, with the publishable key and a
-- credential in the x-ask-credential header, and the policies below let that
-- credential see exactly one analysis of exactly one organization. Without a
-- valid credential anon sees nothing, as before.
--
-- Nothing outside the database can mint one. The signing key is generated
-- here, kept in Vault, and never leaves: the app holds no key, the agent holds
-- no key, and neither holds anything that can read every analysis. A signed-in
-- member asks the database to mint a credential for an analysis of their own
-- organization, and gets nothing for any other.
--
-- A credential is <payload>.<signature>, both base64url: the payload is
-- {"a": analysis id, "o": organization id, "exp": unix seconds}, the
-- signature HMAC-SHA256 of the encoded payload. It lasts ten minutes; the app
-- mints a fresh one for every question.

-- ---------------------------------------------------------------------------
-- The key
-- ---------------------------------------------------------------------------

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'ask_credential_key',
  'Signs Ask credentials (see mint_ask_credential). Never leaves the database.'
)
where not exists (select 1 from vault.secrets where name = 'ask_credential_key');

-- Not exposed through the API: PostgREST serves public only.
create schema private;
revoke all on schema private from public;

create function private.ask_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ask_credential_key';
$$;

create function private.b64url(p_bytes bytea)
returns text
language sql
immutable
set search_path = ''
as $$
  select rtrim(translate(translate(encode(p_bytes, 'base64'), E'\n', ''), '+/', '-_'), '=');
$$;

create function private.unb64url(p_text text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select decode(translate(p_text, '-_', '+/') || repeat('=', (4 - length(p_text) % 4) % 4), 'base64');
$$;

create function private.ask_sign(p_payload text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.b64url(extensions.hmac(p_payload, private.ask_key(), 'sha256'));
$$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Minting
-- ---------------------------------------------------------------------------

-- security definer, to reach the key. It doesn't lean on RLS for the
-- ownership check, so it repeats the analyses policy explicitly: the
-- organization comes from the caller's Clerk token, and an analysis of any
-- other organization is reported the same as one that doesn't exist.
create function public.mint_ask_credential(p_analysis_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org_id  text := (select auth.jwt() -> 'o' ->> 'id');
  v_payload text;
begin
  if v_org_id is null then
    raise exception 'No active organization.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.analyses a
    where a.id = p_analysis_id and a.org_id = v_org_id and a.status = 'complete'
  ) then
    raise exception 'No such analysis.' using errcode = 'P0002';
  end if;

  v_payload := private.b64url(convert_to(jsonb_build_object(
    'a', p_analysis_id,
    'o', v_org_id,
    'exp', floor(extract(epoch from now()))::bigint + 600
  )::text, 'UTF8'));
  return v_payload || '.' || private.ask_sign(v_payload);
end;
$$;

revoke execute on function public.mint_ask_credential(uuid) from public, anon;
grant execute on function public.mint_ask_credential(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

-- The verified scope of the request's credential, {"a": ..., "o": ...}, or
-- null for a missing, malformed, forged or expired one.
create function private.ask_scope()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_token  text;
  v_claims jsonb;
begin
  v_token := nullif(current_setting('request.headers', true), '')::json ->> 'x-ask-credential';
  if v_token is null or v_token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    return null;
  end if;
  if split_part(v_token, '.', 2) <> private.ask_sign(split_part(v_token, '.', 1)) then
    return null;
  end if;
  v_claims := convert_from(private.unb64url(split_part(v_token, '.', 1)), 'UTF8')::jsonb;
  if (v_claims ->> 'exp')::bigint <= extract(epoch from now()) then
    return null;
  end if;
  return jsonb_build_object('a', v_claims ->> 'a', 'o', v_claims ->> 'o');
exception when others then
  return null;
end;
$$;

revoke execute on function private.ask_scope() from public, authenticated;
grant usage on schema private to anon;
grant execute on function private.ask_scope() to anon;

-- Read-only, and only the tables an analysis is drawn from. RLS decides rows.
grant select on public.analyses, public.projects, public.files, public.edges, public.routes, public.file_roles to anon;

create policy "An Ask credential reads its analysis"
  on public.analyses for select to anon
  using (
    id = ((select private.ask_scope()) ->> 'a')::uuid
    and org_id = (select private.ask_scope()) ->> 'o'
  );

create policy "An Ask credential reads its analysis's project"
  on public.projects for select to anon
  using (
    org_id = (select private.ask_scope()) ->> 'o'
    and id = (select a.project_id from public.analyses a where a.id = ((select private.ask_scope()) ->> 'a')::uuid)
  );

create policy "An Ask credential reads its analysis's files"
  on public.files for select to anon
  using (
    analysis_id = ((select private.ask_scope()) ->> 'a')::uuid
    and org_id = (select private.ask_scope()) ->> 'o'
  );

create policy "An Ask credential reads its analysis's edges"
  on public.edges for select to anon
  using (
    analysis_id = ((select private.ask_scope()) ->> 'a')::uuid
    and org_id = (select private.ask_scope()) ->> 'o'
  );

create policy "An Ask credential reads its analysis's routes"
  on public.routes for select to anon
  using (
    analysis_id = ((select private.ask_scope()) ->> 'a')::uuid
    and org_id = (select private.ask_scope()) ->> 'o'
  );

create policy "An Ask credential reads its analysis's file roles"
  on public.file_roles for select to anon
  using (
    analysis_id = ((select private.ask_scope()) ->> 'a')::uuid
    and org_id = (select private.ask_scope()) ->> 'o'
  );
