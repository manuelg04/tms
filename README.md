# TMS RNDC

Monorepo for a mini TMS that keeps RNDC document operations in a dedicated backend and uses a Next.js + Convex web app for the operator workflow.

## Structure

```text
apps/
  rndc-api/      Express API and CLI entrypoints for RNDC operations
  web/           Authenticated Next.js operator app and Convex domain model
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

The official data and error exports supplied on July 9, 2026 are preserved with integrity hashes under `docs/rndc/dictionaries/2026-07-09/`.

## Development

Install dependencies from the repo root:

```bash
npm install
```

Configure the local dummy users and server-to-server credentials:

```bash
npm run auth:setup-demo
```

The generated password and the three dummy accounts are saved in the ignored, owner-only file `apps/web/.demo-auth.json`. The accounts cover administrator, operator, and auditor access.

After connecting `apps/web` to a Convex development deployment, set that deployment's `CONVEX_AUTH_JWKS` and `RNDC_INGEST_KEY` from `apps/web/.env.local`, then publish the schema and functions:

```bash
cd apps/web
npx convex env set CONVEX_AUTH_JWKS '<value from .env.local>'
npx convex env set RNDC_INGEST_KEY '<value from .env.local>'
npx convex dev --once
cd ../..
```

Create the idempotent local workspace with one order, an assigned fleet, two remesas, and one manifest:

```bash
npm run demo:bootstrap
```

Run the RNDC backend:

```bash
npm run dev:rndc
```

Run the web app:

```bash
npm run dev:web
```

The main operator flow lives under `/expedientes`. It persists customers, locations, service orders, assignments, several remesas per manifest, official document states, operational events, protected evidence, and durable RNDC operations. The older `/operaciones` console remains available only as a compatibility surface.

Push Convex schema and functions after editing `apps/web/convex/`:

```bash
cd apps/web && npx convex dev --once
```

The browser never receives the RNDC service credential. Typed same-origin routes register each action in Convex before the backend is called. The backend preserves masked request XML, response XML, result JSON, and generated PDFs in protected Convex storage when durable operation headers are present.

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

The exact preparation, rehearsal, controlled live test, evidence, rollback, and monitoring checklist is in `docs/rndc/GUIA-PRIMERA-PRUEBA-REAL-Y-PRODUCCION.md`.

## Safety

The repository defaults to `RNDC_MODE=dry-run`. Demo authentication blocks live RNDC traffic even if an environment variable is changed accidentally. Do not use `RNDC_MODE=live` with fake data against production; accepted records become official RNDC records.
