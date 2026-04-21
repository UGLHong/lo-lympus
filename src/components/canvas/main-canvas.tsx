'use client';

import {
  Building2,
  Code2,
  Gauge,
  GitBranch,
  History,
  PlayCircle,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { ProjectViewState } from '@/lib/client/project-store';
import { OfficeScene } from '@/components/office/office-scene';
import { WorkspaceView } from '@/components/workspace/workspace-view';
import { PipelineView } from '@/components/pipeline/pipeline-view';
import { RuntimeView } from '@/components/canvas/runtime-view';
import { ImplementView } from '@/components/canvas/implement-view';
import { LiveSourceView } from '@/components/canvas/live-source-view';
import { ReplayView } from '@/components/canvas/replay-view';
import { BudgetsView } from '@/components/canvas/budgets-view';

export type CanvasTab =
  | 'office'
  | 'workspace'
  | 'aiCode'
  | 'implement'
  | 'runtime'
  | 'pipeline'
  | 'replay'
  | 'budgets';

type Props = {
  view: ProjectViewState;
  tab: CanvasTab;
  onTabChange: (tab: CanvasTab) => void;
};

const TABS: { id: CanvasTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'office', label: 'Office', icon: Building2 },
  { id: 'workspace', label: 'Workspace', icon: Code2 },
  { id: 'aiCode', label: 'AI Code', icon: Sparkles },
  { id: 'implement', label: 'Implement', icon: Wrench },
  { id: 'runtime', label: 'App / Runtime', icon: PlayCircle },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch },
  { id: 'budgets', label: 'Budgets', icon: Gauge },
  { id: 'replay', label: 'Replay', icon: History },
];

export function MainCanvas({ view, tab, onTabChange }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 flex-shrink-0 items-center gap-1 border-b border-olympus-border bg-olympus-panel px-2">
        {TABS.map((t) => (
          <CanvasTabButton
            key={t.id}
            tab={t.id}
            active={tab === t.id}
            label={t.label}
            Icon={t.icon}
            onSelect={onTabChange}
          />
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'office' && <OfficeScene view={view} />}
        {tab === 'workspace' && <WorkspaceView view={view} />}
        {tab === 'aiCode' && <LiveSourceView view={view} />}
        {tab === 'implement' && <ImplementView view={view} />}
        {tab === 'runtime' && <RuntimeView view={view} />}
        {tab === 'pipeline' && <PipelineView view={view} />}
        {tab === 'budgets' && <BudgetsView view={view} />}
        {tab === 'replay' && <ReplayView view={view} />}
      </div>
    </div>
  );
}

type CanvasTabButtonProps = {
  tab: CanvasTab;
  active: boolean;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onSelect: (tab: CanvasTab) => void;
};

function CanvasTabButton({ tab, active, label, Icon, onSelect }: CanvasTabButtonProps) {
  const handleClick = () => onSelect(tab);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition',
        active
          ? 'bg-olympus-muted/70 text-olympus-ink'
          : 'text-olympus-dim hover:bg-olympus-muted/40 hover:text-olympus-ink',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
