import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface UiContextValue {
  followRole: string | null;
  setFollowRole: (role: string | null) => void;
  watchStatus: string | null;
  setWatchStatus: (status: string | null) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

interface UiProviderProps {
  children: ReactNode;
}

export function UiProvider({ children }: UiProviderProps) {
  const [followRole, setFollowRole] = useState<string | null>(null);
  const [watchStatus, setWatchStatus] = useState<string | null>(null);

  const value = useMemo<UiContextValue>(
    () => ({ followRole, setFollowRole, watchStatus, setWatchStatus }),
    [followRole, watchStatus],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used within UiProvider');
  return ctx;
}
