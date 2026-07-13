export const volumeRoutes = [
  ["Bogotá", "Barranquilla"],
  ["Medellín", "Cartagena"],
  ["Cali", "Buenaventura"],
  ["Bucaramanga", "Santa Marta"],
  ["Pereira", "Bogotá"],
  ["Barranquilla", "Medellín"]
] as const;

export const volumeCustomers = ["Alimentos del Caribe", "Comercial Andina", "Café Nacional", "Industrias del Pacífico"] as const;
const statuses = ["draft", "ready", "in_progress", "completed"] as const;

export function syntheticDispatch(batchId: string, index: number, baseTimestamp: number) {
  const normalizedBatch = batchId.replace(/[^a-z0-9]/gi, "").toUpperCase() || "VOLUME";
  const [originCity, destinationCity] = volumeRoutes[index % volumeRoutes.length];
  const sequence = String(index).padStart(7, "0");
  const vehiclePlate = `VOL${String(index % 1_000).padStart(3, "0")}`;
  const customerName = volumeCustomers[index % volumeCustomers.length];
  const code = `VOL-${normalizedBatch}-${String(index).padStart(6, "0")}`;
  const updatedAt = baseTimestamp - index * 60_000;

  return {
    code,
    orderNumber: sequence,
    manifestNumber: sequence,
    originCity,
    destinationCity,
    customerName,
    vehiclePlate,
    driverName: `Conductor volumen ${index % 500}`,
    status: statuses[index % statuses.length],
    updatedAt,
    searchText: `${code} ${sequence} ${customerName} ${originCity} ${destinationCity} ${vehiclePlate} conductor volumen ${index % 500}`.toLocaleLowerCase("es")
  };
}
