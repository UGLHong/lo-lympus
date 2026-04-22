import {
  AlertCircle,
  Braces,
  CheckCircle2,
  Database,
  FileCode2,
  Globe,
  MessageSquareText,
  PlayCircle,
  Sparkles,
  Terminal as TerminalIcon,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTaskActivity, type ActivityItem } from '@/hooks/use-task-activity';
import { ROLE_COLOR, ROLE_LABEL, isRole, type Role } from '@/lib/roles';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/cn';

interface TaskChatProps {
  projectId: string;
  taskId: string;
  taskCode: string;
  taskRole: string;
  taskStatus: string;
}

type ChatItem = Extract<ActivityItem, { kind: 'chat' }>;
type PendingQuestion = ChatItem & { direction: 'to-human' };

function findLatestQuestion(items: ActivityItem[]): PendingQuestion | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind !== 'chat') continue;
    if (item.direction === 'from-human') return null;
    if (item.direction === 'to-human') return item as PendingQuestion;
  }
  return null;
}

// derive a human-friendly label from the freshest unresolved signal so the
// working indicator shows what the agent is actually doing right now.
function deriveWorkingHint(items: ActivityItem[]): string {
  let hint = 'working';
  let agentPending = 0;
  let toolPending: { verb: string; target?: string } | null = null;
  for (const item of items) {
    if (item.kind === 'tool' && item.toolKind === 'agent') {
      if (item.action === 'generate.start') agentPending += 1;
      else if (item.action === 'generate.end' || item.action === 'generate.error') {
        agentPending = Math.max(0, agentPending - 1);
      }
    }
    if (item.kind === 'tool' && item.toolKind !== 'agent') {
      if (item.action.endsWith('.start')) {
        toolPending = {
          verb: `${item.toolKind} ${item.action.replace(/\.start$/, '')}`,
          target: item.path ?? item.url,
        };
      } else if (
        toolPending &&
        (item.action.endsWith('.end') || item.action.endsWith('.done') || item.action.endsWith('.error'))
      ) {
        toolPending = null;
      }
    }
    if (item.kind === 'state' && item.status === 'thinking') {
      hint = item.note ? `thinking about ${item.note}` : 'thinking';
    }
  }
  if (toolPending) {
    return toolPending.target ? `${toolPending.verb} ${toolPending.target}` : toolPending.verb;
  }
  if (agentPending > 0) return 'thinking';
  return hint;
}

