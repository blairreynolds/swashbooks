// Migration 009 (sponsor email) on the real 001–009 chain: who can read and
// change pitch files, logged emails, the Gmail connection and its secrets.
// Runs on an in-memory Postgres (PGlite) with Supabase stand-ins. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const read = (p) => readFileSync(`${REPO}${p}`, 'utf8').replace(/\r/g, '')
const db = new PGlite()
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
`)
const MIGRATIONS = ['001_init', '002_import_presets', '003_planner', '004_crew_budget_lines', '005_sponsors',
  '006_tab_permissions', '007_function_hardening', '008_sponsor_stage_follow_ups', '009_sponsor_email']
for (const m of MIGRATIONS) await db.exec(read(`supabase/migrations/${m}.sql`))
await db.exec(read('supabase/migrations/009_sponsor_email.sql')) // re-runnable
await db.exec(`grant usage on schema public, auth, storage to authenticated, anon;
  grant all on all tables in schema public to authenticated, anon;
  grant all on storage.objects to authenticated;`)

const ADMIN = 'a0000000-0000-0000-0000-000000000001'
const CREW = 'b0000000-0000-0000-0000-000000000002' // Sponsors tab
const OTHER = 'c0000000-0000-0000-0000-000000000003' // no Sponsors tab
await db.exec(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@x'), ('${CREW}', 'crew@x'), ('${OTHER}', 'other@x');
  update profiles set role = 'admin' where id = '${ADMIN}';
  update profiles set tabs = '{sponsors}' where id = '${CREW}';
  update profiles set tabs = '{budget}' where id = '${OTHER}';
  insert into event_years (label, event_date) values ('Ball', '2027-01-16');`)
const YEAR = (await db.query(`select id from event_years`)).rows[0].id
const PROSPECT = (await db.query(`insert into sponsor_prospects (event_year_id, name) values ('${YEAR}', 'Rum Co') returning id`)).rows[0].id
const IN_ID = (await db.query(`insert into sponsor_emails (prospect_id, direction, gmail_message_id, gmail_thread_id, subject)
  values ('${PROSPECT}', 'in', 'm2', 't1', 'Re: Bar partnership') returning id`)).rows[0].id
const OUT_ID = (await db.query(`insert into sponsor_emails (prospect_id, direction, gmail_message_id, gmail_thread_id, subject)
  values ('${PROSPECT}', 'out', 'm1', 't1', 'Bar partnership') returning id`)).rows[0].id
await db.exec(`insert into mail_connection (id, email) values (1, 'sender@x');
  insert into mail_oauth_states (nonce, user_id, return_to) values ('n1', '${ADMIN}', 'https://x/')`)

