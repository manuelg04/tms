"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchConvexAccessToken, fetchDemoSession } from "./lib/auth-client";
import type { DemoUser } from "./lib/auth";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
type DemoAuthState = {
  user: DemoUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>;
};

const AuthContext = createContext<DemoAuthState | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const auth = useDemoAuth();
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

  return (
    <AuthContext.Provider value={auth}>
      <ConvexProviderWithAuth client={client} useAuth={useProvidedAuth}>
        {children}
      </ConvexProviderWithAuth>
    </AuthContext.Provider>
  );
}

export function useDemoUser(): { loading: boolean; user: DemoUser | null } {
  const auth = useContext(AuthContext);
  return { loading: auth?.isLoading ?? true, user: auth?.user ?? null };
}

function useDemoAuth() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<DemoUser | null>(null);

  useEffect(() => {
    let active = true;
    void fetchDemoSession().then((session) => {
      if (active) {
        setUser(session);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const fetchAccessToken = useCallback(async (_args: { forceRefreshToken: boolean }) => fetchConvexAccessToken(), []);

  return {
    user,
    isLoading: loading,
    isAuthenticated: user !== null,
    fetchAccessToken
  };
}

function useProvidedAuth() {
  const auth = useContext(AuthContext);

  if (!auth) {
    throw new Error("Authentication provider is unavailable");
  }

  return auth;
}
