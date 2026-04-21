'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ProjectActions, ProjectViewState } from '@/lib/client/project-store';
import { useProjectNavigation } from '@/components/layout/project-navigation';
import { MessageList } from './message-list';

type ChatActions = ProjectActions;

type Props = {
  view: ProjectViewState;
  actions: ChatActions;
};

export function ChatPanel({ view, actions }: Props) {
  const { openTab } = useProjectNavigation();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const handleOpenBudgets = useCallback(() => {
    openTab('budgets');
  }, [openTab]);

  const anyStreaming = useMemo(
    () => Object.keys(view.pendingTokens).length > 0,
    [view.pendingTokens],
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setInput('');
    try {
      await actions.sendMessage(text);
    } finally {
      setSending(false);
    }
  }, [actions, input]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-olympus-border px-4 py-2 text-xs uppercase tracking-wider text-olympus-dim">
        <span className="h-1.5 w-1.5 rounded-full bg-olympus-accent" />
        Master thread · Orchestrator
        {anyStreaming && <span className="ml-auto text-olympus-blue">streaming…</span>}
      </div>

      <MessageList view={view} actions={actions} />

      <div className="border-t border-olympus-border p-3">
        <div className="rounded-lg border border-olympus-border bg-olympus-bg/60 focus-within:border-olympus-accent/60">
          <textarea
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="Message the Orchestrator… (Enter to send, Shift+Enter newline)"
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm text-olympus-ink outline-none placeholder:text-olympus-dim"
          />
          <div className="flex items-center justify-between border-t border-olympus-border/60 px-3 py-2">
            <span className="text-[11px] text-olympus-dim">
              Tokens {view.state.budgets.tokensUsed.toLocaleString()} /{' '}
              {view.state.budgets.tokensHard.toLocaleString()}
              {' · '}
              <button
                type="button"
                onClick={handleOpenBudgets}
                className="text-olympus-accent hover:underline"
              >
                Budgets
              </button>{' '}
              for caps and limits
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="rounded-md bg-olympus-accent px-3 py-1 text-xs font-medium text-olympus-bg disabled:opacity-50"
            >
              {sending ? 'sending…' : 'send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
