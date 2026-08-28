import { execSync } from "node:child_process";

export default function globalTeardown() {
  if (process.env.E2E_KEEP_DATA) return;
  for (let round = 0; round < 10; round += 1) {
    const output = execSync("npx convex run maintenance:purgeTestDispatches '{\"limit\":50}'", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const remaining = /"remaining":\s*(\d+)/.exec(output);
    if (!remaining || Number(remaining[1]) === 0) break;
  }
}
