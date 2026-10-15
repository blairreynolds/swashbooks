-- Per-user tab access, enforced by the database.
-- Each profile has a list of tabs; admins see everything. New signups start
-- with no tabs until an admin grants them in Settings → Crew. Members who
-- existed before this migration keep access to every tab.
-- Run in the Supabase SQL editor after 001–005. Safe to run more than once.
--
-- Tab keys: dashboard, transactions, bills, invoices, donations, sponsors,
--           contacts, budget, planner, import   (Settings stays admin-only)

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'tabs') then
    alter table public.profiles add column tabs text[] not null default '{}';
    update public.profiles
      set tabs = array['dashboard', 'transactions', 'bills', 'invoices', 'donations', 'sponsors',
                       'contacts', 'budget', 'planner', 'import']
      where role <> 'admin';
  end if;
end $$;

-- True for admins, or when the signed-in user has any of the given tabs.
create or replace function public.has_tab(variadic p_tabs text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or tabs && p_tabs))
$$;

-- Only admins change roles or tab access, and the last admin can't be demoted.
-- Requests with no signed-in user (the SQL editor) are not restricted.
create or replace function public.guard_role_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.tabs is distinct from old.tabs)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only admins can change roles or tab access';
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from profiles where role = 'admin' and id <> old.id) then
    raise exception 'There must be at least one admin';
  end if;
  return new;
end
$$;

-- Records created through Bills, Invoices, Donations, Import or Sponsors stay
-- visible to the person who created them even without the owning tab.
alter table public.transactions alter column created_by set default auth.uid();
alter table public.in_kind_donations add column if not exists created_by uuid
  default auth.uid() references public.profiles (id) on delete set null;

-- Replace the table policies. Hard deletes stay admin-only throughout.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in (
             'contacts', 'transactions', 'bills', 'invoices', 'invoice_line_items', 'in_kind_donations',
             'outbound_donations', 'budgets', 'import_presets', 'planner_settings', 'planner_bars',
             'planner_drinks', 'planner_assignments', 'planner_inventory', 'sponsor_prospects', 'sponsor_activity')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Contacts: needed by every tab that records money or donors.
create policy "contacts read" on public.contacts for select to authenticated
  using (public.has_tab('dashboard', 'contacts', 'transactions', 'bills', 'invoices', 'donations', 'sponsors', 'import'));
create policy "contacts insert" on public.contacts for insert to authenticated
  with check (public.has_tab('contacts', 'transactions', 'bills', 'invoices', 'donations', 'sponsors', 'import'));
create policy "contacts update" on public.contacts for update to authenticated
  using (public.has_tab('contacts', 'transactions', 'bills', 'invoices', 'donations', 'sponsors', 'import'));
create policy "contacts delete" on public.contacts for delete to authenticated using (public.is_admin());

-- Transactions: the books. Paying a bill, marking an invoice paid, giving to
-- charity, importing, or recording sponsor cash all create one.
create policy "transactions read" on public.transactions for select to authenticated
  using (public.has_tab('dashboard', 'transactions', 'import') or created_by = auth.uid());
create policy "transactions insert" on public.transactions for insert to authenticated
  with check (created_by = auth.uid()
              and public.has_tab('transactions', 'import', 'bills', 'invoices', 'donations', 'sponsors'));
create policy "transactions update" on public.transactions for update to authenticated
  using (public.has_tab('transactions'));
create policy "transactions delete" on public.transactions for delete to authenticated using (public.is_admin());

create policy "bills read" on public.bills for select to authenticated using (public.has_tab('dashboard', 'bills'));
create policy "bills insert" on public.bills for insert to authenticated with check (public.has_tab('bills'));
create policy "bills update" on public.bills for update to authenticated using (public.has_tab('bills'));
create policy "bills delete" on public.bills for delete to authenticated using (public.is_admin());

create policy "invoices read" on public.invoices for select to authenticated using (public.has_tab('dashboard', 'invoices'));
create policy "invoices insert" on public.invoices for insert to authenticated with check (public.has_tab('invoices'));
create policy "invoices update" on public.invoices for update to authenticated using (public.has_tab('invoices'));
create policy "invoices delete" on public.invoices for delete to authenticated using (public.is_admin());