export function TaskChat({
  projectId,
  taskId,
  taskCode,
  taskRole,
  taskStatus,
}: TaskChatProps) {
  const { items, status, ingestLocal } = useTaskActivity(taskId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const questionRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastQuestionIdRef = useRef<string | null>(null);
  const { openFile } = useWorkspace();

  const pendingQuestion = useMemo(() => findLatestQuestion(items), [items]);
  const isBlocked = taskStatus === 'blocked-needs-input';
  const isWorking = taskStatus === 'in-progress';
  const workingHint = useMemo(() => deriveWorkingHint(items), [items]);
  const isEmpty = items.length === 0;

  const pendingQuestionId = pendingQuestion?.id ?? null;

  useEffect(() => {
    if (!pendingQuestionId) {
      lastQuestionIdRef.current = null;
      return;
    }
    if (lastQuestionIdRef.current === pendingQuestionId) return;
    lastQuestionIdRef.current = pendingQuestionId;
    questionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (document.activeElement === document.body) {
      inputRef.current?.focus();
    }
  }, [pendingQuestionId]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (document.activeElement === inputRef.current) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [items]);

  const handleOpenFile = useCallback(
    (path: string) => {
      void openFile(path);
    },
    [openFile],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setDraft('');

      const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ingestLocal({
        kind: 'chat',
        id: localId,
        role: 'human',
        direction: 'from-human',
        text: trimmed,
        at: Date.now(),
      });

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            role: taskRole,
            taskId,
            message: trimmed,
            scope: 'task',
            localId,
          }),
        });
        if (!res.ok) {
          ingestLocal({
            kind: 'chat',
            id: `error-${Date.now()}`,
            role: 'system',
            direction: 'from-agent',
            text: `Failed to send message (${res.status} ${res.statusText}). Check server logs.`,
            at: Date.now(),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        ingestLocal({
          kind: 'chat',
          id: `error-${Date.now()}`,
          role: 'system',
          direction: 'from-agent',
          text: `Error sending message: ${message}.`,
          at: Date.now(),
        });
      } finally {
        setSending(false);
      }
    },
    [projectId, taskId, taskRole, sending, ingestLocal],
  );

  const handleDraftChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    [],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void sendMessage(draft);
    },
    [draft, sendMessage],
  );

  const placeholder = pendingQuestion
    ? 'type a freeform answer or pick an option above'
    : isBlocked
      ? 'provide input to unblock the task'
      : 'reply / add note';

  return (
    <div className="h-full flex flex-col bg-bg-raised min-h-0">
      <div className="panel-header shrink-0 border-t-0 border-x-0 rounded-none">
        <span className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-accent" />
          <span>AI activity</span>
          <span className="inline-flex items-center rounded border border-border bg-bg-sunken/70 px-1 font-mono text-[10px] text-text-muted">
            {taskCode}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <ConnectionBadge status={status} />
          <span className={cn('text-[10px]', isBlocked ? 'text-yellow-300' : 'text-text-faint')}>
            {taskStatus}
          </span>
        </span>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1.5 text-xs"
      >
        {isEmpty && status === 'live' && (
          <div className="text-text-faint italic">
            no activity yet — streamed logs and questions will appear here.
          </div>
        )}
        {isEmpty && status !== 'live' && (
          <div className="text-text-faint italic">connecting to live activity…</div>
        )}
        {items.map((item) => {
          const isActiveQuestion =
            item.kind === 'chat' &&
            item.direction === 'to-human' &&
            pendingQuestion?.id === item.id;
          return (
            <FeedRow
              key={item.id}
              item={item}
              onOpenFile={handleOpenFile}
              onOptionClick={sendMessage}
              highlightRef={isActiveQuestion ? questionRef : undefined}
              isActiveQuestion={isActiveQuestion}
            />
          );
        })}
        {isWorking && <WorkingIndicator hint={workingHint} />}
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn(
          'border-t border-border p-2 flex gap-2 shrink-0',
          isBlocked && 'attention-glow border-t-yellow-400',
        )}
      >
        <input
          ref={inputRef}
          type="text"
          name="task-chat-reply"
          value={draft}
          onChange={handleDraftChange}
          placeholder={placeholder}
          disabled={sending}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-bg-sunken border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || draft.trim().length === 0}>
          Send
        </button>
      </form>
    </div>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
        live
      </span>
    );
  }
  if (status === 'reconnecting') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-300/80">
        <WifiOff size={10} />
        reconnecting
      </span>
    );
  }
  if (status === 'closed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-faint">
        <WifiOff size={10} />
        closed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-faint">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-text-faint animate-pulse" />
      {status === 'replaying' ? 'loading history' : 'connecting'}
    </span>
  );
}

function FeedRow({
  item,
  onOpenFile,
  onOptionClick,
  highlightRef,
  isActiveQuestion,
}: {
  item: ActivityItem;
  onOpenFile: (path: string) => void;
  onOptionClick: (option: string) => Promise<void>;
  highlightRef?: React.RefObject<HTMLDivElement | null>;
  isActiveQuestion?: boolean;
}) {
  if (item.kind === 'chat') {
    return (
      <ChatBubble
        item={item}
        onOptionClick={onOptionClick}
        highlightRef={highlightRef}
        isActiveQuestion={isActiveQuestion}
      />
    );
  }
  if (item.kind === 'tool') {
    return <ToolRow item={item} onOpenFile={onOpenFile} />;
  }
  if (item.kind === 'token-stream') {
    return <TokenStreamRow item={item} />;
  }
  return <InlineEvent item={item} onOpenFile={onOpenFile} />;
}

