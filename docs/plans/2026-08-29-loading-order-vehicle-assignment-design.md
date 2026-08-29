# Vehicle assignment in loading-order creation

## Goal

Let an operator assign a vehicle and driver while creating a loading order. The operator starts with the plate, the system uses existing fleet masters, and the saved dispatch opens with the same assignment already present in the later vehicle-and-driver stage.

The Avansat order `ODC-44579-JVK276.pdf` confirms that the printed vehicle section needs the vehicle plate, make, model, trailer, color, driver name, driver document, and phone. Those values already belong to the vehicle and driver masters and must not be copied into a separate untracked form record.

## Considered approaches

### 1. Reuse the existing assignment picker

Use the same plate search, linked-driver choices, and vehicle summary in both loading-order creation and the later assignment stage. The creation flow persists the chosen vehicle and driver on the dispatch.

This is the selected approach because both screens follow the same rules and future changes stay consistent.

### 2. Add two plain inputs to the creation form

Use a plate text box and a read-only conductor field. This looks closest to Avansat but becomes ambiguous when several drivers are linked to one vehicle and provides less protection against an invalid or stale assignment.

### 3. Duplicate the later assignment form

Copy its current behavior into the creation page. This is quicker initially but creates two separate implementations that can drift.

## User experience

The creation form keeps a compact `Datos del vehículo` section between recipient and cargo information. It contains:

- A plate search over the organization's existing vehicle master.
- A vehicle summary with make, line, model, trailer, color, configuration, capacity, status, and SOAT state when available.
- The linked conductor's name, document, phone, license category, and license expiration when available.
- A driver selector when the vehicle has several linked drivers.
- The existing `Flete conductor` money field.

When a selected vehicle has exactly one linked driver, the system selects that driver automatically. When it has several, the operator chooses one. When it has none, the operator may search the driver master explicitly, matching the existing assignment stage. Clearing or changing the vehicle clears any incompatible automatic driver choice.

## Data flow

The plate picker queries only the current organization's fleet master. The selected vehicle and driver IDs stay in the creation page state until the operator saves.

The save flow creates the draft dispatch, stores the loading-order draft including driver freight, and stores the selected vehicle and driver through the existing assignment operation. The dispatch remains a draft and no RNDC request is sent.

The later `Vehículo y conductor` stage reads the same dispatch assignment and remains available for corrections before document preparation or official emission.

## Validation and errors

- Vehicle and driver are required together for the initial assignment.
- An ID must still exist in the same organization when the assignment is saved.
- The UI shows a clear empty state when the plate is not in masters.
- Expired SOAT or license information remains visible as a warning rather than being silently hidden.
- A failed save keeps the form visible and reports a readable error.

## Verification

- Unit tests cover automatic driver selection, selection reset after a vehicle change, and validation of incomplete assignments.
- Browser coverage confirms the operator can select a plate, see the linked driver, save, and find the assignment on the created dispatch.
- The form is inspected at desktop and mobile widths.
- Typecheck, build, and the relevant test suite must pass.

