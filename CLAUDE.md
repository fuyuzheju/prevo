# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Coding Standards

1. **No type assertions in source code** — Do not use `as`, `as any`, `as type`, or non-null assertion (`!`). Use proper type narrowing, Zod validation, or type guards instead. If you believe a type assertion is strictly necessary, explain why and get explicit confirmation before writing it. Tests are excluded and you can freely use type assertions in tests.
2. **English in codebase** — All code, comments, commit messages, and any file contents in this repository must be written in English. Chinese is reserved for conversational communication with the user only.
3. **Comments only when necessary** — Skip comments for obvious or self-documenting code. Only add comments in places where the logic is genuinely complex, uses a non-obvious algorithm, could be misinterpreted, contains a workaround/patch, or is error-prone. When a comment is needed, make it thorough and clear — explain the *why*, not the *what*.

## Project overview

Cyclic inventory management ("prevo"): the server maintains a per-cycle trading state machine per (userId, productType) scope. Domain rules live in `docs/state.md` (state machine formulas) and `docs/struc.md` (server component responsibilities). Layout:

- `shared/` — pure domain types / dates / position math, no runtime dependencies; both ends import the sources directly
- `server/` — Express + Prisma (SQLite); cycle settlement is driven by a scheduled job (no settlement entry point for clients)
- `client/` — Vite + React + Tailwind v4 (blue primary); a separate directory that runs independently of the server
- `samples/` — multi-product historical-sales Excel import samples

## Common commands

The two directories are independent (no workspace package.json at the repo root); commands must run inside their own directory:

- server: `npm run dev` (tsx watch) / `npm start` (tsx), `npm test` (vitest run), `npx vitest run tests/<file>.test.ts` (single file), `npm run typecheck` (tsc --noEmit)
- client: `npm run dev` (vite, proxies /api → localhost:3000), `npm run build` (tsc + vite build), `npm run typecheck`
- Database: inside server, `./node_modules/.bin/prisma migrate dev --name <name>`; after a schema change you **must** also run `prisma generate` (migrate does not always generate on its own; the test database catches up via `migrate deploy` in vitest globalSetup)
- Local end-to-end: start both dev servers; to verify the API with curl, get a token via `/api/auth/login`

## Domain model (core — read docs/state.md before changing)

- All quantities are **signed fixed-point integers in units of 1/1000** (`QUANTITY_SCALE` in `shared/quantity.ts`): DB / API / models hold scaled integers (0.5 → 500), the only conversions happen at the three boundaries — manual input, Excel import, UI display (`parseQuantity` / `formatQuantity`). Amounts may be **negative** (a return / correction reversing its line) and **0 is legal** (no-op; the UI only warns). The formulas are linear, so negatives need no special cases. Money is not modeled — if it is added later, store integers ×100 by convention. Prisma has no Decimal support on SQLite, so columns stay `Int` (never `Float`).
- `StateSnapshot {cycle, inventory, soldTransit, boughtTransit, sent, received, sale, purchase}`; one snapshot row per (scope, cycle). Cycle recurrence:
  `inventory' = inventory + received − sent`; `soldTransit' = soldTransit + sale − sent`; `boughtTransit' = boughtTransit + purchase − received`
- `available = inventory + boughtTransit − soldTransit` (stateMachine.computeAvailable)
- The four record kinds `PURCHASE/SELL/SEND/RECEIVE` form the ledger and are **never deleted**; `ScopeRecord.cycle` null = still pending this cycle, non-null = already folded into cycle N (guards against double folding)
- Settlement (settlePending*) groups pending records by kind into the four cycle inputs sale/purchase/sent/received, advances one cycle, then tags the records with that cycle; an empty cycle produces no snapshot. **Settlement has no HTTP entry point** — it only runs from the daily scheduled job in `settlement.ts` (env var SETTLE_TIME, default 00:05, server local timezone), settling per **record local date**; runs missed during downtime are caught up by grouping records per date.
- Historical sales import (`ImportedSale`) is a prediction-only dataset: it never touches the state machine / ledger / live position; real SELL records are merged into the prediction automatically; dates must not be later than today (a future date rejects the whole batch).
- Prediction: safety stock = predicted sales for the next two weeks = average daily sales over the last 28 days (zero-sale days included; from the earliest day when there is less history) × 14, where a day's sales can be negative (return days pull the average down); purchase suggestion = max(0, safety stock − available), rounded up to the orderMultiple when one is set. The model lives in predictor.ts; replacing it only touches that file.
- "Live position" (current inventory / available) = latest settled snapshot + extrapolation from pending records; the algorithm lives in `shared/model.ts` (`applyPendingToPosition/availableOf`) and is shared by client (query page) and server (decision) — do not write a second copy.

