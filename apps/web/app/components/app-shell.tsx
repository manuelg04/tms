"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { apiBase } from "../lib/labels";

type PageMeta = {
  title: string;
  subtitle: string;
};

const pageMeta: Record<string, PageMeta> = {
  "/": {
    title: "Panel de operacion",
    subtitle: "Estado en vivo de tus documentos RNDC"
  },
  "/operaciones": {
    title: "Operaciones RNDC",
    subtitle: "Emite ordenes de cargue, remesas y manifiestos"
  },
  "/documentos": {
    title: "Documentos",
    subtitle: "Historial completo emitido desde el TMS"
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
    href: "/operaciones",
    label: "Operaciones",
    icon: (
      <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M14.5 1.5 7 9M14.5 1.5l-4.5 13-2.5-5.5L2 6.5l12.5-5Z" strokeLinejoin="round" />
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
  }
];

type RndcMode = "dry-run" | "live" | "offline";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const meta = pageMeta[pathname] ?? pageMeta["/"];
  const unread = useQuery(api.notifications.unreadCount, {});
  const [mode, setMode] = useState<RndcMode>("offline");

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiBase}/health`)
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
  }, []);

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegacion principal">
        <div className="brand">
          <span className="brand-plate">MTM</span>
          <div className="brand-name">
            <strong>TMS RNDC</strong>
            <span>Transporte de carga</span>
          </div>
        </div>

        <nav className="nav">
          <span className="nav-label">Operacion</span>
          {navItems.map((item) => (
            <Link
              className={pathname === item.href ? "nav-item active" : "nav-item"}
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

      <div className="content">
        <header className="topbar">
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
          </div>
        </header>

        <main className="page">{children}</main>
      </div>
    </div>
  );
}
