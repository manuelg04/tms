import type { FormState, Operation } from "./operations-config";
import { counterFieldPath, countersForOperation, formatConsecutivo, parseConsecutivo, type CounterType } from "./consecutivos";
import { readPath, setPath } from "./form-state";

export async function reserveSuggestedCounters(input: {
  form: FormState;
  operation: Operation;
  suggestions: Partial<Record<CounterType, string>>;
  reserve: (type: CounterType) => Promise<number>;
  claim?: (type: CounterType, value: number) => Promise<number>;
}): Promise<FormState> {
  let payload = input.form;

  for (const type of countersForOperation(input.operation)) {
    const path = counterFieldPath[type];
    const suggestion = input.suggestions[type];

    const current = readPath(payload, path);

    if (suggestion !== undefined && current === suggestion) {
      const consumed = await input.reserve(type);
      payload = setPath(payload, path, formatConsecutivo(type, consumed));
      continue;
    }

    const manual = parseConsecutivo(current);

    if (manual === null) {
      throw new Error(`${type} consecutive must be numeric`);
    }

    if (!input.claim) {
      throw new Error(`${type} consecutive cannot be confirmed`);
    }

    const claimed = await input.claim(type, manual);
    payload = setPath(payload, path, formatConsecutivo(type, claimed));
  }

  return payload;
}
