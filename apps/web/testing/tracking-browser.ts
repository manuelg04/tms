import type { BrowserContext } from "@playwright/test";
import { makeFunctionReference } from "convex/server";
import { convexToJson, jsonToConvex, type JSONValue } from "convex/values";
import { trackingFixture } from "./tracking-fixtures";

type Query = {
  type: "Add";
  queryId: number;
  udfPath: string;
  args: JSONValue[];
};
type ClientMessage =
  | { type: "Connect" | "Event" }
  | { type: "Authenticate"; baseVersion: number }
  | {
      type: "ModifyQuerySet";
      newVersion: number;
      modifications: (Query | { type: "Remove"; queryId: number })[];
    }
  | { type: "Mutation"; requestId: number; udfPath: string; args: JSONValue[] };

export async function trackingBrowser(
  context: BrowserContext,
  role: "admin" | "operator" | "auditor" = "admin",
) {
  const fixture = await trackingFixture();
  const actor = fixture[role];
  const errors: string[] = [];
  const mutations: string[] = [];
  const epoch = Math.floor(Date.now() / 1000);
  const token = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: `tracking-${role}`, iat: epoch, exp: epoch + 3600 })).toString("base64url")}.test`;
  await context.addCookies([
    {
      name: "tms_session",
      value: "tracking-test",
      domain: "localhost",
      path: "/",
    },
  ]);
  await context.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: `tracking-${role}`,
          name: `${role} de prueba`,
          email: `${role}@test.invalid`,
          role,
        },
      },
    }),
  );
  await context.route("**/api/auth/token", (route) =>
    route.fulfill({ json: { token } }),
  );
  await context.route("**/api/rndc/**", (route) => {
    if (route.request().url().endsWith("/health"))
      return route.fulfill({ json: { mode: "dry-run" } });
    errors.push(`Unexpected RNDC request: ${route.request().url()}`);
    return route.abort();
  });
  await context.route("https://*.convex.cloud/**", (route) => {
    errors.push(`Unexpected remote database request: ${route.request().url()}`);
    return route.abort();
  });
  await context.routeWebSocket(/\/api\/.*\/sync/, (socket) => {
    let tick = BigInt(0);
    const timestamp = () => {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(tick);
      return buffer.toString("base64");
    };
    let version = { querySet: 0, identity: 0, ts: timestamp() };
    const queries = new Map<number, Query>();
    let chain = Promise.resolve();
    const transition = async (next = version) => {
      const modifications = [];
      for (const query of queries.values()) {
        try {
          if (
            query.udfPath !== "notifications:unreadCount" &&
            !query.udfPath.startsWith("tracking:")
          )
            throw new Error(`Unexpected query ${query.udfPath}`);
          const value =
            query.udfPath === "notifications:unreadCount"
              ? 0
              : await actor.query(
                  makeFunctionReference<"query">(query.udfPath),
                  jsonToConvex(query.args[0]) as Record<string, never>,
                );
          modifications.push({
            type: "QueryUpdated",
            queryId: query.queryId,
            value: convexToJson(value),
            logLines: [],
            journal: null,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push(message);
          modifications.push({
            type: "QueryFailed",
            queryId: query.queryId,
            errorMessage: message,
            logLines: [],
            journal: null,
          });
        }
      }
      tick++;
      const endVersion = { ...next, ts: timestamp() };
      socket.send(
        JSON.stringify({
          type: "Transition",
          startVersion: version,
          endVersion,
          modifications,
        }),
      );
      version = endVersion;
    };
    socket.onMessage((raw) => {
      chain = chain
        .then(async () => {
          const message = JSON.parse(String(raw)) as ClientMessage;
          if (message.type === "Authenticate")
            await transition({ ...version, identity: message.baseVersion + 1 });
          if (message.type === "ModifyQuerySet") {
            for (const change of message.modifications) {
              if (change.type === "Add") queries.set(change.queryId, change);
              else queries.delete(change.queryId);
            }
            await transition({ ...version, querySet: message.newVersion });
          }
          if (message.type === "Mutation") {
            try {
              if (!message.udfPath.startsWith("tracking:"))
                throw new Error(`Unexpected mutation ${message.udfPath}`);
              const result = await actor.mutation(
                makeFunctionReference<"mutation">(message.udfPath),
                jsonToConvex(message.args[0]) as Record<string, never>,
              );
              mutations.push(message.udfPath);
              tick++;
              socket.send(
                JSON.stringify({
                  type: "MutationResponse",
                  requestId: message.requestId,
                  success: true,
                  result: convexToJson(result),
                  ts: timestamp(),
                  logLines: [],
                }),
              );
              await transition();
            } catch (error) {
              socket.send(
                JSON.stringify({
                  type: "MutationResponse",
                  requestId: message.requestId,
                  success: false,
                  result:
                    error instanceof Error ? error.message : String(error),
                  logLines: [],
                }),
              );
            }
          }
        })
        .catch((error) => errors.push(String(error)))
        .then(() => undefined);
    });
  });
  return { ...fixture, errors, mutations };
}
