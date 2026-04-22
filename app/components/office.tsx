import { lazy, Suspense, useEffect, useState } from 'react';

interface OfficeProps {
  projectId: string;
}

const OfficeClient = lazy(() => import('./office.client'));

export function Office({ projectId }: OfficeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="h-full grid place-items-center text-xs text-text-faint">
        booting team floor…
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="h-full grid place-items-center text-xs text-text-faint">
          loading team…
        </div>
      }
    >
      <OfficeClient projectId={projectId} />
    </Suspense>
  );
}
