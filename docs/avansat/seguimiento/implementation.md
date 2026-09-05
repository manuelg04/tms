# Seguimiento implementation

## Local implementation, 2026-09-04

The first implementation adds `/control/seguimiento`, `/control/seguimiento/[dispatchId]`, and `/configuracion/alertas-visuales` to the existing TMS navigation. It follows the observed screens documented in this directory. This is not a certification of complete Avansat parity or a record of deployment.

Implemented behavior:

- En-route and pending-arrival queues, 17 shared filters, independent searches and sorting, expandable pending arrivals, counts and empty states.
- Excel exports of the displayed order and filtered rows, with 19 en-route columns or 17 pending-arrival columns, preserved leading zeroes, and headers when empty.
- Dispatch information, distinct planned checkpoints and recorded reports, independent controller notes, and the four source selectors. A report's source is explicit; a GPS incident label does not automatically mean GPS source.
- Ordinary, virtual and delivery checkpoint forms. Incident selection resets unsaved fields; ST controls the requested date/time fields. Observations are limited to 500 characters. Borrar restores the form defaults.
- Persisted report and note creation, authenticated controller attribution, transaction auditing, request replay protection, and revision checks when another controller has changed the dispatch.
- Historical position markers, zoom, map attribution, and a position popup with event, timestamp, location and speed.
- Visual-alarm listing, creation, editing, a 216-color palette, reset, and confirmed deletion. The tracking legend and supplied alarm references use the saved configuration.

## Data and activation

Tracking uses organization-scoped Convex tables. It does not reinterpret the existing expediente number as an Avansat dispatch number, or modify official RNDC documents. The optional expediente relationship must be supplied explicitly and belong to the same organization.

`trackingImport.installReferenceCatalogues` is an internal mutation for initial setup. It installs the captured incident definitions and five observed alarm settings. Existing incident and alarm records are preserved. Re-running setup after deliberate deletion of all alarms does not recreate them.

`trackingImport.importDispatch` is an internal mutation accepting an explicit organization, source identity, dispatch identifier, queue, summary, information fields, checkpoint occurrences, reports, controller notes, positions and location suggestions. It imports a complete initial snapshot atomically. Replaying the same source identity returns the existing dispatch; a different source identity cannot overwrite a tracked dispatch. This is an initial import, not an ongoing synchronization process. Repeated location names retain distinct occurrence identities.

The reference incident data contains 242 codes, using the 239 captured editor definitions where available. Only the 76 codes actually observed in report suggestions are initially selectable. The three definitions absent from the editor remain unselectable. This conservative catalogue does not assert that the observed suggestions exhaust every Avansat reporting context. Complete lookup eligibility still needs source confirmation.

Actual trips, driver information, GPS credentials and geographic positions are not seeded by setup. The fixtures under `apps/web/testing` use invented dispatches and people, and run only in an isolated test database.

Imported reports preserve an unknown Antes/Sitio value as absent; only new form submissions supply a definite value.

Activation on a shared environment requires deploying the new schema and functions to that environment, installing its organization's reference catalogues, and importing approved dispatch snapshots with their actual route plans. Existing TMS dispatches are not automatically enrolled because the source route and departure rules have not been established. No shared database or public deployment was changed by this implementation.

## Explicit implementation choices and remaining parity gaps

The research distinguishes observed form behavior from untested submission effects. These choices make the initial implementation usable and testable without representing unknown source rules as established facts:

| Area | Current implementation | Remaining evidence |
| --- | --- | --- |
| Timer and automatic alarms | Displays supplied `time` and `alarmCode`. New reports clear these now-stale calculated values. No guessed timer, threshold engine, or automatic color changes. | Source calculation, units, reference times, boundaries, and GA/MA/NE reset or retention interaction. |
| Checkpoint completion | `Sitio` plus incident `2 — Ok` completes the selected checkpoint occurrence. For delivery this moves the dispatch to pending arrival. Matching location text alone does not consume another occurrence. | Controlled Avansat acceptance/read-back for the complete transition rules. |
| Arrival and rating | Pending arrival remains distinct from delivery reporting. No arrival, rating, RIT or RNDC submission is triggered here. | Separate arrival/rating workflow implementation and source verification. |
| Alarm validation | Nonempty names up to 10 characters, integer times from 0 to 999, six-digit hex colors with optional leading `#`. Equal names/times are allowed. | Source server acceptance rules for blanks, signed/decimal times, duplicates and maximum counts. |
| Alarm identity and deletion | New code follows the highest currently stored numeric code. Deletion clears matching supplied dispatch alarm references. Empty catalogues remain empty. | Source code allocation and deletion/recalculation behavior. |
| Permissions | Existing TMS administrators and operators can report; auditors can read. Only administrators can edit alarms. Organization boundaries apply to every action. | Source permissions beyond the inspected administrator account. |
| Places | Imported location suggestions, five-character case-insensitive search, first ten matching records in source order; free text remains available. | Complete backing dataset, eligibility and universal result-limit rules. |
| Position data | Displays explicitly imported historical positions. No additional GPS provider, ingestion contract or polling interval is inferred. | Provider/source classification, refresh and failure behavior. |
| NEM | Preserved as a supplied string. | Source definition. |

These gaps remain visible in the implementation record and must be resolved before claiming full source parity. They are not new operator features.

## Verification

The backend tests execute the actual tracking queries and mutations with `convex-test`. They cover authorization, organization boundaries, transaction read-back, repeated location names, invalid input, duplicate requests, changed records, delivery queues, alarm changes, setup replay, search and Excel output.

Browser tests run the actual Next.js pages against those same handlers through an isolated WebSocket test adapter. Authentication is supplied by the test, and unexpected remote database or RNDC requests are blocked. This validates rendering and save/reload behavior without writing shared data; it does not validate a hosted deployment or the real authentication provider.

The existing workspace test suite passed. The focused tracking suite passed all 10 tests, including simultaneous controllers and concurrent retries. The four desktop/mobile browser checks passed against both the development server and the built application, with no browser console or page errors. Type checking and the production build passed. Screenshots were inspected for the board, report form, historical map popup and visual-alarm list.

Run the tracking browser tests with:

```sh
E2E_KEEP_DATA=1 npx playwright test e2e/tracking.spec.ts --project=desktop --project=mobile --output=/tmp/tms-tracking-qa/results
```

Run this command from `apps/web`. `E2E_KEEP_DATA=1` skips the repository's existing remote cleanup teardown, which is unnecessary for isolated fixtures. Screenshots and traces are written outside the repository.
