"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDemoUser } from "../providers";

type PageMeta = {
  title: string;
  subtitle: string;
};

const pageMeta: Record<string, PageMeta> = {
  "/": {
    title: "Panel de operacion",
    subtitle: "Estado en vivo de tus documentos RNDC"
  },
  "/expedientes": {
    title: "Despachos",
    subtitle: "Cola de trabajo, etapa actual y siguiente acción"
  },
  "/expedientes/nuevo": {
    title: "Nuevo despacho",
    subtitle: "Orden de cargue, remesas, flota, manifiesto y revisión"
  },
  "/operaciones": {
    title: "Operaciones RNDC",
    subtitle: "Consola tecnica de compatibilidad en modo de prueba"
  },
  "/documentos": {
    title: "Documentos",
    subtitle: "Historial completo emitido desde el TMS"
  },
  "/maestros": {
    title: "Maestros",
    subtitle: "Conductores y vehiculos del registro de flota"
  }
};

const navItems = [
  {
    href: "/",
    label: "Panel",
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <rect x="1.5" y="1.5" width="5.5" height="7" rx="1" />
        <rect x="9" y="1.5" width="5.5" height="4" rx="1" />
        <rect x="9" y="7.5" width="5.5" height="7" rx="1" />
        <rect x="1.5" y="10.5" width="5.5" height="4" rx="1" />
      </svg>
    )
  },
  {
    href: "/expedientes",
    label: "Despachos",
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M1.5 4.5h5l1.4 1.7h6.6v7.3h-13v-9Z" strokeLinejoin="round" />
        <path d="M3 4.5V2.3h4.8l1.2 1.5h4v2.4" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    href: "/documentos",
    label: "Documentos",
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M4 1.5h5.5L13 5v9.5H4v-13Z" strokeLinejoin="round" />
        <path d="M9.5 1.5V5H13M6 8h4.5M6 10.5h4.5" />
      </svg>
    )
  },
  {
    href: "/maestros",
    label: "Maestros",
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M5.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        <path d="M1.5 14c.4-2.4 1.8-4 4-4s3.6 1.6 4 4" strokeLinecap="round" />
        <path d="M10.5 5.5h2.2l1.8 2v3h-4V7M11 10.5h3.5M11.2 13.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM14.2 13.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
];

type RndcMode = "dry-run" | "live" | "offline";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { loading, user } = useDemoUser();
  const unread = useQuery(api.notifications.unreadCount, user ? {} : "skip");
  const [mode, setMode] = useState<RndcMode>("offline");
  const [navOpen, setNavOpen] = useState(false);
  const meta = resolvePageMeta(pathname);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/login" || !user) {
      return;
    }

    let cancelled = false;
    fetch("/api/rndc/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { mode?: RndcMode }) => {
        if (!cancelled && (body.mode === "dry-run" || body.mode === "live")) {
          setMode(body.mode);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMode("offline");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, user]);

  if (pathname === "/login") {
    return <main className="login-shell">{children}</main>;
  }

  if (loading) {
    return <div className="full-page-state">Validando sesion…</div>;
  }

  return (
    <div className="app">
      <aside className={navOpen ? "sidebar open" : "sidebar"} aria-label="Navegacion principal">
        <div className="brand">
          <span className="brand-plate">MTM</span>
          <div className="brand-name">
            <strong>TMS RNDC</strong>
            <span>Transporte de carga</span>
          </div>
          <button className="mobile-nav-close" aria-label="Cerrar menú" onClick={() => setNavOpen(false)} type="button">×</button>
        </div>

        <nav className="nav">
          <span className="nav-label">Operacion</span>
          {navItems.map((item) => (
            <Link
              className={isActivePath(pathname, item.href) ? "nav-item active" : "nav-item"}
              href={item.href}
              key={item.href}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">
          Vigilado SuperTransporte
          <br />
          RNDC · Ministerio de Transporte
        </div>
      </aside>
      {navOpen ? <button className="mobile-nav-backdrop" aria-label="Cerrar menú" onClick={() => setNavOpen(false)} type="button" /> : null}

      <div className="content">
        <header className="topbar">
          <button className="mobile-nav-trigger" aria-expanded={navOpen} aria-label="Abrir menú" onClick={() => setNavOpen(true)} type="button"><span /><span /><span /></button>
          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <p>{meta.subtitle}</p>
          </div>
          <div className="topbar-side">
            {unread !== undefined && unread > 0 ? (
              <Link className="notif-pill" href="/">
                Notificaciones <span className="count">{unread}</span>
              </Link>
            ) : null}
            <span className={mode === "live" ? "mode-chip live" : mode === "offline" ? "mode-chip offline" : "mode-chip"}>
              {mode === "live" ? "En vivo" : mode === "offline" ? "API sin conexion" : "Modo prueba"}
            </span>
            {user ? (
              <div className="user-menu">
                <span className="user-avatar" aria-hidden>{user.name.slice(0, 1)}</span>
                <span className="user-summary">
                  <strong>{user.name}</strong>
                  <small>{roleLabel(user.role)}</small>
                </span>
                <button className="user-logout" onClick={() => void logout()} type="button">
                  Salir
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}

function resolvePageMeta(pathname: string): PageMeta {
  if (pathname.startsWith("/expedientes/") && pathname !== "/expedientes/nuevo") {
    return {
      title: "Expediente de viaje",
      subtitle: "Orden, flota y documentos oficiales en un solo lugar"
    };
  }

  return pageMeta[pathname] ?? pageMeta["/"];
}

function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function roleLabel(role: "admin" | "operator" | "auditor"): string {
  return role === "admin" ? "Administrador" : role === "auditor" ? "Auditor" : "Operador";
}

async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/login");
}
