"use client";

import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, HelpCircle, Loader2 } from "lucide-react";
import type { Message } from "@/lib/schemas/messages";
import type {
  ContentBlock,
  QuestionBlock,
  ArtifactBlock,
} from "@/lib/schemas/content-blocks";
import { ROLES, type RoleKey } from "@/lib/const/roles";
import { cn } from "@/lib/utils/cn";
import {
  extractStreamingEnvelopePreview,
  type StreamingEnvelopePreview,
  type StreamingBlockData,
} from "@/lib/utils/stream-envelope";
import { RoleAvatar } from "@/components/ui/role-avatar";
import { useProjectNavigation } from "@/components/layout/project-navigation";
import { ArtifactCard } from "./blocks/artifact-card";
import { DiffCard } from "./blocks/diff-card";
import { QuestionCard } from "./blocks/question-card";
import { GateCard } from "./blocks/gate-card";
import { ToolCallCard } from "./blocks/tool-call-card";
import { TicketCard } from "./blocks/ticket-card";

type AnswerPayload = { questionId: string; label: string };

type Props = {
  message: Message;
  streamingText?: string;
  onSubmitAnswers: (answers: AnswerPayload[]) => Promise<void>;
};

type SelectionEntry = { optionId: string; label: string };
type SelectionMap = Record<string, SelectionEntry>;

