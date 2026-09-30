import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DocumentRegistry } from "../../document-registry";
import { registryModules, type RegistryAction } from "../../registry-config";

export const dynamicParams = false;

export function generateStaticParams() {
  return registryModules.flatMap((module) =>
    module.actions.map((action) => ({ section: module.slug, action })),
  );
}

export default async function DocumentActionPage({
  params,
}: {
  params: Promise<{ section: string; action: string }>;
}) {
  const { section, action } = await params;
  const module = registryModules.find((item) => item.slug === section);
  if (!module || !module.actions.includes(action as RegistryAction)) notFound();
  return (
    <Suspense fallback={<div className="skeleton">Cargando documentos…</div>}>
      <DocumentRegistry
        action={action as RegistryAction}
        key={`${section}/${action}`}
        module={module}
      />
    </Suspense>
  );
}
