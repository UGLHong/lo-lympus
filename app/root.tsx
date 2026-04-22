import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router';

import styles from './styles/tailwind.css?url';

import type { LinksFunction } from 'react-router';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: styles },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>L'Olympus — Virtual Software House</title>
        <Meta />
        <Links />
      </head>
      <body className="h-full bg-bg text-text">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Something broke';

  const detail =
    error instanceof Error ? error.message : 'Unknown error from the server.';

  return (
    <div className="min-h-full grid place-items-center p-8">
      <div className="max-w-xl panel p-6">
        <h1 className="text-lg font-semibold mb-2">{title}</h1>
        <pre className="text-xs text-text-muted whitespace-pre-wrap">
          {detail}
        </pre>
      </div>
    </div>
  );
}
