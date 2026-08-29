# Loading order creation parity with Avansat

## Goal

Make the new loading-order view use the same visible business fields as Avansat while keeping RNDC sending protected, traceable, and separate from form entry.

## Selected approach

The TMS will keep its current visual language and searchable master-data controls, but the visible form will follow the Avansat sections and field list. Fields that belong to later RNDC completion will no longer make the initial creation view longer.

The loading-order number will be reserved by the server when the form opens. The reservation is unique, belongs to the authenticated organization, is shown as a read-only value, and is consumed when the dispatch is created. Abandoned reservations remain traceable and are never reused.

This approach was selected over showing an estimated number or waiting until save because the operator must see the real number before entering the order and two operators must never receive the same number.

## Visible fields

The creation view will contain these Avansat-equivalent groups:

- Basic data: date, loading-order number, responsible agency, creates consignment, and client.
- Sender: name, identification type, identification number, address, city, telephone, and cellphone.
- Recipient: name, identification type, identification number, address, city, telephone, and cellphone.
- Vehicle: plate and driver freight.
- Merchandise: weight, volume, quantity, merchandise, packaging type, and optional field.
- Special observations: seals, loading conditions, special packaging, and observations.
- Loading dates: minimum and maximum date.

The visible service-order input, customer reference, customer code, RNDC site inputs, separate place and appointment blocks, driver selector, merchandise code, unit, and cargo-nature selector will be removed from this initial view. Data still required for an official RNDC send remains available in the independent document workflow and is not invented or silently defaulted.

## Data flow and safety

A reservation mutation atomically claims the next loading-order number and records the reservation token, organization, operator, number, status, and timestamps. Repeated calls with the same token return the same number.

When the operator saves, the reservation is validated and consumed in the same database transaction that creates the dispatch. The number is stored on the dispatch and loading-order draft from the beginning, so preparation for emission does not claim a second number.

The removed service-order code becomes an internal value derived from the reserved loading-order number. Party selections and the address and city fields persist the information entered without fabricating missing RNDC site codes or official catalog values. The vehicle can be selected at creation; a driver can be completed later if the selected vehicle does not already determine one.

Opening the form or saving a draft does not contact RNDC.

## Error handling

The form waits for a confirmed reservation before enabling save. Reservation failures show a plain Spanish error and allow a retry without producing a second number for the same form token.

Save rejects an unknown, already-used, or cross-organization reservation. Invalid loading dates, missing required Avansat fields, or unavailable master records preserve the form and show one clear error.

## Verification

- Model tests cover reservation idempotency and consumption rules.
- Browser coverage checks the exact visible field set, read-only consecutive, removed service-order field, successful creation, and no horizontal overflow.
- The form is inspected at desktop and mobile widths.
- The complete test suite, typecheck, and build pass.
