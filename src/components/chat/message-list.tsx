'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { AnswerSubmission, ProjectViewState } from '@/lib/client/project-store';
import { MessageBubble } from './message-bubble';

type Props = {
  view: ProjectViewState;
  actions: {
    submitAnswers: (answers: AnswerSubmission[]) => Promise<void>;
  };
};

const STICK_TO_BOTTOM_THRESHOLD = 96;

export function MessageList({ view, actions }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickRef = useRef(true);
  const lastMessageCountRef = useRef(view.messages.length);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldStickRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD;
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const messageCount = view.messages.length;
    const newMessageArrived = messageCount > lastMessageCountRef.current;
    lastMessageCountRef.current = messageCount;

    const latestMessage = view.messages[messageCount - 1];
    const latestIsHuman = latestMessage?.author.kind === 'human';

    if (newMessageArrived && latestIsHuman) {
      node.scrollTop = node.scrollHeight;
      shouldStickRef.current = true;
      return;
    }

    if (shouldStickRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [view.messages, view.pendingTokens]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    shouldStickRef.current = true;
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 space-y-3 overflow-y-auto px-3 py-4"
    >
      {view.messages.length === 0 && (
        <div className="rounded-md border border-dashed border-olympus-border p-4 text-sm text-olympus-dim">
          The Orchestrator will reply shortly. If nothing appears within ~30s, check the terminal for errors (most
          likely the OpenRouter API key).
        </div>
      )}
      {view.messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          streamingText={view.pendingTokens[message.id]}
          onSubmitAnswers={actions.submitAnswers}
        />
      ))}
    </div>
  );
}
