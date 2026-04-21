'use client';

import { createContext, useContext, useMemo } from 'react';
import type { CanvasTab } from '@/components/canvas/main-canvas';

type ProjectNavigation = {
  activeTab: CanvasTab;
  openTab: (tab: CanvasTab) => void;
  activeArtifactPath: string | null;
  openArtifact: (relativePath: string) => void;
  openTicketByCode: (code: string) => void;
};

const ProjectNavigationContext = createContext<ProjectNavigation | null>(null);

type ProviderProps = {
  activeTab: CanvasTab;
  activeArtifactPath: string | null;
  onTabChange: (tab: CanvasTab) => void;
  onArtifactPathChange: (path: string | null) => void;
  children: React.ReactNode;
};

export function ProjectNavigationProvider({
  activeTab,
  activeArtifactPath,
  onTabChange,
  onArtifactPathChange,
  children,
}: ProviderProps) {
  const value = useMemo<ProjectNavigation>(
    () => ({
      activeTab,
      openTab: onTabChange,
      activeArtifactPath,
      openArtifact: (relativePath) => {
        onArtifactPathChange(normaliseArtifactPath(relativePath));
        onTabChange('workspace');
      },
      openTicketByCode: (code) => {
        onArtifactPathChange(`tickets/${code}`);
        onTabChange('workspace');
      },
    }),
    [activeTab, activeArtifactPath, onTabChange, onArtifactPathChange],
  );

  return (
    <ProjectNavigationContext.Provider value={value}>{children}</ProjectNavigationContext.Provider>
  );
}

export function useProjectNavigation(): ProjectNavigation {
  const ctx = useContext(ProjectNavigationContext);
  if (!ctx) throw new Error('useProjectNavigation must be used inside ProjectNavigationProvider');
  return ctx;
}

// paths under `.software-house/` match repo-relative paths for the workspace view.
function normaliseArtifactPath(input: string): string {
  const cleaned = input.replace(/^\/+/, '').replace(/\\+/g, '/');
  return cleaned.replace(/^\.software-house\//, '');
}
