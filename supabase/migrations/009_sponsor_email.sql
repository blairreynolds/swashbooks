-- Sponsor email: a library of pitch files (one-sheet, decks), emails sent from
-- the Sponsors page through a connected Gmail account, and replies picked up
-- from those same Gmail threads. The sponsor-mail Edge Function does the Gmail
-- work with the service role; crew only ever read these tables.
-- Safe to run more than once.

-- Pitch files: uploaded once, attached to emails by ticking them.
create table if not exists public.sponsor_files (
  id uuid primary key default gen_random_uuid(),
  label text not null check (btrim(label) <> ''),
  filename text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null default 0,
  attach_by_default boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.sponsor_files enable row level security;
drop policy if exists "sponsor_files read" on public.sponsor_files;
drop policy if exists "sponsor_files insert" on public.sponsor_files;
drop policy if exists "sponsor_files update" on public.sponsor_files;
drop policy if exists "sponsor_files delete" on public.sponsor_files;
create policy "sponsor_files read" on public.sponsor_files for select to authenticated using (public.has_tab('sponsors'));
create policy "sponsor_files insert" on public.sponsor_files for insert to authenticated with check (public.has_tab('sponsors'));
create policy "sponsor_files update" on public.sponsor_files for update to authenticated using (public.has_tab('sponsors'));
create policy "sponsor_files delete" on public.sponsor_files for delete to authenticated using (public.is_admin());

-- Their own private bucket, so receipts and bills stay out of reach of
-- Sponsors-only crew and vice versa.
insert into storage.buckets (id, name, public) values ('sponsor-files', 'sponsor-files', false)
on conflict (id) do nothing;
drop policy if exists "sponsor files read" on storage.objects;
drop policy if exists "sponsor files upload" on storage.objects;
drop policy if exists "sponsor files delete" on storage.objects;
create policy "sponsor files read" on storage.objects for select to authenticated
  using (bucket_id = 'sponsor-files' and public.has_tab('sponsors'));
create policy "sponsor files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsor-files' and public.has_tab('sponsors'));
create policy "sponsor files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsor-files' and public.is_admin());

-- Every email in a thread the Sponsors page started: what we sent (from the
-- page or straight from Gmail) and what came back. Written only by the
-- sponsor-mail function.
create table if not exists public.sponsor_emails (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sponsor_prospects (id) on delete cascade,
  direction text not null check (direction in ('out', 'in')),
  gmail_message_id text not null unique,
  gmail_thread_id text not null,
  from_addr text,
  to_addr text,
  subject text,
  body_text text,
  attachments jsonb not null default '[]',
  bounced boolean not null default false,
  sent_by uuid references public.profiles (id) on delete set null,
  sent_at timestamptz not null default now(),
  -- Replies only: cleared by "Mark handled", or by answering it.
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  owner_notified_at timestamptz
);
create index if not exists sponsor_emails_prospect_sent on public.sponsor_emails (prospect_id, sent_at desc);
create index if not exists sponsor_emails_thread on public.sponsor_emails (gmail_thread_id);
create index if not exists sponsor_emails_open_replies on public.sponsor_emails (prospect_id)
  where direction = 'in' and handled_at is null;

alter table public.sponsor_emails enable row level security;
drop policy if exists "sponsor_emails read" on public.sponsor_emails;
create policy "sponsor_emails read" on public.sponsor_emails for select to authenticated using (public.has_tab('sponsors'));

-- Mark a reply handled (or not) without opening up the rest of the row.
create or replace function public.sponsor_email_handled(p_id uuid, p_handled boolean default true)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_tab('sponsors') then
    raise exception 'You need Sponsors access to do that.';
  end if;
  update sponsor_emails
     set handled_at = case when p_handled then coalesce(handled_at, now()) end,
         handled_by = case when p_handled then coalesce(handled_by, auth.uid()) end
   where id = p_id and direction = 'in';
end
$$;
revoke execute on function public.sponsor_email_handled(uuid, boolean) from public, anon;
grant execute on function public.sponsor_email_handled(uuid, boolean) to authenticated;

-- Which Gmail account the page sends from. One row; crew can see the address,
-- never the credential (that lives in Vault, below).
create table if not exists public.mail_connection (
  id int primary key default 1 check (id = 1),
  email text,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  last_check_at timestamptz,
  last_check_error text
);
alter table public.mail_connection enable row level security;
drop policy if exists "mail_connection read" on public.mail_connection;
create policy "mail_connection read" on public.mail_connection for select to authenticated using (public.has_tab('sponsors'));

-- One-time codes for the Google sign-in round trip. Function-only: no policies.
create table if not exists public.mail_oauth_states (
  nonce text primary key,
  user_id uuid not null,
  return_to text not null,
  created_at timestamptz not null default now()
);
alter table public.mail_oauth_states enable row level security;

-- The Gmail refresh token and the reply-check job's secret live in Supabase
-- Vault. Only the sponsor-mail function (service role) can read or store them.
create or replace function public.mail_store_refresh_token(p_token text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'gmail_refresh_token';
  if existing is null then
    perform vault.create_secret(p_token, 'gmail_refresh_token', 'Gmail refresh token for SwashBooks sponsor email');
  else
    perform vault.update_secret(existing, p_token);
  end if;
end
$$;

create or replace function public.mail_refresh_token()
returns text
language plpgsql stable security definer set search_path = public
as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'gmail_refresh_token');
end
$$;

create or replace function public.mail_cron_secret()
returns text
language plpgsql stable security definer set search_path = public
as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'sponsor_mail_cron_secret');
end
$$;

revoke execute on function public.mail_store_refresh_token(text) from public, anon, authenticated;
revoke execute on function public.mail_refresh_token() from public, anon, authenticated;
revoke execute on function public.mail_cron_secret() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.mail_store_refresh_token(text) to service_role;
    grant execute on function public.mail_refresh_token() to service_role;
    grant execute on function public.mail_cron_secret() to service_role;
  end if;
end $$;
