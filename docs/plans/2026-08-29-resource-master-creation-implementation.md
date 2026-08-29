# Resource master creation implementation plan

## Completion criteria

- Conductores, terceros, remolques, and vehículos each have a complete dedicated registration flow.
- The forms persist the Avansat-equivalent operational fields and optional photos.
- Relationships use existing same-organization masters and duplicate saves remain safe.
- Maestros lists and detail panels include trailers and newly captured information.
- Registration does not call the RNDC gateway.
- Automated tests, typecheck, build, and desktop/mobile browser checks pass.

## Tasks

1. Add failing model tests for the four normalized form contracts and run them to confirm the missing behavior.
2. Implement the pure normalization and validation helpers until those tests pass.
3. Extend the additive Convex schema, authenticated resource mutations, attachment flow, lookups, pagination, details, and organization-safe driver-vehicle relationships.
4. Add failing browser expectations for the four creation workspaces.
5. Replace the inline master forms with dedicated resource routes, responsive sections, searchable relationships, image selection, save feedback, and trailer list/detail support.
6. Push the schema only to the configured development deployment and verify representative save/read-back behavior there.
7. Run targeted tests, the full test suite, typecheck, build, and browser checks at desktop and mobile widths.
8. Inspect the final source changes and confirm official RNDC operations were not invoked.
