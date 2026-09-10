import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const mode = process.env.AUTH_MODE === "local" ? "local" : "demo";

  return (
    <Suspense fallback={<section className="login-card"><div className="skeleton">Preparando acceso…</div></section>}>
      <LoginForm mode={mode} />
    </Suspense>
  );
}
