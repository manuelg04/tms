import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDossierSearchText,
  formatStudyCode,
  initialChecks,
  missingRequiredDocuments,
  normalizeDocument,
  studyProgress,
  summarizeStudyForDriver,
  validateDecision,
  validateDossierInput,
} from "./securityStudies";

describe("security studies model", () => {
  it("formats codes and normalizes documents", () => {
    assert.equal(formatStudyCode(7), "ES-00007");
    assert.equal(normalizeDocument("91.276.540"), "91276540");
    assert.match(buildDossierSearchText({ document: "91.276.540", name: "Jorge Villamizar" }), /91276540/);
    assert.match(buildDossierSearchText({ document: "91.276.540", name: "Jorge Villamizar" }), /villamizar/);
  });

  it("validates dossier input", () => {
    assert.doesNotThrow(() => validateDossierInput({ document: "91276540", name: "Jorge Villamizar", phone: "3104527781" }));
    assert.throws(() => validateDossierInput({ document: "12", name: "Jorge Villamizar" }), /documento/);
    assert.throws(() => validateDossierInput({ document: "91276540", name: "Jo" }), /nombre/);
    assert.throws(() => validateDossierInput({ document: "91276540", name: "Jorge Villamizar", phone: "12" }), /celular/);
  });

  it("requires a reason to reject and all checks to approve", () => {
    const checks = initialChecks();
    assert.throws(() => validateDecision({ outcome: "rechazado", reason: "no", checks }), /motivo/);
    assert.throws(() => validateDecision({ outcome: "aprobado", reason: "", checks }), /consulta/);
    const done = checks.map((c) => ({ ...c, result: "sin_novedad" as const }));
    assert.doesNotThrow(() => validateDecision({ outcome: "aprobado", reason: "", checks: done }));
    assert.doesNotThrow(() => validateDecision({ outcome: "rechazado", reason: "Antecedente por homicidio vigente en Policía.", checks }));
  });

  it("reports progress and missing required documents", () => {
    const checks = initialChecks();
    checks[0].result = "con_hallazgo";
    checks[1].result = "sin_novedad";
    assert.deepEqual(studyProgress({ checks }), { done: 2, total: checks.length, findings: 1 });
    assert.deepEqual(missingRequiredDocuments([{ kind: "Hoja de vida" }]), ["Cédula de ciudadanía", "Licencia de conducción"]);
  });

  it("summarizes a driver's studies by state", () => {
    const now = 1_000_000;
    const summary = summarizeStudyForDriver(
      [
        { status: "aprobado", customer: "A", validUntil: now + 10 },
        { status: "aprobado", customer: "B", validUntil: now - 10 },
        { status: "rechazado", customer: "C" },
        { status: "en_estudio", customer: "D" },
      ],
      now,
    );
    assert.equal(summary.approved.length, 1);
    assert.equal(summary.rejected.length, 1);
    assert.equal(summary.open.length, 1);
  });
});
