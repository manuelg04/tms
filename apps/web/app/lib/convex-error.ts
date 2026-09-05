import { ConvexError } from "convex/values";

export function convexErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data && typeof data.message === "string") return data.message;
  }
  if (error instanceof Error) {
    const match = /(?:ConvexError|Error): (.*)$/m.exec(error.message);
    return match ? match[1] : error.message;
  }
  return fallback;
}
