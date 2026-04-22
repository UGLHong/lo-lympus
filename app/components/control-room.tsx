import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';

import { DeleteProjectForm } from './delete-project-form';
import { Editor } from './editor';
import { OverseerChat } from './overseer-chat';
import { Kanban, type KanbanTask } from './kanban';
import { Office } from './office';
import { Terminal } from './terminal';
import { WorkspaceBrowser } from './workspace-browser';
import { LiveEventsProvider } from '../lib/live-events';
import { UiProvider } from '../lib/ui-context';
import { WorkspaceProvider } from '../lib/workspace-context';
import { cn } from '../lib/cn';

interface ControlRoomProps {
  project: { id: string; name: string; slug: string; brief: string };
  initialTasks: KanbanTask[];
}

type MainTab = 'office' | 'editor' | 'kanban';

export function ControlRoom({ project, initialTasks }: ControlRoomProps) {
  const [tab, setTab] = useState<MainTab>('kanban');

  const handleTabSwitch = useCallback((target: MainTab) => setTab(target), []);
  const handleFileOpened = useCallback(() => setTab('editor'), []);

  return (
    <LiveEventsProvider projectId={project.id}>
      <WorkspaceProvider projectId={project.id} onFileOpened={handleFileOpened}>
        <UiProvider>
          <ControlRoomInner
            project={project}
            initialTasks={initialTasks}
            tab={tab}
            onTabChange={handleTabSwitch}
          />
        </UiProvider>
      </WorkspaceProvider>
    </LiveEventsProvider>
  );
}

interface ControlRoomInnerProps extends ControlRoomProps {
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

// keep every tab mounted so live state (kanban sse updates, editor buffers,
// office canvas) isn't torn down when the user switches views. inactive panes
// are hidden via css rather than unmounted.
function TabPane({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={cn('absolute inset-0', active ? 'block' : 'hidden')}
      aria-hidden={active ? undefined : true}
    >
      {children}
    </div>
  );
}

function ControlRoomInner({ project, initialTasks, tab, onTabChange }: ControlRoomInnerProps) {
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);

  const handleTerminalCollapse = useCallback(() => {
    terminalPanelRef.current?.collapse();
    setTerminalCollapsed(true);
  }, []);

  const handleTerminalExpand = useCallback(() => {
    terminalPanelRef.current?.expand(22);
    setTerminalCollapsed(false);
  }, []);

  useLayoutEffect(() => {
    terminalPanelRef.current?.collapse();
    setTerminalCollapsed(true);
  }, []);

  useEffect(() => {
    document.title = `${project.name} · L'Olympus`;
  }, [project.name]);

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="h-10 border-b border-border flex items-center px-4 gap-3 text-xs">
        <Link
          to="/projects"
          className="font-semibold text-accent hover:text-accent/90 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-sm shrink-0"
        >
          L'Olympus
        </Link>
        <span className="text-text-faint">/</span>
        <span className="truncate">{project.name}</span>
        <span className="text-text-faint ml-auto shrink-0">slug: {project.slug}</span>
        <Link to="/settings" className="btn text-[10px]">
          Settings
        </Link>
        <DeleteProjectForm projectId={project.id} buttonLabel="Delete project" />
      </header>

      <div className="flex flex-col flex-1 min-h-0">
        <PanelGroup direction="vertical" className="flex-1 min-h-0">
          <Panel defaultSize={78} minSize={35}>
            <PanelGroup direction="horizontal" className="h-full">
              <Panel defaultSize={18} minSize={12} maxSize={35}>
                <div className="h-full panel m-1">
                  <WorkspaceBrowser projectId={project.id} />
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 hover:bg-accent/50 transition-colors" />
              <Panel defaultSize={55} minSize={30}>
                <div className="h-full flex flex-col m-1">
                  <div className="flex border border-border rounded-t bg-bg-raised">
                    {(['office', 'editor', 'kanban'] as MainTab[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onTabChange(id)}
                        className={cn(
                          'px-4 py-2 text-xs capitalize border-r border-border',
                          tab === id
                            ? 'bg-bg text-accent'
                            : 'text-text-muted hover:text-text',
                        )}
                      >
                        {id === 'office' ? 'Team Floor' : id}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 border border-t-0 border-border rounded-b bg-bg-raised min-h-0 relative">
                    <TabPane active={tab === 'office'}>
                      <Office projectId={project.id} />
                    </TabPane>
                    <TabPane active={tab === 'editor'}>
                      <Editor projectId={project.id} />
                    </TabPane>
                    <TabPane active={tab === 'kanban'}>
                      <Kanban projectId={project.id} initialTasks={initialTasks} />
                    </TabPane>
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle className="w-1 hover:bg-accent/50 transition-colors" />
              <Panel defaultSize={27} minSize={18} maxSize={45}>
                <div className="h-full panel m-1">
                  <OverseerChat projectId={project.id} />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="h-1 hover:bg-accent/50 transition-colors" />
          <Panel
            ref={terminalPanelRef}
            collapsible
            collapsedSize={0}
            defaultSize={22}
            minSize={8}
            maxSize={55}
            onCollapse={() => setTerminalCollapsed(true)}
            onExpand={() => setTerminalCollapsed(false)}
          >
            <div className="h-full panel m-1 min-h-0 flex flex-col">
              <Terminal projectId={project.id} onRequestCollapse={handleTerminalCollapse} />
            </div>
          </Panel>
        </PanelGroup>
        {terminalCollapsed && (
          <div className="shrink-0 flex items-center border-t border-border bg-bg-raised px-2 py-1.5">
            <button type="button" onClick={handleTerminalExpand} className="btn text-[10px]">
              Show terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