## Server structure notes

- Module layers (per docs/struc.md): under modules/ — stateMachine (pure formulas + persistence), stateSummary (ledger + settle primitives), products, userSystem (JWT + bcrypt), settlement (scheduled job), predictor/decision/salesHistory (prediction & decision), webApi (routes + guards); `app.ts` assembles and `index.ts` starts the process and registers the timer.
- Routes: scope routes look like `/api/products/:productType/{state,states,records,purchase,sell,send,receive,predict,sales/import}`; collection routes are `/api/products` (list/create/delete) and `/api/sales/import` (multi-product batch, separate salesRouter); **everything except register/login requires a Bearer token**; scope operations first run `requireProduct` (unknown product → 404 PRODUCT_NOT_FOUND).
- Prisma 7 notes: the generator `provider="prisma-client"` outputs to `server/generated/prisma`, and source imports use `... from "../generated/prisma/client.js"` (the .js suffix maps to .ts under nodenext); the datasource url lives in `prisma.config.ts` (DATABASE_URL); relative `file:` paths resolve against the **project root** → dev.db is server/dev.db, matching runtime resolution.
- SQLite does not enforce FKs → `removeUser`/`removeProduct` are **explicit table-by-table deletes** (scopeRecord→cycleState→importedSale→product→user); add new tables here when the schema grows.
- Relative imports in our own code always use the real `.ts` extension (`allowImportingTsExtensions`, noEmit repo-wide); imports into shared are `../../../shared/model.ts` or `../../shared/date.ts` (depending on depth).
- API errors are uniformly `ApiError(status, code, message)` → `{error:{code,message}}`; Express 5 catches async throws automatically.

## Server test conventions

- Tests use a separate `test.db` (not dev.db): `tests/globalSetup.ts` runs `migrate deploy` against it and `tests/setupEnv.ts` sets DATABASE_URL before the db module is first imported; vitest runs with `fileParallelism:false` (one shared sqlite file).
- `tests/helpers.ts` provides `truncateAll/createUser/createProduct/createScope`; **after adding a table to the schema, add it to truncateAll and to the explicit delete paths**, or tests will pollute each other.
- Date-sensitive tests construct "N days ago" with `addLocalDays(new Date(), -n)` to avoid timezone / boundary brittleness.

## Client structure notes

- Page routes live in `App.tsx`: login at /login; protected pages share the RequireAuth layout (TopBar); query /, add records /records, sales prediction /predict, product management /products, profile /profile, settings /settings.
- The three product pages (query/add/predict) use `ProductSidebar` (component) + the `useProducts` hook; products are server-side entities, so never keep a product list in localStorage (the legacy storage.ts only keeps the token).
- Heavy libraries load on demand: `PredictPage` is route-level lazy (echarts), xlsx is dynamically imported only when a file is picked; the historical-sales import lives on the **product management page** (multi-product long table: product | date | quantity), parsing happens on the client (`lib/excelImport.ts`, raw:false reads the displayed text to avoid timezones), and the confirmed data goes through the batch endpoint. Rows with parse errors block the whole import; products that do not exist yet are only a warning — after the user confirms, the client creates them (default orderMultiple = no constraint) and then imports (`PRODUCT_EXISTS` from a stale list is tolerated). The batch endpoint itself still rejects unknown product names.
- Styling: tailwind v4 (`index.css` is a single `@import "tailwindcss"`), blue-600 primary; uniformly use the Button/Card/Field/Input/ConfirmDialog etc. from `components/ui.tsx`.

## Demo data

dev.db contains the seed account `demo` / `demo1234` (4 products × ~20 records across 12 days, some settled by day, with fractional quantities and one return day per product, plus 30 days of imported history each); the Excel files in `samples/` test the import on the product management page (clean / new-product auto-create / error rows). To reset the demo data, delete that user and recreate it (see the seed-script structure from a historical session).
