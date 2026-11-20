// Migration 012 (bar taps) on the real 001–012 chain, plus the planner model's
// round trip (rows -> state -> planner_replace payload) through the real function.
// Runs on an in-memory Postgres (PGlite) with Supabase stand-ins. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rowsToState, stateToPayload } from '../../src/lib/plannerModel.js'
import { tapsByKeg, isKeg } from '../../src/lib/plannerCalc.js'

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
  '006_tab_permissions', '007_function_hardening', '008_sponsor_stage_follow_ups', '009_sponsor_email',
  '011_pitch_voice', '012_planner_taps', '013_one_tap_per_keg']
for (const m of MIGRATIONS) await db.exec(read(`supabase/migrations/${m}.sql`))
await db.exec(read('supabase/migrations/012_planner_taps.sql')) // re-runnable
await db.exec(read('supabase/migrations/013_one_tap_per_keg.sql'))
await db.exec(`grant usage on schema public, auth, storage to authenticated, anon;
  grant all on all tables in schema public to authenticated, anon;`)

const PLANNER = 'b0000000-0000-0000-0000-000000000002' // Planner + Sponsors tabs
const OTHER = 'c0000000-0000-0000-0000-000000000003'   // no Planner tab
await db.exec(`insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000001', 'admin@x'), ('${PLANNER}', 'p@x'), ('${OTHER}', 'o@x');
  update profiles set tabs = '{planner,sponsors}' where id = '${PLANNER}';
  update profiles set tabs = '{budget}' where id = '${OTHER}';
  insert into event_years (label, event_date) values ('Ball 2027', '2027-01-16'), ('Ball 2028', '2028-01-15');`)
const Y27 = (await db.query(`select id from event_years where label = 'Ball 2027'`)).rows[0].id
const Y28 = (await db.query(`select id from event_years where label = 'Ball 2028'`)).rows[0].id
const SPONSOR = (await db.query(`insert into sponsor_prospects (event_year_id, name, category) values ('${Y27}', 'Breakside', 'Beer, cider & mead') returning id`)).rows[0].id

let pass = 0, fails = 0
const out = []
const check = (label, cond, detail = '') => { cond ? pass++ : fails++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  [' + detail + ']' : ''}`) }
async function as(who, sql, params) {
  await db.exec('begin')
  try {
    await db.exec('set local role authenticated')
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })])
    const r = await db.query(sql, params)
    await db.exec('commit')
    return { ok: true, rows: r.rows, affected: r.affectedRows }
  } catch (e) { await db.exec('rollback'); return { ok: false, error: e.message } }
}

// A plan for 2027: two bars, two kegs (one linked to the sponsor), one mixer.
// The IPA is (wrongly) listed on two taps, as an old export might have it.
const ids = { bar1: crypto.randomUUID(), bar2: crypto.randomUUID(), ipa: crypto.randomUUID(), cider: crypto.randomUUID(), mix: crypto.randomUUID() }
const state27 = {
  event: { attendees: 700, drinksPer: 2 },
  bars: [
    { id: ids.bar1, name: 'Gun Deck', equipment: ['Taps'], tapCount: 3, drinks: [],
      taps: [{ tap: 1, inventoryId: ids.ipa }, { tap: 2, inventoryId: ids.ipa }, { tap: 3, inventoryId: ids.cider }, { tap: 4, inventoryId: ids.cider }] },
    { id: ids.bar2, name: 'Bilge', equipment: ['Ice Bin/Cooler'], tapCount: 0, drinks: [], taps: [] },
  ],
  drinks: [],
  inventory: [
    { id: ids.ipa, name: 'Breakside IPA', source: 'sponsor', inHand: 1, unit: 'kegs', sponsorId: SPONSOR },
    { id: ids.cider, name: 'Cider', source: 'sponsor', inHand: 2, unit: '1/6 bbl kegs' },
    { id: ids.mix, name: 'Hurricane Mix', source: 'you', inHand: 10, unit: 'bottles' },
  ],
}
let r = await as(PLANNER, `select planner_replace($1, $2)`, [Y27, JSON.stringify(stateToPayload(state27))])
check('Planner crew can save a plan with taps', r.ok, r.error)

