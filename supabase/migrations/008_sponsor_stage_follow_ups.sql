-- Sponsor pipeline: set the follow-up date automatically when a prospect
-- changes stage, unless the same edit also sets the follow-up date itself.
--   Contacted -> 7 days out
--   In talks  -> 5 days out
--   Committed -> 3 weeks before the Ball (at least a week out), to confirm delivery
-- Dates are Oregon dates (the database clock runs on UTC).
-- Safe to run more than once.

create or replace function public.sponsor_stage_follow_up()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Los_Angeles')::date;
  ball date;
begin
  if tg_op = 'INSERT' then
    if new.follow_up is not null then return new; end if;
  elsif new.status is not distinct from old.status
     or new.follow_up is distinct from old.follow_up then
    return new;
  end if;

  if new.status = 'contacted' then
    new.follow_up := today + 7;
  elsif new.status = 'talks' then
    new.follow_up := today + 5;
  elsif new.status = 'committed' then
    select event_date into ball from event_years where id = new.event_year_id;
    new.follow_up := greatest(coalesce(ball - 21, today + 7), today + 7);
    if coalesce(btrim(new.next_step), '') = '' then
      new.next_step := 'Confirm delivery date, quantities, and drop-off';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists sponsor_prospects_stage_follow_up on public.sponsor_prospects;
create trigger sponsor_prospects_stage_follow_up
  before insert or update on public.sponsor_prospects
  for each row execute function public.sponsor_stage_follow_up();

-- Trigger function only; not callable through the API (see 007).
revoke execute on function public.sponsor_stage_follow_up() from public, anon, authenticated;