function TokenStreamRow({ item }: { item: Extract<ActivityItem, { kind: 'token-stream' }> }) {
  const role = item.role ?? 'agent';
  const color = isRole(role) ? ROLE_COLOR[role as Role] : '#f59e0b';
  const label = isRole(role) ? ROLE_LABEL[role as Role] : role;
  const isReasoning = item.streamKind === 'reasoning';
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[90%] rounded px-2 py-1.5 border bg-bg-sunken/70 border-border/60',
          !item.done && 'attention-glow',
        )}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint mb-0.5">
          <Sparkles size={10} className={cn('text-accent', !item.done && 'animate-pulse')} />
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span>{label}</span>
          <span className="ml-1 uppercase tracking-wider text-[9px] text-text-faint">
            {isReasoning ? 'reasoning' : 'thinking'}
          </span>
          {!item.done && <span className="text-accent">· live</span>}
        </div>
        <div
          className={cn(
            'whitespace-pre-wrap break-words text-text',
            isReasoning && 'italic text-text-muted',
          )}
        >
          {item.text || (item.done ? '' : '…')}
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  item,
  onOptionClick,
  highlightRef,
  isActiveQuestion,
}: {
  item: ChatItem;
  onOptionClick: (option: string) => Promise<void>;
  highlightRef?: React.RefObject<HTMLDivElement | null>;
  isActiveQuestion?: boolean;
}) {
  const isHuman = item.direction === 'from-human';
  const color = isRole(item.role ?? '') ? ROLE_COLOR[item.role as Role] : '#f59e0b';
  const label = isHuman ? 'you' : isRole(item.role ?? '') ? ROLE_LABEL[item.role as Role] : item.role;

  if (item.direction === 'to-human' && isActiveQuestion) {
    return (
      <QuestionBlock
        item={item}
        color={color}
        label={label ?? 'agent'}
        onOptionClick={onOptionClick}
        highlightRef={highlightRef}
      />
    );
  }

  const isInactiveQuestion = item.direction === 'to-human';

  return (
    <div ref={highlightRef} className={cn('flex', isHuman ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[90%] rounded px-2 py-1.5 border',
          isHuman ? 'bg-accent-soft border-accent/40' : 'bg-bg-sunken border-border',
          isInactiveQuestion && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint mb-0.5">
          <MessageSquareText size={10} className="text-text-faint" />
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span>{label}</span>
          {isInactiveQuestion && (
            <span className="ml-1 uppercase tracking-wider text-[9px] text-yellow-300">asks you</span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-text">{item.text}</div>
        {item.context && (
          <pre className="mt-1 text-[10px] text-text-faint whitespace-pre-wrap font-mono bg-bg/40 border border-border/60 rounded p-1">
            {item.context}
          </pre>
        )}
      </div>
    </div>
  );
}

function QuestionBlock({
  item,
  color,
  label,
  onOptionClick,
  highlightRef,
}: {
  item: ChatItem;
  color: string;
  label: string;
  onOptionClick: (option: string) => Promise<void>;
  highlightRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const hasClarifications = !!item.clarifications && item.clarifications.length > 0;
  const summaryText = hasClarifications
    ? item.text.split('\n')[0].replace(/^clarification needed:\s*/i, '').trim()
    : item.text;

  return (
    <div ref={highlightRef} className="flex justify-start">
      <div className="w-full max-w-[95%] rounded-lg border border-yellow-400/30 bg-yellow-500/5 overflow-hidden attention-glow">
        <div className="flex items-center gap-1.5 text-[10px] text-text-faint px-3 pt-2.5 pb-2 border-b border-border/30">
          <MessageSquareText size={10} className="text-yellow-300/70" />
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          <span>{label}</span>
          <span className="ml-1 uppercase tracking-wider text-[9px] text-yellow-300">asks you</span>
        </div>

        <div className="px-3 pt-2.5 pb-1 text-xs text-text">{summaryText}</div>

        {hasClarifications ? (
          <ClarificationForm clarifications={item.clarifications!} onSubmit={onOptionClick} />
        ) : (
          <>
            <SingleQuestionBody item={item} onOptionClick={onOptionClick} />
            <div className="px-3 py-2 border-t border-border/30">
              <span className="text-[10px] italic text-text-faint">
                or type a custom answer in the input below
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type ClarificationEntry = NonNullable<ChatItem['clarifications']>[number];

// multi-question clarifications were previously rendered as independent option
// buttons that each submitted a single-question answer on click, so answering
// Q1 "sent" the reply and Q2+ were silently dropped. this form collects one
// answer per question locally (option chip or freeform) and submits them as a
// single batched reply so the agent sees every answer at once.
function ClarificationForm({
  clarifications,
  onSubmit,
}: {
  clarifications: NonNullable<ChatItem['clarifications']>;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleOptionSelect = useCallback((questionIndex: number, option: string) => {
    setAnswers((prev) => ({ ...prev, [questionIndex]: option }));
  }, []);

  const handleAnswerChange = useCallback((questionIndex: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionIndex]: value }));
  }, []);

  const answeredCount = clarifications.reduce(
    (total, _, index) => ((answers[index] ?? '').trim().length > 0 ? total + 1 : total),
    0,
  );
  const allAnswered = answeredCount === clarifications.length;
  const disabled = submitting || submitted;

  const handleSubmit = useCallback(async () => {
    if (disabled || !allAnswered) return;
    setSubmitting(true);
    const batched = clarifications
      .map((_, index) => `Q${index + 1}: ${answers[index]?.trim() ?? ''}`)
      .join('\n');
    try {
      await onSubmit(batched);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }, [allAnswered, answers, clarifications, disabled, onSubmit]);

  return (
    <div>
      {clarifications.map((clarification, questionIndex) => (
        <ClarificationFormRow
          key={questionIndex}
          clarification={clarification}
          questionIndex={questionIndex}
          answer={answers[questionIndex] ?? ''}
          disabled={disabled}
          onOptionSelect={handleOptionSelect}
          onAnswerChange={handleAnswerChange}
        />
      ))}
      <div className="px-3 py-2.5 border-t border-border/30 flex items-center justify-between gap-2">
        <span className="text-[10px] italic text-text-faint">
          {submitted
            ? 'answers sent'
            : allAnswered
              ? 'all questions answered — ready to send'
              : `${answeredCount}/${clarifications.length} answered`}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !allAnswered}
          className="btn btn-primary text-xs disabled:opacity-50"
        >
          {submitted ? 'Sent' : submitting ? 'Sending…' : 'Send answers'}
        </button>
      </div>
    </div>
  );
}

function ClarificationFormRow({
  clarification,
  questionIndex,
  answer,
  disabled,
  onOptionSelect,
  onAnswerChange,
}: {
  clarification: ClarificationEntry;
  questionIndex: number;
  answer: string;
  disabled: boolean;
  onOptionSelect: (questionIndex: number, option: string) => void;
  onAnswerChange: (questionIndex: number, value: string) => void;
}) {
  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      onAnswerChange(questionIndex, event.target.value),
    [questionIndex, onAnswerChange],
  );

  const hasOptions = clarification.options.length > 0;

  return (
    <div className="px-3 py-2.5 border-t border-border/20">
      <div className="text-xs text-text mb-1.5">
        <span className="font-mono text-yellow-300/60 text-[10px] mr-1.5">
          Q{questionIndex + 1}.
        </span>
        {clarification.question}
      </div>
      {clarification.context && (
        <div className="text-[10px] text-text-faint italic mb-2">{clarification.context}</div>
      )}
      {hasOptions && (
        <div className="flex flex-col gap-1 mb-1.5">
          {clarification.options.map((option, optionIndex) => (
            <ClarificationOptionChip
              key={optionIndex}
              questionIndex={questionIndex}
              option={option}
              selected={answer === option}
              disabled={disabled}
              onSelect={onOptionSelect}
            />
          ))}
        </div>
      )}
      <input
        type="text"
        value={answer}
        onChange={handleInputChange}
        disabled={disabled}
        placeholder={hasOptions ? 'or type a custom answer' : 'type your answer'}
        className="w-full bg-bg-sunken border border-border rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent disabled:opacity-50"
      />
    </div>
  );
}

function ClarificationOptionChip({
  questionIndex,
  option,
  selected,
  disabled,
  onSelect,
}: {
  questionIndex: number;
  option: string;
  selected: boolean;
  disabled: boolean;
  onSelect: (questionIndex: number, option: string) => void;
}) {
  const handleClick = useCallback(
    () => onSelect(questionIndex, option),
    [questionIndex, option, onSelect],
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded border text-xs transition-colors',
        selected
          ? 'border-accent bg-accent/15 text-text'
          : 'border-border/60 bg-bg-sunken/50 text-text-muted hover:bg-accent/10 hover:border-accent/40 hover:text-text',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {option}
    </button>
  );
}

function SingleQuestionBody({
  item,
  onOptionClick,
}: {
  item: ChatItem;
  onOptionClick: (option: string) => Promise<void>;
}) {
  return (
    <>
      {item.context && (
        <pre className="mx-3 mb-2 text-[10px] text-text-faint whitespace-pre-wrap font-mono bg-bg/40 border border-border/60 rounded p-1.5">
          {item.context}
        </pre>
      )}
      {item.options && item.options.length > 0 && (
        <div className="px-3 pb-2.5 flex flex-col gap-1">
          {item.options.map((option, index) => (
            <OptionButton
              key={`opt-${index}`}
              label={option}
              value={option}
              onOptionClick={onOptionClick}
            />
          ))}
        </div>
      )}
    </>
  );
}

function OptionButton({
  label,
  value,
  onOptionClick,
}: {
  label: string;
  value: string;
  onOptionClick: (option: string) => Promise<void>;
}) {
  const [submitted, setSubmitted] = useState(false);
  const handleClick = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    void onOptionClick(value);
  }, [onOptionClick, value, submitted]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={submitted}
      className={cn(
        'flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded border text-xs transition-colors',
        'border-border/60 bg-bg-sunken/50 hover:bg-accent/10 hover:border-accent/40',
        'text-text-muted hover:text-text',
        submitted && 'opacity-50',
      )}
    >
      {label}
    </button>
  );
}

const TOOL_ICON: Record<string, typeof FileCode2> = {
  fs: FileCode2,
  code: FileCode2,
  runtime: TerminalIcon,
  browser: Globe,
  db: Database,
  agent: Sparkles,
  review: Braces,
};

const TOOL_VERB: Record<string, string> = {
  'fs:read': 'reads',
  'fs:write': 'writes',
  'fs:list': 'lists',
  'code:stream.start': 'writes',
  'code:stream.end': 'wrote',
  'runtime:start': 'boots',
  'runtime:stop': 'stops',
  'runtime:port-ready': 'serving at',
  'browser:goto': 'opens',
  'browser:click': 'clicks',
  'browser:fill': 'fills',
  'browser:screenshot': 'snaps',
  'browser:screenshot.done': 'snapped',
  'browser:text': 'reads',
  'db:query': 'queries',
  'agent:generate.start': 'thinking about',
  'agent:generate.end': 'done thinking',
  'agent:generate.error': 'failed',
};

function toolVerb(toolKind: string, action: string): string {
  return TOOL_VERB[`${toolKind}:${action}`] ?? action;
}

function isErrorAction(action: string): boolean {
  return action.endsWith('.error');
}

function ToolRow({
  item,
  onOpenFile,
}: {
  item: Extract<ActivityItem, { kind: 'tool' }>;
  onOpenFile: (path: string) => void;
}) {
  const Icon = TOOL_ICON[item.toolKind] ?? PlayCircle;
  const color = isRole(item.role ?? '') ? ROLE_COLOR[item.role as Role] : '#64748b';
  const verb = toolVerb(item.toolKind, item.action);
  const failed = item.ok === false || isErrorAction(item.action);

  const handleOpen = useCallback(() => {
    if (item.path) onOpenFile(item.path);
  }, [item.path, onOpenFile]);

  return (
    <div className="flex items-start gap-2 text-[11px] px-1 py-0.5">
      <span
        className={cn(
          'mt-0.5 rounded p-0.5 shrink-0',
          failed ? 'bg-red-500/15 text-red-300' : 'bg-bg-sunken/70 text-text-muted',
        )}
      >
        <Icon size={12} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-text-faint uppercase tracking-wider text-[9px]">{item.toolKind}</span>
          <span className="text-text">{verb}</span>
          {item.path && (
            <button
              type="button"
              onClick={handleOpen}
              className="font-mono text-accent underline decoration-dotted underline-offset-2 hover:text-accent/80"
            >
              {item.path}
            </button>
          )}
          {item.url && <span className="font-mono text-text">{item.url}</span>}
          {item.ms !== undefined && <span className="text-text-faint">· {item.ms}ms</span>}
          {failed && <AlertCircle size={11} className="text-red-400" />}
          {item.ok === true && !failed && item.action.endsWith('.done') && (
            <CheckCircle2 size={11} className="text-emerald-400" />
          )}
        </div>
        {item.summary && (
          <div
            className={cn(
              'mt-0.5 text-text-faint',
              failed && 'text-red-300 font-medium whitespace-pre-wrap',
              (item.path || item.url) && !failed && 'truncate',
            )}
          >
            {item.summary}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineEvent({
  item,
  onOpenFile,
}: {
  item: Extract<ActivityItem, { kind: 'log' | 'state' | 'workspace' | 'task' }>;
  onOpenFile: (path: string) => void;
}) {
  const roleLabel = item.kind !== 'task' && isRole(item.role ?? '') ? ROLE_LABEL[item.role as Role] : null;
  const color = item.kind !== 'task' && isRole(item.role ?? '') ? ROLE_COLOR[item.role as Role] : '#64748b';

  return (
    <div className="flex items-start gap-2 text-[11px] px-1">
      <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        {roleLabel && <span className="text-text-faint mr-1">[{roleLabel}]</span>}
        <InlineEventBody item={item} onOpenFile={onOpenFile} />
      </div>
    </div>
  );
}

function InlineEventBody({
  item,
  onOpenFile,
}: {
  item: Extract<ActivityItem, { kind: 'log' | 'state' | 'workspace' | 'task' }>;
  onOpenFile: (path: string) => void;
}) {
  if (item.kind === 'log') {
    return (
      <span className={cn('font-mono', item.stream === 'stderr' ? 'text-red-300' : 'text-text')}>
        {item.text.trimEnd()}
      </span>
    );
  }
  if (item.kind === 'state') {
    return (
      <span className="text-text">
        <span className="text-text-muted">state: </span>
        {item.status}
        {item.note ? <span className="text-text-faint"> · {item.note}</span> : null}
      </span>
    );
  }
  if (item.kind === 'workspace') {
    return <WorkspaceLink path={item.path} onOpenFile={onOpenFile} />;
  }
  return <span className="text-text">status → {item.status}</span>;
}

function WorkspaceLink({
  path,
  onOpenFile,
}: {
  path: string;
  onOpenFile: (path: string) => void;
}) {
  const handleClick = useCallback(() => onOpenFile(path), [onOpenFile, path]);
  return (
    <span className="text-text">
      <span className="text-text-muted">saved: </span>
      <button
        type="button"
        onClick={handleClick}
        className="font-mono text-accent underline decoration-dotted underline-offset-2 hover:text-accent/80"
      >
        {path}
      </button>
    </span>
  );
}

function WorkingIndicator({ hint }: { hint: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-text-muted">
      <WorkingDots />
      <span className="italic">{hint}</span>
    </div>
  );
}

function WorkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]" />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]" />
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-bounce" />
    </span>
  );
}
