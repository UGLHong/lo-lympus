"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { ProjectState } from "@/lib/schemas/state";
import type { Message } from "@/lib/schemas/messages";
import { useProjectStore } from "@/lib/client/project-store";
import { ChatPanel } from "@/components/chat/chat-panel";
import { MainCanvas, type CanvasTab } from "@/components/canvas/main-canvas";
import { ContextRail } from "@/components/rail/context-rail";
import { OpenInZedButton } from "@/components/project/open-in-zed-button";
import { AutoTicker } from "@/components/project/auto-ticker";
import { HelpNeededBanner } from "@/components/project/help-needed-banner";
import { ProjectNavigationProvider } from "./project-navigation";

type Props = {
  initialState: ProjectState;
  initialMessages: Message[];
};

export function ProjectShell({ initialState, initialMessages }: Props) {
  const [view, actions] = useProjectStore(initialState, initialMessages);
  const [tab, setTab] = useState<CanvasTab>("office");
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <ProjectNavigationProvider
      activeTab={tab}
      activeArtifactPath={artifactPath}
      onTabChange={setTab}
      onArtifactPathChange={setArtifactPath}
    >
      <AutoTicker view={view} />
      <div className="grid h-full w-full grid-cols-[360px_minmax(0,1fr)_320px] grid-rows-[44px_auto_minmax(0,1fr)] bg-olympus-bg text-olympus-ink">
        <header className="col-span-3 flex items-center justify-between border-b border-olympus-border bg-olympus-panel px-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-olympus-dim hover:text-olympus-ink"
            >
              <span className="h-5 w-5 rounded bg-gradient-to-br from-olympus-accent to-olympus-amber" />
              Olympus
            </Link>
            <span className="text-olympus-dim">/</span>
            <span className="truncate text-sm font-medium">
              {view.state.name}
            </span>
            <span className="ml-2 rounded bg-olympus-muted px-2 py-0.5 text-xs text-olympus-dim">
              {view.state.phase}
            </span>
            {view.state.paused && (
              <span className="rounded bg-olympus-amber/20 px-2 py-0.5 text-xs text-olympus-amber">
                paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-olympus-dim">
            <OpenInZedButton projectId={view.state.projectId} />
            {isMounted && <ConnectionDot connected={view.connected} />}
            {isMounted && <span>{view.connected ? "live" : "reconnecting…"}</span>}
          </div>
        </header>

        <HelpNeededBanner view={view} />

        <aside className="min-h-0 border-r border-olympus-border bg-olympus-panel">
          <ChatPanel view={view} actions={actions} />
        </aside>

        <section className="min-h-0 min-w-0">
          <MainCanvas view={view} tab={tab} onTabChange={setTab} />
        </section>

        <aside className="min-h-0 border-l border-olympus-border bg-olympus-panel">
          <ContextRail view={view} />
        </aside>
      </div>
    </ProjectNavigationProvider>
  );
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        connected ? "bg-olympus-green animate-pulse-dot" : "bg-olympus-red"
      }`}
    />
  );
}
