-- Pitch voice: each crew member's title as it appears in pitches ("Beverage
-- Experience Director"), and the Ball's current talking points that every
-- pitch should work in. Both feed the templates and the Claude drafts.
-- Safe to run more than once.

alter table public.profiles add column if not exists pitch_title text;
alter table public.settings add column if not exists pitch_talking_points text;
