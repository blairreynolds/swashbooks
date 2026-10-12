-- Let all crew add and rename budget lines (categories) from the Budget tab.
-- Hiding (archiving) a line, changing its type, and deleting stay admin-only.
-- Safe to run more than once. Run in the Supabase SQL editor.

drop policy if exists "categories crew insert" on public.categories;
create policy "categories crew insert" on public.categories
  for insert to authenticated with check (not archived);

drop policy if exists "categories crew update" on public.categories;
create policy "categories crew update" on public.categories
  for update to authenticated using (true) with check (true);

-- Row-level security can't restrict individual columns, so a trigger guards
-- the two fields only admins may change. Requests with no signed-in user
-- (the SQL editor) are not restricted.
create or replace function public.guard_category_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.archived is distinct from old.archived or new.type is distinct from old.type)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can hide a category or change its type';
  end if;
  return new;
end
$$;

drop trigger if exists categories_admin_guard on public.categories;
create trigger categories_admin_guard
  before update on public.categories
  for each row execute function public.guard_category_change();
