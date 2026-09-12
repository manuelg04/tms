import { notFound, redirect } from "next/navigation";
import { resolveDocumentSection } from "../../lib/document-workspace";
import { DocumentWorkspace } from "../document-workspace";

export default async function DocumentSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section: slug } = await params;
  if (["ordenes", "remesas", "manifiestos"].includes(slug))
    redirect(`/documentos/${slug}/listar`);
  const section = resolveDocumentSection(slug);
  if (!section || section.slug === "todos") notFound();
  return <DocumentWorkspace section={section} />;
}
