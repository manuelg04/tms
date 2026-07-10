import type { AuthConfig } from "convex/server";

const issuer = process.env.AUTH_JWT_ISSUER;
const jwks = process.env.CONVEX_AUTH_JWKS;
const audience = process.env.AUTH_JWT_AUDIENCE ?? "tms-demo";

export default {
  providers: issuer && jwks
    ? [{
        type: "customJwt",
        issuer,
        jwks,
        algorithm: "RS256",
        applicationID: audience
      }]
    : []
} satisfies AuthConfig;
