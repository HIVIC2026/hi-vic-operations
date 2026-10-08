import type { AnchorHTMLAttributes, ReactNode } from "react";
export function Link({ children, params, search, to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode; params?: Record<string, string>; search?: unknown; to?: string }) {
  const href = params?.jobId ? `/admin/jobs/${params.jobId}` : to ?? "#";
  const nav = (globalThis as { __stubNavigate?: (o: unknown) => void }).__stubNavigate;
  if (nav && search) return <a {...props} href={href} onClick={(e) => { e.preventDefault(); nav({ to, search }); }}>{children}</a>;
  return <a {...props} href={href}>{children}</a>;
}
export const useNavigate = () => (o: unknown) => (globalThis as { __stubNavigate?: (o: unknown) => void }).__stubNavigate?.(o);
