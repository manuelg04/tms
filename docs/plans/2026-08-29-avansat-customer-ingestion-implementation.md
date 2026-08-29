# Avansat Customer Ingestion Implementation Plan

1. Add failing parser and certification tests for Avansat list and detail fields, duplicate detection, status mapping, and stable digests.
2. Implement the pure parser, normalizer, certification, and comparison helpers.
3. Extend the Convex customer model with typed source snapshots and import receipts.
4. Add a development-only customer batch upsert and read-back query guarded by the existing ingestion key.
5. Add a CLI that defaults to dry run, requires an explicit apply flag, batches writes, records evidence, and verifies replay safety.
6. Extract all Avansat customer details through the authenticated Chrome session into a checkpointed local artifact.
7. Certify the artifact, run the dry run, apply it to Convex development, read it back, replay it, and run the required project checks.
