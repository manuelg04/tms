import { notFound } from "next/navigation";
import { resolveDocumentSection } from "../../lib/document-workspace";
import { DocumentWorkspace } from "../document-workspace";

export default async function DocumentSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params;
  const section = resolveDocumentSection(slug);
  if (!section || section.slug === "todos") notFound();
  return <DocumentWorkspace section={section} />;
}
