# Vehicle assignment in loading-order creation implementation plan

## Completion criteria

- The loading-order creation form includes plate lookup, vehicle details, linked-driver behavior, and driver freight.
- One linked driver is selected automatically and several linked drivers require an operator choice.
- Saving the form persists the vehicle and driver on the new dispatch.
- The later assignment stage shows the same saved selection and can edit it.
- No RNDC operation is triggered.
- Automated tests, typecheck, build, and desktop/mobile browser checks pass.

## Tasks

1. Extract the existing vehicle and driver selection behavior into a reusable component without changing the later assignment stage.
2. Add unit tests for the selection-state rules and run them once to prove they fail before implementation.
3. Implement the selection-state helper and reusable picker until the unit tests pass.
4. Place the picker in the loading-order creation form and include the selected IDs in the save flow.
5. Extend the guided-dispatch browser test to cover creation-time assignment and run it once to prove the new expectation fails before implementation.
6. Make the smallest persistence and UI changes needed for the browser test to pass.
7. Run relevant tests, the full test suite, typecheck, and build.
8. Run the web app and inspect the creation flow at desktop and mobile widths, including one-driver and invalid-plate states.
9. Review the final diff and confirm unrelated local files remain untouched.
