import type { RndcConfig } from "@tms/rndc-core";

const liveBlockedCommands = new Set([
  "flow",
  "mtm-prod-flow",
  "prepare-ops",
  "loading-order",
  "fulfill",
  "resend",
  "annul"
]);

export function assertLegacyCliCommandAllowed(config: Pick<RndcConfig, "mode">, command: string): void {
  if (config.mode === "live" && liveBlockedCommands.has(command)) {
    throw new Error(`RNDC CLI command ${command} is disabled in live mode; official writes require a durable request context`);
  }
}
