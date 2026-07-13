import { GET as exportDispatches } from "../dispatches/route";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.searchParams.set("kind", "manifests");
  return await exportDispatches(new Request(url, request));
}
