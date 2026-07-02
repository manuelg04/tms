# AGENTS.MD

## Project Context

This repo is becoming a mini TMS for Colombian RNDC document operations.

The product direction is:

- `apps/web`: Next.js frontend for operators.
- Convex: app database, storage, live updates, notifications, and audit history.
- `apps/rndc-api`: Express/Node backend for official RNDC communication.
- `packages/rndc-core`: reusable RNDC XML, SOAP, parsing, evidence, and PDF logic.

RNDC communication must continue using XML/SOAP. Convex does not replace the RNDC protocol.

## Repo Layout

```text
apps/
  rndc-api/      Express API and CLI entrypoints for RNDC operations
  web/           Next.js app skeleton with Convex schema
packages/
  rndc-core/     RNDC XML, SOAP client, flow logic, parsing, evidence, and PDFs
docs/
  rndc/          RNDC webservice documentation
```

The official RNDC 2026 webservice guide is stored at:

```text
docs/rndc/GUIA-Uso-del-Web-Service-RNDC-V5-2026.pdf
```

## Important Safety Rules

- Accepted production RNDC records become official records.
- Default to `RNDC_MODE=dry-run` unless the user explicitly asks for live sending.
- Preserve raw evidence for every RNDC operation: request XML, response XML, parsed result, status, and timestamps.
- Never expose RNDC credentials in logs, screenshots, commits, or responses.
- The frontend must not talk directly to RNDC.
- Official actions should go through `apps/rndc-api` and shared logic in `packages/rndc-core`.
- Guard official actions against duplicate sends, retries, and double clicks.

## Commands

Install dependencies:

```bash
npm install
```

Run the RNDC backend:

```bash
npm run dev:rndc
```

Run the web app:

```bash
npm run dev:web
```

Run the existing dry-run RNDC flow:

```bash
npm run rndc:flow
```

Run the production-flow CLI entrypoint:

```bash
npm run rndc:prod-flow
```

Prepare masked XML requests for emission, fulfillment, and annulment:

```bash
npm run rndc:prepare-ops
```

Run remesa and manifest fulfillment:

```bash
npm run rndc:fulfill
npm run rndc:fulfill -- <path-to-evidence-json>
```

Ingest the Avansat drivers/vehicles consolidado into Convex (idempotent; add `--dry-run` to only parse and report):

```bash
npm run ingest:fleet -- <path-to-consolidado-csv>
```

Check RNDC endpoint reachability:

```bash
npm run rndc:ping
```

Resend a saved manifest XML:

```bash
npm run rndc:resend -- <path-to-request-xml>
```

Run annulment from saved evidence:

```bash
npm run rndc:annul -- <path-to-evidence-json>
```

Build everything:

```bash
npm run build
```

Typecheck everything:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

## Verification Expectations

Before reporting work as complete:

- Run `npm run build` after structural or dependency changes.
- Run `npm run typecheck` after TypeScript changes.
- Run `npm test` after RNDC core changes.
- Run `npm run rndc:flow` after changes to RNDC flow, XML, config, PDF, or CLI behavior.
- For frontend changes, run the web app and inspect desktop and mobile rendering.
- If working with the RNDC PDF or generated PDFs, render at least one page and inspect it visually.

## Deployment Direction

- `apps/web` is intended for Vercel.
- `apps/rndc-api` is intended for Railway or Render.
- `packages/rndc-core` is not deployed by itself; it is shared by the backend.

## RNDC Architecture Notes

Convex is active: `apps/web/convex/` has the schema plus `rndc.recordOperation` (ingest mutation guarded by `RNDC_INGEST_KEY`), `dashboard.*` queries, and `notifications.*`. The Express backend syncs every form operation through `apps/rndc-api/src/convexSync.ts`. The web app reads everything reactively with `useQuery`/`usePaginatedQuery`.

Convex should store:

- Trips.
- Remesas.
- Manifiestos.
- Ordenes de cargue.
- Cumplidos.
- Anulaciones.
- RNDC attempts.
- Notifications.
- Stored XML/PDF evidence.

Express should handle:

- RNDC credentials.
- XML construction.
- SOAP calls.
- RNDC response parsing.
- Official emit/cumplir/anular operations.
- Evidence normalization before Convex stores it.

The frontend should show states such as:

- `draft`
- `pending`
- `sent`
- `authorized`
- `rejected`
- `fulfilled`
- `annulled`

## Coding Guidelines

- Do not add code comments.
- Keep changes scoped to the requested task.
- Prefer existing RNDC core helpers over duplicating XML or SOAP logic.
- Use typed, explicit data shapes for new RNDC operations.
- Keep RNDC side effects isolated from UI code.
- Do not mention Codex as a co-author in commit messages.
