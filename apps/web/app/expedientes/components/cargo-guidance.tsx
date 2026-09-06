export const cargoHints = {
  weight: "Peso total en toneladas. Para 34 toneladas de gaseosa, escribe 34.",
  volume: "Volumen total de la carga embalada. Suma largo × ancho × alto de cada bulto, en metros. No se obtiene de las toneladas. Si no lo conoces, déjalo vacío.",
  quantity: "Número de unidades o bultos según el empaque. Ejemplo: si recibes 1.200 cajas, escribe 1200. No escribas 34 por ser 34 toneladas. Si no lo conoces, déjalo vacío."
};

export function CargoGuidance() {
  return <div className="cargo-guidance"><strong>¿Transportas 34 toneladas de gaseosa?</strong><p>En peso escribe 34. Consulta la remisión o al remitente para conocer el volumen y la cantidad de cajas, estibas u otros bultos. Las toneladas por sí solas no indican esos dos datos.</p></div>;
}
