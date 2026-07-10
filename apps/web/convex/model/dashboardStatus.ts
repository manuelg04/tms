export type DashboardStatus = "draft" | "pending" | "sent" | "authorized" | "rejected" | "fulfilled" | "annulled";

export function dashboardStatus(document: {
  status: string;
  officialState?: string;
  errorText?: string;
}): DashboardStatus {
  const status = document.officialState ?? document.status;

  if (status === "pending" && document.errorText) {
    return "rejected";
  }

  if (
    status === "draft"
    || status === "pending"
    || status === "sent"
    || status === "authorized"
    || status === "rejected"
    || status === "fulfilled"
    || status === "annulled"
  ) {
    return status;
  }

  return "pending";
}