const plan = async (y) => {
  const bars = (await db.query(`select * from planner_bars where event_year_id = $1`, [y])).rows
  return {
    settings: (await db.query(`select * from planner_settings where event_year_id = $1`, [y])).rows[0],
    bars,
    drinks: [],
    assignments: [],
    taps: (await db.query(`select t.* from planner_taps t join planner_bars b on b.id = t.bar_id where b.event_year_id = $1`, [y])).rows,
    inventory: (await db.query(`select * from planner_inventory where event_year_id = $1`, [y])).rows,
  }
}
let p27 = await plan(Y27)
let s27 = rowsToState(p27, { label: 'Ball 2027' })
const deck = s27.bars.find((b) => b.name === 'Gun Deck')
const nameOf = (st, id) => st.inventory.find((i) => i.id === id)?.name
check('Tap count saved', deck.tapCount === 3, String(deck.tapCount))
const tapsLine = deck.taps.map((t) => `${nameOf(s27, t.inventoryId)}@${t.tap}`).join()
check('A tap past the bar\'s count, and a keg\'s second tap, are dropped', p27.taps.length === 2, String(p27.taps.length))
check('Taps point at the right kegs after the id remap (IPA keeps tap 1)', tapsLine === 'Breakside IPA@1,Cider@3', tapsLine)
check('Sponsor link kept within the same year', s27.inventory.find((i) => i.name === 'Breakside IPA').sponsorId === SPONSOR)
const usage = tapsByKeg(s27)
const ipaId = s27.inventory.find((i) => i.name === 'Breakside IPA').id
check('tapsByKeg has the IPA on one tap', usage[ipaId]?.length === 1)
const deckId = p27.bars.find((b) => b.name === 'Gun Deck').id
r = await as(PLANNER, `insert into planner_taps (bar_id, tap_number, inventory_id) values ($1, 2, $2)`, [deckId, ipaId])
check('Putting a keg on a second tap is refused', !r.ok, r.error)
r = await as(PLANNER, `insert into planner_taps (bar_id, tap_number) values ($1, 2)`, [deckId])
check('Several empty taps are fine', r.ok, r.error)
check('isKeg spots "kegs" and "1/6 bbl kegs", not bottles',
  s27.inventory.filter(isKeg).map((i) => i.name).sort().join() === 'Breakside IPA,Cider')

// Copy 2027 -> 2028, as the "Copy the Ball 2027 plan" button does.
r = await as(PLANNER, `select planner_replace($1, $2)`, [Y28, JSON.stringify(stateToPayload(s27))])
check('Copying the plan to another year works', r.ok, r.error)
const p28 = await plan(Y28)
const s28 = rowsToState(p28, { label: 'Ball 2028' })
check('Copied year keeps the taps', s28.bars.find((b) => b.name === 'Gun Deck').taps.filter((t) => t.inventoryId).length === 2)
check('Copied year has its own keg rows', !p28.inventory.some((i) => p27.inventory.some((j) => j.id === i.id)))
check("Copied year drops the link to last year's sponsor", s28.inventory.every((i) => i.sponsorId === null))

// Deletes
const capped = await as(PLANNER, `update planner_bars set tap_count = 31 where id = $1`, [p27.bars.find((b) => b.name === 'Gun Deck').id])
check('More than 30 taps is refused', !capped.ok)
r = await as(PLANNER, `delete from planner_inventory where id = $1`, [ipaId])
const after = (await db.query(`select inventory_id from planner_taps t join planner_bars b on b.id = t.bar_id where b.event_year_id = $1 order by tap_number`, [Y27])).rows
check('Deleting a keg empties its tap, other taps untouched', r.ok && after.length === 3 && after.filter((t) => t.inventory_id === null).length === 2, JSON.stringify(after))
r = await as(PLANNER, `delete from planner_bars where name = 'Gun Deck' and event_year_id = $1`, [Y27])
check('Deleting a bar removes its taps', r.ok && (await plan(Y27)).taps.length === 0)

// Access
r = await as(OTHER, `select id from planner_taps`)
check('Crew without Planner see no taps', r.ok && r.rows.length === 0)
r = await as(OTHER, `insert into planner_taps (bar_id, tap_number) select id, 1 from planner_bars limit 1`)
check('Crew without Planner cannot add taps', !r.ok || r.affected === 0)

console.log(out.join('\n'))
console.log(`\n${pass} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
