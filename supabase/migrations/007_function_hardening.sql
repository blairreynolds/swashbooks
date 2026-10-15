-- Security hardening from Supabase's database advisor. Safe to run more than once.

-- Pin the schema these functions resolve names in.
alter function public.sponsor_prospects_touch() set search_path = public;
alter function public.sponsor_status_label(text) set search_path = public;

-- Trigger functions run as triggers only; nobody should call them through the API.
-- (Triggers still fire without EXECUTE privilege.)
revoke execute on function public.guard_category_change() from public, anon, authenticated;
revoke execute on function public.guard_role_change() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_sponsor_status() from public, anon, authenticated;
revoke execute on function public.sponsor_prospects_touch() from public, anon, authenticated;

-- The access checks: every access rule calls them for signed-in crew, so
-- authenticated must keep EXECUTE. Visitors who aren't signed in never need them.
revoke execute on function public.has_tab(variadic text[]) from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.has_tab(variadic text[]) to authenticated;
grant execute on function public.is_admin() to authenticated;
