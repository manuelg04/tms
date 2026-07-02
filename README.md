# TMS RNDC

Monorepo for a mini TMS that keeps RNDC document operations in a dedicated backend and uses a Next.js + Convex web app for the operator workflow.

## Structure

```text
apps/
  rndc-api/      Express API and CLI entrypoints for RNDC operations
  web/           Next.js app skeleton with Convex schema
packages/
  rndc-core/     RNDC XML, SOAP client, flow logic, parsing, evidence, and PDFs
docs/
  rndc/          RNDC webservice documentation
```

## RNDC documentation

The 2026 RNDC webservice guide is stored at:

```text
docs/rndc/GUIA-Uso-del-Web-Service-RNDC-V5-2026.pdf
```

## Development

Install dependencies from the repo root:

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

The web app is a live dashboard backed by Convex with three pages: Panel (`/`), Operaciones (`/operaciones`), and Documentos (`/documentos`). Convex credentials live in `apps/web/.env.local` (see `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`).

Push Convex schema and functions after editing `apps/web/convex/`:

```bash
cd apps/web && npx convex dev --once
```

The RNDC backend records every form operation in Convex when `CONVEX_URL` and `RNDC_INGEST_KEY` are set in the root `.env`. The same `RNDC_INGEST_KEY` value must be set on the Convex deployment with `npx convex env set RNDC_INGEST_KEY <value>`.

Run the existing RNDC dry-run flow:

```bash
npm run rndc:flow
```

Prepare masked XML requests for emission, fulfillment, and annulment:

```bash
npm run rndc:prepare-ops
```

Issue the MTM loading order through RNDC cargo information, process 1, and generate its local PDF:

```bash
npm run rndc:loading-order
```

Run remesa and manifest fulfillment from the MTM reference scenario or a saved evidence file:

```bash
npm run rndc:fulfill
npm run rndc:fulfill -- <path-to-evidence-json>
```

Look up one RNDC driver and vehicle pair and store it locally:

```bash
npm run rndc:lookup-pair -- C 123456789 ABC123
```

Look up several pairs from a JSON file:

```bash
npm run rndc:lookup-pairs -- ./pairs.json
```

The pairs file should contain:

```json
[
  { "idType": "C", "id": "123456789", "plate": "ABC123" }
]
```

Local master data is written under the configured `RNDC_LOCAL_DATA_DIR`. With the default npm workspace command, that resolves to `apps/rndc-api/local/rndc-masters`, and it is ignored by git.

Look up owner and vehicle records from RNDC:

```bash
npm run rndc:lookup-owner-vehicle -- C 123456789 ABC123
npm run rndc:lookup-owner-vehicles -- ./owner-vehicles.json
```

Run checks:

```bash
npm run build
npm run typecheck
npm test
```

## Deployment direction

- `apps/web` is the Vercel target.
- `apps/rndc-api` is the Railway or Render target.
- `packages/rndc-core` is shared RNDC logic used by the backend.

RNDC communication still happens through XML/SOAP. Convex is for application data, live status, notifications, storage, and audit history.

## Safety

Do not use `RNDC_MODE=live` with fake data against production. Accepted production records become official RNDC records.
