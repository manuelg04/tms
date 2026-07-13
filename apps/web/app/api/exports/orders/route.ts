import { GET as exportDispatches } from "../dispatches/route";

export async function GET(request: Request): Promise<Response> {
  return await exportDispatches(withKind(request, "orders"));
}

function withKind(request: Request, kind: string): Request {
  const url = new URL(request.url);
  url.searchParams.set("kind", kind);
  return new Request(url, request);
}