create policy "invoice_line_items read" on public.invoice_line_items for select to authenticated
  using (public.has_tab('dashboard', 'invoices'));
create policy "invoice_line_items write" on public.invoice_line_items for all to authenticated
  using (public.has_tab('invoices')) with check (public.has_tab('invoices'));

create policy "in_kind_donations read" on public.in_kind_donations for select to authenticated
  using (public.has_tab('donations') or created_by = auth.uid());
create policy "in_kind_donations insert" on public.in_kind_donations for insert to authenticated
  with check (public.has_tab('donations', 'sponsors', 'import'));
create policy "in_kind_donations update" on public.in_kind_donations for update to authenticated
  using (public.has_tab('donations'));
create policy "in_kind_donations delete" on public.in_kind_donations for delete to authenticated using (public.is_admin());

create policy "outbound_donations read" on public.outbound_donations for select to authenticated
  using (public.has_tab('dashboard', 'donations'));
create policy "outbound_donations insert" on public.outbound_donations for insert to authenticated
  with check (public.has_tab('donations'));
create policy "outbound_donations update" on public.outbound_donations for update to authenticated
  using (public.has_tab('donations'));
create policy "outbound_donations delete" on public.outbound_donations for delete to authenticated using (public.is_admin());

create policy "budgets read" on public.budgets for select to authenticated using (public.has_tab('dashboard', 'budget'));
create policy "budgets write" on public.budgets for all to authenticated
  using (public.has_tab('budget')) with check (public.has_tab('budget'));

create policy "import_presets all" on public.import_presets for all to authenticated
  using (public.has_tab('import')) with check (public.has_tab('import'));

do $$
declare t text;
begin
  foreach t in array array['planner_settings', 'planner_bars', 'planner_drinks', 'planner_assignments', 'planner_inventory'] loop
    execute format('create policy "%1$s all" on public.%1$I for all to authenticated using (public.has_tab(''planner'')) with check (public.has_tab(''planner''))', t);
  end loop;
end $$;

create policy "sponsor_prospects read" on public.sponsor_prospects for select to authenticated using (public.has_tab('sponsors'));
create policy "sponsor_prospects insert" on public.sponsor_prospects for insert to authenticated with check (public.has_tab('sponsors'));
create policy "sponsor_prospects update" on public.sponsor_prospects for update to authenticated using (public.has_tab('sponsors'));
create policy "sponsor_prospects delete" on public.sponsor_prospects for delete to authenticated using (public.is_admin());

create policy "sponsor_activity read" on public.sponsor_activity for select to authenticated using (public.has_tab('sponsors'));
create policy "sponsor_activity insert" on public.sponsor_activity for insert to authenticated
  with check (public.has_tab('sponsors') and kind = 'note' and created_by = auth.uid() and author_label is null);
create policy "sponsor_activity update" on public.sponsor_activity for update to authenticated
  using (public.has_tab('sponsors') and kind = 'note' and created_by = auth.uid())
  with check (kind = 'note' and created_by = auth.uid() and author_label is null);
create policy "sponsor_activity delete" on public.sponsor_activity for delete to authenticated
  using ((public.has_tab('sponsors') and kind = 'note' and created_by = auth.uid()) or public.is_admin());

-- Budget lines (categories): everyone can read them; adding and renaming
-- belongs to the Budget tab (004 let all crew do it).
drop policy if exists "categories crew insert" on public.categories;
create policy "categories crew insert" on public.categories for insert to authenticated
  with check (public.has_tab('budget') and not archived);
drop policy if exists "categories crew update" on public.categories;
create policy "categories crew update" on public.categories for update to authenticated
  using (public.has_tab('budget')) with check (public.has_tab('budget'));

-- Files: receipts and bill scans follow the books; the logo is readable by all
-- crew because letters and invoices print it.
drop policy if exists "files read" on storage.objects;
create policy "files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and (name like 'logo/%' or public.has_tab('transactions', 'bills')));
drop policy if exists "files upload" on storage.objects;
create policy "files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.has_tab('transactions', 'bills'));
