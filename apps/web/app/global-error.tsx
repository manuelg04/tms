"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#eef1f4", color: "#1b2734", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>El TMS no pudo iniciar</h1>
          <p>Revisa tu conexión y vuelve a intentarlo.</p>
          <button onClick={reset} style={{ padding: "10px 18px", border: 0, borderRadius: 6, background: "#ffc72c", fontWeight: 700, cursor: "pointer" }} type="button">Volver a intentar</button>
        </main>
      </body>
    </html>
  );
}
