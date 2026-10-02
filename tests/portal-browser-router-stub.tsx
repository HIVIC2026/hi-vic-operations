import type { AnchorHTMLAttributes, ReactNode } from "react";
export function Link({ children, params, search, to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; params?: Record<string, string>; search?: unknown; to?: string }) {
  const href = params?.jobId ? `/admin/jobs/${params.jobId}` : to ?? "#";
  return <a {...props} href={href}>{children}</a>;
}