# Avansat Customer Ingestion Design

## Goal

Capture the complete customer master from the authenticated Avansat customer detail pages and load it safely into the configured Convex development environment.

## Source

The Avansat list contains 490 customers, while the downloaded list contains only the first 100 and omits fields available in each detail page. The detail view is the authoritative source for identification type, city, tax regime, economic activity, contacts, email, website, operational instructions, certification flags, and principal-site information.

## Extraction

Use the authenticated Chrome session to make the same read-only customer-detail request used by the Avansat interface. Enumerate every customer from the list pages, process sequentially with a modest delay, checkpoint progress, and record failures without guessing or silently skipping data.

Create a local evidence artifact containing the source fields, normalized values, capture time, source identifier, and content digest. No Convex write occurs until the complete artifact passes validation.

## Validation

Require 490 unique customer identifications, reconcile enabled and disabled totals against the Avansat list, reject conflicting duplicate identifications, validate required names and identification types, and report blank optional fields. Retry transient failures and stop if the source count changes during extraction.

## Storage

Store normalized operational fields in `customers` and the principal site in `customerLocations`. Use the customer identification as the stable customer code and natural key. Map Avansat enabled and disabled values to active and inactive. Preserve the complete original detail in a source snapshot linked to the customer so fields not used by the current workflow remain auditable.

## Ingestion Safety

Use a development-only, key-protected batch mutation. Upsert by organization and identification, stop on code or identification conflicts, preserve creation metadata, record updates separately from inserts, and write an import receipt with source digest and totals. Replaying an unchanged certified artifact must produce no inserts or updates.

## Verification

Run parser tests, type checking, the application test suite, and a dry run. After applying the import, read back all customers and locations by organization, compare them with the certified artifact, replay the same artifact, and confirm zero changes on replay.
