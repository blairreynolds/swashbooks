-- SwashBooks initial schema — run in the Supabase SQL editor (or `supabase db push`).
-- Covers the full data model (Phases 1–3); the app grows into it.

-- ── Profiles & roles ────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- First account ever created becomes admin; everyone after starts as member.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles.
create or replace function public.guard_role_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end
$$;

create trigger profiles_role_guard
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- ── Core tables ─────────────────────────────────────────────────────

create table public.event_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  event_date date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('expense', 'income')),
  sort_order int not null default 0,
  archived boolean not null default false,
  unique (name, type)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'vendor' check (type in ('vendor', 'donor', 'charity', 'other')),
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  unique (event_year_id, category_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  date date not null,
  category_id uuid not null references public.categories (id) on delete restrict,
  contact_id uuid references public.contacts (id) on delete set null,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  direction text not null check (direction in ('expense', 'income')),
  payment_method text check (payment_method in ('check', 'card', 'cash', 'transfer', 'other')),
  reference_no text,
  receipt_file_url text,
  voided boolean not null default false,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.transactions (event_year_id, date);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  date_received date not null,
  due_date date,
  amount numeric(12,2) not null check (amount > 0),
  category_id uuid not null references public.categories (id) on delete restrict,
  description text,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  bill_file_url text,
  paid_transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.bills (event_year_id, status);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  invoice_number text not null unique,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  issue_date date not null,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  notes text,
  paid_transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  qty numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0
);

create table public.in_kind_donations (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  date_received date not null,
  item_description text not null,
  estimated_value numeric(12,2),
  category_id uuid references public.categories (id) on delete set null,
  notes text,
  acknowledgment_generated boolean not null default false,
  acknowledgment_date date,
  created_at timestamptz not null default now()
);

create table public.outbound_donations (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  date date not null,
  amount numeric(12,2) not null check (amount > 0),
  transaction_id uuid references public.transactions (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  org_name text not null default 'The Swashbuckler''s Ball',
  org_address text,
  logo_url text,
  invoice_payment_instructions text,
  entity_status text not null default 'unconfirmed'
    check (entity_status in ('501c3', 'nonprofit_non_exempt', 'unconfirmed')),
  ein text,
  ack_signature_block text,
  created_at timestamptz not null default now()
);

-- ── Row Level Security ──────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.event_years enable row level security;
alter table public.categories enable row level security;
alter table public.contacts enable row level security;
alter table public.budgets enable row level security;
alter table public.transactions enable row level security;
alter table public.bills enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.in_kind_donations enable row level security;
alter table public.outbound_donations enable row level security;
alter table public.settings enable row level security;

-- Profiles: everyone signed in can see the crew list; users edit their own
-- row (role changes blocked by trigger); admins edit anyone.
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles self update" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin());

-- Admin-managed reference tables: readable by all crew, writable by admins.
create policy "event_years read" on public.event_years for select to authenticated using (true);
create policy "event_years write" on public.event_years for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "categories read" on public.categories for select to authenticated using (true);
create policy "categories write" on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "settings read" on public.settings for select to authenticated using (true);
create policy "settings write" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Financial records: full create/edit for all crew; hard delete admin-only.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'transactions', 'bills', 'invoices', 'in_kind_donations', 'outbound_donations'] loop
    execute format('create policy "%1$s read" on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy "%1$s insert" on public.%1$I for insert to authenticated with check (true)', t);
    execute format('create policy "%1$s update" on public.%1$I for update to authenticated using (true)', t);
    execute format('create policy "%1$s delete" on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- Budgets and invoice line items are working detail rows — crew can also delete.
do $$
declare t text;
begin
  foreach t in array array['budgets', 'invoice_line_items'] loop
    execute format('create policy "%1$s all" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ── Storage (receipts, bill files, logo) ────────────────────────────

insert into storage.buckets (id, name, public) values ('files', 'files', false)
on conflict (id) do nothing;

create policy "files read" on storage.objects for select to authenticated
  using (bucket_id = 'files');
create policy "files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'files');
create policy "files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.is_admin());

-- ── Seed data ───────────────────────────────────────────────────────

insert into public.categories (name, type, sort_order) values
  ('Venue', 'expense', 1),
  ('Catering', 'expense', 2),
  ('Bar/Beverage', 'expense', 3),
  ('Entertainment/Music', 'expense', 4),
  ('Decor & Props', 'expense', 5),
  ('Printing & Signage', 'expense', 6),
  ('Insurance', 'expense', 7),
  ('Permits & Licenses', 'expense', 8),
  ('Supplies', 'expense', 9),
  ('Fees & Services', 'expense', 10),
  ('Charitable Giving', 'expense', 11),
  ('Misc', 'expense', 12),
  ('Ticket Sales', 'income', 1),
  ('Sponsorships', 'income', 2),
  ('Merchandise', 'income', 3),
  ('Cash Donations', 'income', 4),
  ('Misc Income', 'income', 5);

insert into public.settings (org_name) values ('The Swashbuckler''s Ball');