export function MessageBubble({
  message,
  streamingText,
  onSubmitAnswers,
}: Props) {
  const [selections, setSelections] = useState<SelectionMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [expandedChip, setExpandedChip] = useState<string | null>(null);

  const isHuman = message.author.kind === "human";
  const role = message.author.kind === "role" ? message.author.role : null;
  const roleDef = role ? ROLES[role] : null;

  const isStreaming = streamingText !== undefined;

  const streamingPreview = useMemo<StreamingEnvelopePreview | null>(() => {
    if (!isStreaming || isHuman) return null;
    return extractStreamingEnvelopePreview(streamingText ?? "");
  }, [isStreaming, isHuman, streamingText]);

  const humanStreamingText =
    isStreaming && isHuman ? (streamingText ?? "") : null;

  const questionBlocks = useMemo(
    () =>
      message.blocks.filter(
        (block): block is QuestionBlock => block.kind === "question",
      ),
    [message.blocks],
  );

  const handleSelect = useCallback(
    (questionId: string, optionId: string, label: string) => {
      if (submitted || submitting) return;
      setSelections((prev) => ({ ...prev, [questionId]: { optionId, label } }));
    },
    [submitted, submitting],
  );

  const handleSubmit = useCallback(async () => {
    if (submitting || submitted || questionBlocks.length === 0) return;
    const answers = questionBlocks.map<AnswerPayload>((question) => {
      const picked = selections[question.id];
      if (picked) return { questionId: question.id, label: picked.label };
      const defaultOption =
        question.options.find((option) => option.isDefault) ??
        question.options[0]!;
      return { questionId: question.id, label: defaultOption.label };
    });

    setSubmitting(true);
    try {
      await onSubmitAnswers(answers);
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }, [onSubmitAnswers, questionBlocks, selections, submitted, submitting]);

  const answeredCount = Object.keys(selections).length;
  const hasQuestions = questionBlocks.length > 0;
  const awaitingAnswers = hasQuestions && !submitted;

  const parseError =
    typeof message.meta?.parseError === "string"
      ? message.meta.parseError
      : null;
  const rawResponse =
    typeof message.meta?.rawResponse === "string"
      ? message.meta.rawResponse
      : null;

  return (
    <div
      className={cn("flex gap-2", isHuman ? "flex-row-reverse" : "flex-row")}
    >
      <div className="flex-shrink-0">
        {isHuman ? (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-olympus-muted text-xs font-semibold text-olympus-ink">
            You
          </div>
        ) : roleDef ? (
          <RoleAvatar role={roleDef.key} size={28} />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-olympus-muted text-xs">
            ·
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          isHuman && "items-end",
        )}
      >
        <MessageHeader
          isHuman={isHuman}
          role={role}
          phase={message.phase}
          isStreaming={isStreaming}
          streamingPreview={streamingPreview}
        />

        {humanStreamingText !== null ? (
          <HumanBubble text={humanStreamingText} />
        ) : streamingPreview ? (
          <StreamingBody
            preview={streamingPreview}
            role={role}
            expandedChip={expandedChip}
            onToggleChip={setExpandedChip}
          />
        ) : parseError ? (
          <ParseErrorBubble reason={parseError} raw={rawResponse} />
        ) : message.text ? (
          <AssistantBubble text={message.text} isHuman={isHuman} />
        ) : null}

        {message.blocks.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.blocks.map((block, i) => (
              <BlockRenderer
                key={i}
                block={block}
                selections={selections}
                disabled={submitted || submitting}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}

        {!message.blocks.length &&
          streamingPreview &&
          streamingPreview.blockCount > 0 && (
            <div className="flex flex-col gap-2">
              {streamingPreview.blocks.map((block, i) => (
                <StreamingEnvelopeBlockRow
                  key={`streaming-${i}`}
                  block={block}
                  index={i}
                  selections={selections}
                  disabled={submitted || submitting}
                  onSelect={handleSelect}
                />
              ))}
              <StreamingPendingBlocksBanner preview={streamingPreview} />
            </div>
          )}

        {hasQuestions && (
          <AnswersFooter
            total={questionBlocks.length}
            answered={answeredCount}
            submitting={submitting}
            submitted={submitted}
            awaitingAnswers={awaitingAnswers}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  );
}

type MessageHeaderProps = {
  isHuman: boolean;
  role: RoleKey | null;
  phase?: string;
  isStreaming: boolean;
  streamingPreview: StreamingEnvelopePreview | null;
};

function MessageHeader({
  isHuman,
  role,
  phase,
  isStreaming,
  streamingPreview,
}: MessageHeaderProps) {
  const roleDef = role ? ROLES[role] : null;
  const label = isHuman ? "You" : (roleDef?.displayName ?? "system");

  const statusLabel = !isStreaming
    ? null
    : streamingPreview === null
      ? "typing"
      : getStreamingStatusLabel(streamingPreview);

  return (
    <div className="flex items-center gap-2 text-[11px] text-olympus-dim">
      <span className="font-medium">{label}</span>
      {phase && (
        <span className="rounded bg-olympus-muted/60 px-1.5 py-[1px] text-[10px] text-olympus-dim">
          {phase}
        </span>
      )}
      {statusLabel && (
        <span className="flex items-center gap-1 text-olympus-blue">
          <TypingDots />
          <span>{statusLabel}</span>
        </span>
      )}
    </div>
  );
}

function getStreamingStatusLabel(preview: StreamingEnvelopePreview): string {
  if (preview.hasReview) return "reviewing";
  if (preview.latestSourceWritePath)
    return `writing ${preview.latestSourceWritePath}`;
  if (preview.latestWritePath) return `drafting ${preview.latestWritePath}`;
  if (preview.text.length > 0)
    return preview.textComplete ? "finishing up" : "writing reply";
  if (preview.blockCount > 0) return "drafting reply blocks";
  return "thinking";
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1 w-1 animate-pulse rounded-full bg-olympus-blue" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-olympus-blue [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-olympus-blue [animation-delay:300ms]" />
    </span>
  );
}

type StreamingBodyProps = {
  preview: StreamingEnvelopePreview;
  role: RoleKey | null;
};

function StreamingBody({
  preview,
  role,
  expandedChip,
  onToggleChip,
}: StreamingBodyProps & {
  expandedChip: string | null;
  onToggleChip: (key: string | null) => void;
}) {
  const { openArtifact } = useProjectNavigation();
  const progressChips = useMemo(
    () => buildProgressChips(preview, openArtifact),
    [preview, openArtifact],
  );
  const hasText = preview.text.length > 0;
  const hasProgress = progressChips.length > 0;

  if (!hasText && !hasProgress) {
    return <ThinkingPlaceholder role={role} />;
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-olympus-border/70 bg-olympus-bg/40 px-3 py-2">
      {hasText && (
        <div className="markdown-body text-sm leading-relaxed text-olympus-ink/95">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {preview.text || " "}
          </ReactMarkdown>
          {!preview.textComplete && (
            <span className="ml-0.5 inline-block animate-pulse">▍</span>
          )}
        </div>
      )}

      {hasProgress && (
        <div className="flex flex-wrap gap-1.5">
          {progressChips.map((chip) => (
            <ProgressChip
              key={chip.key}
              label={chip.label}
              tone={chip.tone}
              expanded={expandedChip === chip.key}
              onToggle={() =>
                onToggleChip(expandedChip === chip.key ? null : chip.key)
              }
              items={chip.items}
              footer={chip.footer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingPlaceholder({ role }: { role: RoleKey | null }) {
  const roleDef = role ? ROLES[role] : null;
  const who = roleDef?.displayName ?? "The agent";
  return (
    <div className="flex items-center gap-2 rounded-lg border border-olympus-border/60 bg-olympus-bg/40 px-3 py-2 text-sm text-olympus-dim">
      <TypingDots />
      <span>{who} is thinking…</span>
    </div>
  );
}

type ChipTone = "neutral" | "accent" | "warn";

type ProgressChipData = {
  key: string;
  label: string;
  tone: ChipTone;
  items?: ProgressChipItem[];
  footer?: string;
};

type ProgressChipItem = {
  id: string;
  label: string;
  subLabel?: string;
  onClick?: () => void;
};

function summarizeStreamBlockKinds(blocks: StreamingBlockData[]): string {
  const tallies = new Map<string, number>();
  for (const block of blocks) {
    const label = block.kind === "diff" ? "file change" : block.kind;
    tallies.set(label, (tallies.get(label) ?? 0) + 1);
  }
  const entries = [...tallies.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 1) {
    const [kind, count] = entries[0]!;
    return `${count}× ${kind}`;
  }
  return entries.map(([kind, count]) => `${count} ${kind}`).join(", ");
}

function formatBlockChipSuffix(preview: StreamingEnvelopePreview): string {
  const { blocks, blockCount, latestBlockKind } = preview;
  if (blocks.length === 0) {
    if (!latestBlockKind) return "";
    const label =
      latestBlockKind === "diff" ? "file change" : latestBlockKind;
    return ` · ${label}`;
  }
  const summary = summarizeStreamBlockKinds(blocks);
  const trailing = blockCount > blocks.length ? "…" : "";
  if (summary) return ` · ${summary}${trailing}`;
  if (!latestBlockKind) return "";
  return ` · ${latestBlockKind === "diff" ? "file change" : latestBlockKind}`;
}

function chipKindSubLabel(kind: string): string {
  if (kind === "tool-call") return "tool-call";
  if (kind === "diff") return "file change";
  return kind;
}

function streamingBlockListLabel(block: StreamingBlockData): string {
  if (block.kind === "question" && "question" in block && block.question) {
    const questionText = block.question;
    return questionText.length > 88 ? `${questionText.slice(0, 85)}…` : questionText;
  }
  if ("path" in block && block.path) {
    return block.path;
  }
  if ("title" in block && block.title) {
    return block.title;
  }
  return block.kind;
}

function buildProgressChips(
  preview: StreamingEnvelopePreview,
  onArtifactClick?: (path: string) => void,
): ProgressChipData[] {
  const chips: ProgressChipData[] = [];

  if (preview.blockCount > 0) {
    const suffix = formatBlockChipSuffix(preview);
    const pendingExtra = preview.blockCount - preview.blocks.length;
    const items: ProgressChipItem[] = preview.blocks.map((block, idx) => {
      const openPath =
        "path" in block && block.path ? block.path : undefined;
      return {
        id: `block-${idx}`,
        label: streamingBlockListLabel(block),
        subLabel: chipKindSubLabel(block.kind),
        onClick:
          openPath !== undefined
            ? () => onArtifactClick?.(openPath)
            : undefined,
      };
    });
    chips.push({
      key: "blocks",
      label: `${preview.blockCount} block${preview.blockCount === 1 ? "" : "s"}${suffix}`,
      tone: "neutral",
      items,
      footer:
        pendingExtra > 0
          ? `${pendingExtra} more block${pendingExtra === 1 ? "" : "s"} still streaming…`
          : undefined,
    });
  }

  if (preview.writeCount > 0) {
    const latest = preview.latestWritePath
      ? ` · ${preview.latestWritePath}`
      : "";
    const items: ProgressChipItem[] = preview.writes.map((write, idx) => ({
      id: `write-${idx}`,
      label: write.path,
      onClick: () => onArtifactClick?.(write.path),
    }));
    chips.push({
      key: "writes",
      label: `${preview.writeCount} artifact${preview.writeCount === 1 ? "" : "s"}${latest}`,
      tone: "accent",
      items,
    });
  }

  if (preview.sourceWriteCount > 0) {
    const latest = preview.latestSourceWritePath
      ? ` · ${preview.latestSourceWritePath}`
      : "";
    const items: ProgressChipItem[] = preview.sourceWrites.map(
      (write, idx) => ({
        id: `source-${idx}`,
        label: write.path,
        onClick: () => onArtifactClick?.(write.path),
      }),
    );
    chips.push({
      key: "source",
      label: `${preview.sourceWriteCount} source file${preview.sourceWriteCount === 1 ? "" : "s"}${latest}`,
      tone: "accent",
      items,
    });
  }

  if (preview.hasReview) {
    chips.push({ key: "review", label: "review pending", tone: "warn" });
  }

  if (preview.advance === true) {
    chips.push({ key: "advance", label: "advancing phase", tone: "accent" });
  }

  return chips;
}

function ProgressChip({
  label,
  tone,
  expanded,
  onToggle,
  items,
  footer,
}: {
  label: string;
  tone: ChipTone;
  expanded?: boolean;
  onToggle?: () => void;
  items?: ProgressChipItem[];
  footer?: string;
}) {
  const hasItems = items && items.length > 0;
  const toneClass =
    tone === "accent"
      ? "border-olympus-accent/40 bg-olympus-accent/10 text-olympus-accent"
      : tone === "warn"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
        : "border-olympus-border/60 bg-olympus-muted/40 text-olympus-dim";

  if (!hasItems) {
    return (
      <span
        className={cn(
          "rounded-full border px-2 py-[2px] text-[10px] uppercase tracking-wider",
          toneClass,
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] uppercase tracking-wider transition hover:opacity-80",
          toneClass,
        )}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="flex max-w-[min(100%,24rem)] flex-col gap-1 rounded border border-olympus-border/40 bg-olympus-muted/20 p-2">
          {items.map((item) => {
            const rowClass =
              "w-full rounded px-2 py-1.5 text-left transition hover:bg-olympus-muted/50 hover:text-olympus-ink";
            const primaryClass = "block break-all text-[11px] text-olympus-ink";
            const subClass = "mt-0.5 block text-[9px] uppercase tracking-wider text-olympus-dim/85";
            const inner = (
              <>
                <span className={primaryClass}>{item.label}</span>
                {item.subLabel ? (
                  <span className={subClass}>{item.subLabel}</span>
                ) : null}
              </>
            );
            if (item.onClick) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  title="Open in workspace"
                  className={cn(rowClass, "cursor-pointer text-left")}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div key={item.id} className={cn(rowClass, "text-olympus-dim")}>
                {inner}
              </div>
            );
          })}
          {footer ? (
            <div className="border-t border-olympus-border/30 px-2 pt-1.5 text-[9px] text-olympus-dim/90">
              {footer}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function HumanBubble({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-olympus-blue/30 bg-olympus-blue/10 px-3 py-2 text-sm leading-relaxed text-olympus-ink">
      <div className="whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function AssistantBubble({
  text,
  isHuman,
}: {
  text: string;
  isHuman: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-relaxed",
        isHuman
          ? "border-olympus-blue/30 bg-olympus-blue/10 text-olympus-ink"
          : "border-olympus-border bg-olympus-bg/40 text-olympus-ink",
      )}
    >
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || " "}</ReactMarkdown>
      </div>
    </div>
  );
}

function ParseErrorBubble({
  reason,
  raw,
}: {
  reason: string;
  raw: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const handleToggle = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-sm text-olympus-ink">
      <div className="flex items-start gap-2">
        <span className="mt-[2px] inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
        <div className="flex-1">
          <div className="font-medium text-amber-200">
            Response couldn&apos;t be parsed
          </div>
          <div className="text-[12px] text-olympus-dim">
            {reason}. The agent will retry.
          </div>
        </div>
        {raw && (
          <button
            type="button"
            onClick={handleToggle}
            className="rounded border border-olympus-border/60 px-2 py-[2px] text-[10px] uppercase tracking-wider text-olympus-dim hover:text-olympus-ink"
          >
            {expanded ? "hide raw" : "view raw"}
          </button>
        )}
      </div>

      {expanded && raw && (
        <pre className="max-h-40 overflow-auto rounded bg-olympus-bg/60 p-2 font-mono text-[11px] leading-[1rem] text-olympus-dim">
          {raw}
        </pre>
      )}
    </div>
  );
}

function StreamingEnvelopeBlockRow({
  block,
  index,
  selections,
  disabled,
  onSelect,
}: {
  block: StreamingBlockData;
  index: number;
  selections: SelectionMap;
  disabled: boolean;
  onSelect: (questionId: string, optionId: string, label: string) => void;
}) {
  if (block.kind === "diff") {
    const path = "path" in block ? block.path : undefined;
    if (!path) {
      return null;
    }
    const before =
      "before" in block && block.before !== undefined ? block.before : "";
    const after =
      "after" in block && block.after !== undefined ? block.after : "";
    return (
      <DiffCard
        block={{ kind: "diff", path, before, after }}
      />
    );
  }

  return (
    <StreamingBlockRenderer
      block={block}
      selections={selections}
      disabled={disabled}
      onSelect={onSelect}
      index={index}
    />
  );
}

function StreamingPendingBlocksBanner({
  preview,
}: {
  preview: StreamingEnvelopePreview;
}) {
  const pendingExtra = preview.blockCount - preview.blocks.length;
  if (pendingExtra <= 0) {
    return null;
  }
  const kind = preview.latestBlockKind;
  const heading =
    kind === "diff"
      ? "Generating file change summaries"
      : kind === "artifact"
        ? "Receiving artifact cards"
        : "Receiving structured blocks";

  return (
    <div className="flex items-start gap-2 rounded-md border border-olympus-border/50 bg-olympus-muted/25 px-3 py-2">
      <Loader2
        className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin text-olympus-accent"
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-[11px] leading-snug">
        <div className="font-medium text-olympus-ink/95">{heading}</div>
        <div className="mt-0.5 text-olympus-dim">
          {pendingExtra} block{pendingExtra === 1 ? "" : "s"} still arriving — content
          appears as each JSON object finishes.
        </div>
      </div>
    </div>
  );
}

function StreamingBlockRenderer({
  block,
  selections,
  disabled,
  onSelect,
  index = 0,
}: {
  block: ContentBlock | StreamingBlockData;
  selections: SelectionMap;
  disabled: boolean;
  onSelect: (questionId: string, optionId: string, label: string) => void;
  index?: number;
}) {
  if (
    block.kind === "question" &&
    "question" in block &&
    block.question &&
    block.id
  ) {
    const blockId = block.id;
    return (
      <div className="rounded-md border border-olympus-accent/30 bg-olympus-accent/5 p-3">
        <div className="mb-2 flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-olympus-accent" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-olympus-accent">
              Clarification
            </div>
            <div className="mt-0.5 text-sm text-olympus-ink">
              {block.question}
            </div>
          </div>
        </div>
        {block.options && block.options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {block.options.map((option) => (
              <button
                key={option.id || ""}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (option.label) {
                    onSelect(blockId, option.id || "", option.label);
                  }
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60",
                  selections[blockId]?.optionId === option.id
                    ? "border-olympus-accent bg-olympus-accent text-olympus-bg"
                    : "border-olympus-border bg-olympus-bg/60 text-olympus-ink hover:border-olympus-accent/60 hover:bg-olympus-accent/10",
                  option.isDefault &&
                    !selections[blockId]?.optionId &&
                    "ring-1 ring-olympus-accent/40",
                )}
              >
                {option.label}
                {option.isDefault && !selections[blockId] && (
                  <span className="ml-1 text-[10px] text-olympus-dim">
                    (default)
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (block.kind === "question") {
    const hasQuestion = "question" in block && block.question;
    const hasOptions =
      "options" in block && block.options && block.options.length > 0;
    const animationDelay = index * 100;

    return (
      <div
        className="rounded-md border border-olympus-accent/30 bg-olympus-accent/5 p-3 animate-in fade-in"
        style={{
          animationDuration: "300ms",
          animationDelay: `${animationDelay}ms`,
          opacity: 0,
          animation: `fadeIn 300ms ease-out ${animationDelay}ms forwards`,
        }}
      >
        <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
        <div className="mb-2 flex items-start gap-2">
          <div className="h-4 w-4 flex-shrink-0 animate-pulse rounded-full bg-olympus-accent/40" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-olympus-accent">
              Clarification
            </div>
            {hasQuestion ? (
              <div className="mt-0.5 text-sm text-olympus-ink">
                {("question" in block && block.question) || ""}
              </div>
            ) : (
              <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-olympus-muted/40" />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hasOptions ? (
            "options" in block && block.options ? (
              block.options.map((option) => (
                <div
                  key={option.id || ""}
                  className="h-8 w-24 animate-pulse rounded-full bg-olympus-muted/40"
                />
              ))
            ) : null
          ) : (
            <>
              <div className="h-8 w-24 animate-pulse rounded-full bg-olympus-muted/40" />
              <div className="h-8 w-28 animate-pulse rounded-full bg-olympus-muted/40" />
            </>
          )}
        </div>
      </div>
    );
  }

  if (block.kind === "artifact") {
    const hasTitle = "title" in block && block.title;
    const animationDelay = index * 100;

    return (
      <div
        className="rounded-md border border-olympus-border bg-olympus-muted/30 p-3 animate-in fade-in"
        style={{
          animationDuration: "300ms",
          animationDelay: `${animationDelay}ms`,
          opacity: 0,
          animation: `fadeIn 300ms ease-out ${animationDelay}ms forwards`,
        }}
      >
        <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
        <div className="flex items-start gap-2">
          <div className="h-4 w-4 flex-shrink-0 animate-pulse rounded bg-olympus-accent/40" />
          <div className="flex-1">
            {hasTitle ? (
              <div className="mb-1 text-sm font-medium text-olympus-ink">
                {("title" in block && block.title) || ""}
              </div>
            ) : (
              <div className="mb-1 h-4 w-2/3 animate-pulse rounded bg-olympus-muted/40" />
            )}
            <div className="h-3 w-1/2 animate-pulse rounded bg-olympus-muted/30" />
          </div>
        </div>
      </div>
    );
  }

  const animationDelay = index * 100;
  return (
    <div
      className="rounded-md border border-olympus-border/60 bg-olympus-muted/20 p-3 animate-in fade-in"
      style={{
        animationDuration: "300ms",
        animationDelay: `${animationDelay}ms`,
        opacity: 0,
        animation: `fadeIn 300ms ease-out ${animationDelay}ms forwards`,
      }}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div className="inline-block h-4 w-16 animate-pulse rounded bg-olympus-muted/40" />
    </div>
  );
}

type BlockRendererProps = {
  block: ContentBlock;
  selections: SelectionMap;
  disabled: boolean;
  onSelect: (questionId: string, optionId: string, label: string) => void;
};

function BlockRenderer({
  block,
  selections,
  disabled,
  onSelect,
}: BlockRendererProps) {
  switch (block.kind) {
    case "artifact":
      return <ArtifactCard block={block} />;
    case "question":
      return (
        <QuestionCard
          block={block}
          selectedOptionId={selections[block.id]?.optionId ?? null}
          disabled={disabled}
          onSelect={onSelect}
        />
      );
    case "gate":
      return <GateCard block={block} />;
    case "tool-call":
      return <ToolCallCard block={block} />;
    case "ticket":
      return <TicketCard block={block} />;
    case "diff":
      return <DiffCard block={block} />;
    default:
      return null;
  }
}

type AnswersFooterProps = {
  total: number;
  answered: number;
  submitting: boolean;
  submitted: boolean;
  awaitingAnswers: boolean;
  onSubmit: () => void;
};

function AnswersFooter({
  total,
  answered,
  submitting,
  submitted,
  awaitingAnswers,
  onSubmit,
}: AnswersFooterProps) {
  const remaining = total - answered;
  const buttonLabel = submitting
    ? "sending…"
    : submitted
      ? "answers sent"
      : answered === 0
        ? "use defaults & send"
        : remaining > 0
          ? `send (${remaining} will use default)`
          : `send ${total} answer${total === 1 ? "" : "s"}`;

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-olympus-border/60 bg-olympus-bg/40 px-3 py-2">
      <span className="text-[11px] text-olympus-dim">
        {submitted
          ? `${total} answer${total === 1 ? "" : "s"} sent`
          : `${answered}/${total} selected`}
      </span>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!awaitingAnswers || submitting}
        className="rounded-md bg-olympus-accent px-3 py-1 text-xs font-medium text-olympus-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
