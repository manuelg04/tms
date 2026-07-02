"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    if (!convexUrl) {
      return null;
    }

    return new ConvexReactClient(convexUrl);
  }, []);

  if (!client) {
    return (
      <div className="skeleton">
        Configura NEXT_PUBLIC_CONVEX_URL en apps/web/.env.local para conectar el panel.
      </div>
    );
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
