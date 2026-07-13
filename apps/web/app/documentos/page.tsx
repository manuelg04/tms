import { resolveDocumentSection } from "../lib/document-workspace";
import { DocumentWorkspace } from "./document-workspace";

export default function DocumentosPage() {
  return <DocumentWorkspace section={resolveDocumentSection("todos")!} />;
}
