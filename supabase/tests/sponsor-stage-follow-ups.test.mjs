// Migration 008 (stage-driven follow-ups) on the real 001–008 chain.
// Runs every migration in order on an in-memory Postgres (PGlite) with Supabase
// stand-ins, then checks the stage-driven follow-up rules. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const read = (p) => readFileSync(`${REPO}${p}`, 'utf8').replace(/\r/g, '')
const db = new PGlite()
await db.exec(`
  create role authenticated nologin; create role anon nologin;
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
for (const m of ['001_init', '002_import_presets', '003_planner', '004_crew_budget_lines', '005_sponsors', '006_tab_permissions', '007_function_hardening', '008_sponsor_stage_follow_ups']) {
  await db.exec(read(`supabase/migrations/${m}.sql`))
}
await db.exec(read('supabase/migrations/008_sponsor_stage_follow_ups.sql')) // re-runnable
await db.exec(`grant usage on schema public, auth, storage to authenticated, anon; grant all on all tables in schema public to authenticated, anon;`)

const ME = 'b0000000-0000-0000-0000-000000000002'
await db.exec(`insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000001', 'admin@x'), ('${ME}', 'm@x');
  update profiles set tabs = '{sponsors}' where id = '${ME}';`)
const today = (await db.query(`select (now() at time zone 'America/Los_Angeles')::date d`)).rows[0].d
const iso = (d) => d.toISOString().slice(0, 10)
const plus = (n) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + n); return iso(d) }

// Ball far away, and Ball close (3-week rule would land before today+7)
await db.exec(`insert into event_years (label, event_date) values ('Far', '${plus(120)}'), ('Near', '${plus(20)}')`)
const FAR = (await db.query(`select id from event_years where label = 'Far'`)).rows[0].id
const NEAR = (await db.query(`select id from event_years where label = 'Near'`)).rows[0].id

let pass = 0, fails = 0
const out = []
const check = (label, cond, detail = '') => { cond ? pass++ : fails++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`) }
async function as(sql) {
  await db.exec('begin')
  try {
    await db.exec('set local role authenticated')
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ME, role: 'authenticated' })])
    const r = await db.query(sql)
    await db.exec('commit')
    return { ok: true, rows: r.rows }
  } catch (e) { await db.exec('rollback'); return { ok: false, error: e.message } }
}
const fu = (r) => (r.ok && r.rows[0]?.follow_up ? iso(r.rows[0].follow_up) : r.error ?? 'null')
const add = async (name, extra = '', yr = FAR) => (await as(`insert into sponsor_prospects (event_year_id, name ${extra ? ',' + extra.split('=')[0] : ''}) values ('${yr}', '${name}' ${extra ? ",'" + extra.split('=')[1] + "'" : ''}) returning id`)).rows[0].id

let id = await add('A')
let r = await as(`update sponsor_prospects set status = 'contacted' where id = '${id}' returning follow_up`)
check('Contacted sets follow-up to 7 days out', fu(r) === plus(7), fu(r))
r = await as(`update sponsor_prospects set status = 'talks' where id = '${id}' returning follow_up`)
check('In talks sets follow-up to 5 days out (replacing the old date)', fu(r) === plus(5), fu(r))
r = await as(`update sponsor_prospects set status = 'committed' where id = '${id}' returning follow_up, next_step`)
check('Committed sets follow-up 3 weeks before the Ball', fu(r) === plus(99), fu(r))
check('Committed fills an empty next step', r.rows?.[0]?.next_step === 'Confirm delivery date, quantities, and drop-off', r.rows?.[0]?.next_step)

id = await add('B', '', NEAR)
r = await as(`update sponsor_prospects set status = 'committed', next_step = 'Pick up at warehouse' where id = '${id}' returning follow_up, next_step`)
check('Committed close to the Ball: never sooner than a week out', fu(r) === plus(7), fu(r))
check('Committed keeps an existing next step', r.rows?.[0]?.next_step === 'Pick up at warehouse')

id = await add('C')
r = await as(`update sponsor_prospects set status = 'contacted', follow_up = '${plus(30)}' where id = '${id}' returning follow_up`)
check('A date chosen in the same edit wins', fu(r) === plus(30), fu(r))
r = await as(`update sponsor_prospects set status = 'talks', follow_up = null where id = '${id}' returning follow_up`)
check('Clearing the date in the same edit is respected', fu(r) === 'null', fu(r))

id = await add('D')
r = await as(`update sponsor_prospects set follow_up = '${plus(3)}' where id = '${id}' returning follow_up`)
r = await as(`update sponsor_prospects set next_step = 'x' where id = '${id}' returning follow_up`)
check('Edits that do not change the stage leave the date alone', fu(r) === plus(3), fu(r))
r = await as(`update sponsor_prospects set status = 'to_contact' where id = '${id}' returning follow_up`)
check('Stages without a rule leave the date alone', fu(r) === plus(3), fu(r))
r = await as(`update sponsor_prospects set status = 'declined' where id = '${id}' returning follow_up`)
check('Declined leaves the date alone (it just stops counting as due)', fu(r) === plus(3), fu(r))

r = await as(`insert into sponsor_prospects (event_year_id, name, status) values ('${FAR}', 'E', 'contacted') returning follow_up`)
check('A new prospect added at Contacted gets a follow-up', fu(r) === plus(7), fu(r))
r = await as(`insert into sponsor_prospects (event_year_id, name, status, follow_up) values ('${FAR}', 'F', 'contacted', '${plus(2)}') returning follow_up`)
check('A new prospect with its own date keeps it', fu(r) === plus(2), fu(r))

const lines = (await db.query(`select count(*)::int c from sponsor_activity a join sponsor_prospects p on p.id = a.prospect_id where p.name = 'A' and a.kind = 'status'`)).rows[0].c
check('stage history still logs every change (Added + 3 moves)', lines === 4, String(lines))
r = await as(`select public.sponsor_stage_follow_up()`)
check('trigger function is not callable through the API', !r.ok && /permission denied/.test(r.error), r.error)

console.log(`(Oregon date in test: ${iso(today)})`)
console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
