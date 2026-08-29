# Resource master creation

## Goal

Allow an operator to register drivers, third parties, trailers, and vehicles from the TMS with the business information visible in Avansat, while reusing the TMS data already loaded from RNDC and keeping official RNDC actions separate.

## Considered approaches

### 1. Dedicated creation workspace

Keep the master lists compact and open a dedicated route for each resource. Each form uses clear sections, a sticky completion summary, searchable relationships, and one final save action.

This is the selected approach because the Avansat forms contain many fields and would make the current master list difficult to scan if they expanded inline. It also works cleanly on mobile and gives every resource a stable URL.

### 2. Expand the current inline forms

This would require fewer route changes, but a vehicle or driver form would push the list far below the fold and mix registration with browsing.

### 3. Multi-step modal wizard

This would keep each screen short, but it would hide context, add navigation overhead, and make cross-checking technical and insurance data harder.

## User experience

The Maestros page will show four resource cards and four tabs: Conductores, Terceros, Remolques, and Vehículos. Each registration button opens a dedicated workspace that preserves the current industrial MTM visual language.

The forms group information by business purpose:

- Driver: identity, contact, license, social security, complementary information, emergency contact, work references, activities, observations, and optional profile photo.
- Third party: natural or legal identity, contact and tax data, multiple activities, and observations.
- Trailer: identification, technical dimensions, ownership, bodywork, optional usual vehicle, observations, and optional photo.
- Vehicle: identification and technical data, SOAT and liability insurance, owner, possessor, driver, optional default trailer, Ministry of Transport data, GPS operator metadata, observations, and optional exterior photos.

Required fields follow the Avansat screenshots when they are still meaningful in the TMS. Optional historical or administrative fields remain available without blocking registration. Searchable RNDC and TMS selectors replace free-text duplication for municipalities, insurers, third parties, drivers, trailers, vehicle lines, and body types.

## Data and safety

Every browser mutation derives the organization from the authenticated user. Natural keys remain document number for drivers and third parties, and plate for vehicles and trailers. Saving the same normalized record is idempotent; conflicting existing information is not silently duplicated.

Driver registration also keeps its third-party identity synchronized with the `driver` role plus any owner, possessor, or employee activities selected by the operator. Third-party activities are additive so one save does not erase an existing operational role.

Vehicle relationships reference existing same-organization records. Driver-vehicle links are resolved through the actual record IDs so a matching document and plate in another organization cannot be changed accidentally.

Photos use authenticated Convex upload URLs, accept JPEG, PNG, or WebP, and are limited to 2 MB each. The database keeps the storage ID and file metadata with the master record. GPS passwords are deliberately excluded because the TMS must not store them as plain text.

Creating a master never sends an official or simulated RNDC operation. RNDC registration remains a separate protected action.

## Error handling

Validation happens before file upload and again inside the database mutation. Invalid dates, malformed plates, non-positive weights or dimensions, missing relationships, cross-organization references, unsupported images, and oversized images produce plain Spanish messages while preserving the form state.

The submit action is guarded while saving. A successful save shows whether the master was created, enriched, or already unchanged and provides a direct return to the corresponding list.

## Verification

- Pure tests cover normalization, conditional natural/legal fields, dates, plates, weights, dimensions, role merging, and GPS-secret exclusion.
- Browser coverage checks that all four workspaces expose the expected sections and remain usable at desktop and mobile widths.
- Development verification saves representative records and reads them back from the list and detail views without triggering RNDC.
- The full test suite, typecheck, and build must pass.
