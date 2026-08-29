# Loading order Avansat parity implementation plan

## Completion criteria

- The page shows a real unique loading-order number in a read-only field before save.
- The visible fields match the approved Avansat list and the service-order input is absent.
- Saving consumes the reserved number and persists it on the dispatch and loading-order draft.
- No official RNDC request is triggered.
- Automated checks, typecheck, build, and desktop/mobile browser verification pass.

## Tasks

1. Add failing tests for reservation behavior and the new form contract.
2. Add the reservation record and authenticated reserve-and-consume mutations.
3. Persist the reserved number during dispatch creation and prevent a second claim during emission preparation.
4. Reshape the initial creation form to the approved Avansat field groups.
5. Update browser fixtures and assertions for the new visible fields and removed controls.
6. Run targeted tests, the full suite, typecheck, build, and desktop/mobile browser checks.
7. Review the final changes and confirm that no RNDC operation ran.