let pass = 0, fails = 0
const out = []
const check = (label, cond, detail = '') => { cond ? pass++ : fails++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`) }
async function as(who, sql) {
  await db.exec('begin')
  try {
    await db.exec('set local role authenticated')
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
    const r = await db.query(sql)
    await db.exec('commit')
    return { ok: true, rows: r.rows, affected: r.affectedRows }
  } catch (e) { await db.exec('rollback'); return { ok: false, error: e.message } }
}
const handledAt = async () => (await db.query(`select handled_at, handled_by from sponsor_emails where id = '${IN_ID}'`)).rows[0]

// Logged emails
let r = await as(CREW, `select id from sponsor_emails`)
check('Sponsors crew can read logged emails', r.ok && r.rows.length === 2)
r = await as(OTHER, `select id from sponsor_emails`)
check('Crew without Sponsors see no emails', r.ok && r.rows.length === 0)
r = await as(CREW, `insert into sponsor_emails (prospect_id, direction, gmail_message_id, gmail_thread_id) values ('${PROSPECT}', 'in', 'fake', 't1')`)
check('Crew cannot log emails themselves', !r.ok)
r = await as(CREW, `update sponsor_emails set subject = 'edited' where id = '${IN_ID}'`)
check('Crew cannot edit a logged email', !r.ok || r.affected === 0)

// Mark handled
r = await as(CREW, `select sponsor_email_handled('${IN_ID}', true)`)
let h = await handledAt()
check('Mark handled stamps when and who', r.ok && h.handled_at && h.handled_by === CREW, r.error)
r = await as(ADMIN, `select sponsor_email_handled('${IN_ID}', true)`)
h = await handledAt()
check('Marking it again keeps the first handler', r.ok && h.handled_by === CREW)
r = await as(CREW, `select sponsor_email_handled('${IN_ID}', false)`)
h = await handledAt()
check('Undo clears it', r.ok && !h.handled_at && !h.handled_by)
await as(CREW, `select sponsor_email_handled('${OUT_ID}', true)`)
check('Sent emails are never marked handled', !(await db.query(`select handled_at from sponsor_emails where id = '${OUT_ID}'`)).rows[0].handled_at)
r = await as(OTHER, `select sponsor_email_handled('${IN_ID}', true)`)
check('Crew without Sponsors cannot mark handled', !r.ok && /Sponsors access/.test(r.error), r.error)

// Gmail connection and secrets
r = await as(CREW, `select email from mail_connection`)
check('Sponsors crew can see which address sends', r.ok && r.rows[0]?.email === 'sender@x')
r = await as(CREW, `update mail_connection set email = 'evil@x'`)
check('Crew cannot change the sending address', !r.ok || r.affected === 0)
r = await as(ADMIN, `select nonce from mail_oauth_states`)
check('Sign-in codes are hidden even from admins', r.ok && r.rows.length === 0)
for (const fn of ['mail_refresh_token()', 'mail_cron_secret()', "mail_store_refresh_token('x')"]) {
  r = await as(ADMIN, `select ${fn}`)
  check(`Signed-in users cannot call ${fn.replace(/\(.*/, '')}`, !r.ok && /permission denied/.test(r.error), r.error)
}
const svcGrant = (await db.query(`select has_function_privilege('service_role', 'public.mail_refresh_token()', 'execute') ok`)).rows[0].ok
check('The function (service role) can read the token', svcGrant)

// Pitch files
r = await as(CREW, `insert into sponsor_files (label, filename, storage_path, size_bytes) values ('One-sheet', 'one.pdf', 'p/one.pdf', 1000) returning created_by`)
check('Sponsors crew can add a pitch file, credited to them', r.ok && r.rows[0].created_by === CREW, r.error)
r = await as(OTHER, `select id from sponsor_files`)
check('Crew without Sponsors cannot see pitch files', r.ok && r.rows.length === 0)
r = await as(CREW, `update sponsor_files set attach_by_default = true where label = 'One-sheet'`)
check('Sponsors crew can set attach-by-default', r.ok && r.affected === 1)
r = await as(CREW, `delete from sponsor_files where label = 'One-sheet'`)
check('Crew cannot delete a pitch file', r.ok && r.affected === 0)
r = await as(ADMIN, `delete from sponsor_files where label = 'One-sheet'`)
check('Admins can delete a pitch file', r.ok && r.affected === 1)
r = await as(CREW, `insert into sponsor_files (label, filename, storage_path) values ('  ', 'x.pdf', 'p/x.pdf')`)
check('A blank label is refused', !r.ok)

// Storage bucket
r = await as(CREW, `insert into storage.objects (bucket_id, name) values ('sponsor-files', 'p/deck.pdf')`)
check('Sponsors crew can upload to the pitch-file bucket', r.ok, r.error)
r = await as(OTHER, `insert into storage.objects (bucket_id, name) values ('sponsor-files', 'p/other.pdf')`)
check('Crew without Sponsors cannot upload there', !r.ok)
r = await as(OTHER, `select name from storage.objects where bucket_id = 'sponsor-files'`)
check('Crew without Sponsors cannot download pitch files', r.ok && r.rows.length === 0)
r = await as(CREW, `select name from storage.objects where bucket_id = 'files'`)
check('Sponsors-only crew still cannot read receipts and bills', r.ok && r.rows.length === 0)
r = await as(CREW, `delete from storage.objects where bucket_id = 'sponsor-files'`)
check('Crew cannot delete stored pitch files', r.ok && r.affected === 0)

// Deleting a prospect takes its emails with it
await db.exec(`delete from sponsor_prospects where id = '${PROSPECT}'`)
check('Emails go when the prospect is deleted', (await db.query(`select count(*)::int n from sponsor_emails`)).rows[0].n === 0)

console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
