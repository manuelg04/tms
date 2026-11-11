import assert from "node:assert/strict";
import test from "node:test";
import { currentManifestDocument } from "./currentManifest";

const annulled = { _id: "man-old", kind: "manifiesto", number: "0000040", updatedAt: 300 };
const remesa = { _id: "rem-1", kind: "remesa", number: "00053", updatedAt: 400 };

test("a dispatch without replacement keeps its latest manifest", () => {
  const older = { _id: "man-0", kind: "manifiesto", number: "0000039", updatedAt: 100 };
  assert.equal(currentManifestDocument({}, [older, annulled, remesa])?._id, "man-old");
});

test("the linked manifest wins over any other document", () => {
  const next = { _id: "man-new", kind: "manifiesto", number: "0000042", updatedAt: 200 };
  assert.equal(currentManifestDocument({ manifestDocumentId: "man-new" }, [annulled, next])?._id, "man-new");
});

test("a reopened dispatch ignores the manifest it replaces until the new one exists", () => {
  const reopened = { sourceManifestDocumentId: "man-old", manifestDraft: { manifestNumber: "0000042" } };
  assert.equal(currentManifestDocument(reopened, [annulled, remesa]), undefined);
  const next = { _id: "man-new", kind: "manifiesto", number: "0000042", updatedAt: 500 };
  assert.equal(currentManifestDocument(reopened, [annulled, next])?._id, "man-new");
});
