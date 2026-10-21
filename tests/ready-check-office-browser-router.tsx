export { Link, useNavigate, useRouterState } from './portal-browser-router-stub';
export function createFileRoute(_path: string) {
  return (options: { component: () => unknown }) => ({ options, useParams: () => ({ token: 'a'.repeat(64) }) });
}