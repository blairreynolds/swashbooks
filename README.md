# SwashBooks

Lightweight financial dashboard for **The Swashbuckler's Ball** — an annual ~700-person
charity event in Milwaukie, Oregon. A shared tracker with reports, not accounting software:
no double-entry ledger, no bank feeds, no payroll.

**Stack:** React + Vite + Tailwind CSS · Supabase (Postgres, Auth, Storage) · Vercel/Netlify hosting.
All Google-originated data (Sheets/Forms exports) arrives via manual CSV upload — no Google APIs.

## Status

- **Phase 1 (this build):** auth + roles, event years, categories, contacts, transactions
  with receipt upload, budgets (with copy-from-previous-year), dashboard with
  budget-vs-actual. ✅
- **Phase 2 (next):** bills with pay→transaction flow, invoices with PDF + line items,
  outbound donations. The database schema for these already exists.
- **Phase 3:** in-kind donations + acknowledgment letters, CSV importer with mapping
  presets, year-over-year views.

## One-time setup

1. **Create the Supabase project** — at [supabase.com](https://supabase.com), create a
   project (free tier; name it `swashbooks`, region US West). You'll need the project's
   **URL** and **anon public key** from *Project Settings → API*.
2. **Apply the schema** — open the project's **SQL Editor**, paste the entire contents of
   [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql), and run it.
   This creates every table (Phases 1–3), row-level security, the private `files` storage
   bucket, and seeds the default categories.
3. **Configure the app** — copy `.env.example` to `.env` and fill in the URL and anon key.
4. **Run it:**
   ```
   npm install
   npm run dev
   ```
5. **Create the first account** on the sign-in page. **The first account automatically
   becomes admin**; everyone who signs up after starts as a member (admins promote/demote
   in Settings → Crew).
6. In **Settings**, create the first event year (e.g. "Ball 2026"), confirm org info, and
   set entity status once the 501(c)(3) question is resolved.

### Auth notes

- Supabase sends a confirmation email on signup by default. For a 2–5 person crew you can
  disable this: *Authentication → Providers → Email → turn off "Confirm email"*.
- Roles: **admin** (user/category/settings management, hard deletes) vs **member**
  (full create/edit on financial records). Enforced by Postgres RLS, not just the UI.

## Deploying (Vercel)

Push this repo to GitHub, import it in Vercel, framework preset **Vite**, and add the two
`VITE_SUPABASE_*` environment variables. Netlify works identically. Nothing else to configure.

> Free-tier note: Supabase pauses free projects after ~1 week without traffic. Restoring is
> one click in the Supabase dashboard; expect to do this when the crew comes back after a
> quiet stretch.

## Development notes

- Design language is derived from the BG Reynolds ops dashboard (dark GitHub-style palette,
  gold/coral accents, Oswald display font) but this is an entirely separate codebase and entity.
- `voided` transactions stay visible (struck) but are excluded from all totals; hard delete
  is admin-only.
- Receipt/bill files and the logo live in the private `files` bucket; the app opens them via
  short-lived signed URLs. Nothing is publicly accessible.
- A **Charitable Giving** expense category is seeded beyond the spec's list — Phase 2's
  outbound-donation flow will post its linked expense transactions there.
