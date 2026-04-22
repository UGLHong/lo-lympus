import { useEffect, useRef, useState } from 'react';

import { useSse, type SseEvent } from '../hooks/use-sse';
import { cn } from '../lib/cn';

interface TerminalProps {
  projectId: string;
  onRequestCollapse?: () => void;
}

interface LogLine {
  id: string;
  stream: 'stdout' | 'stderr';
  role: string;
  text: string;
  at: number;
}

export function Terminal({ projectId, onRequestCollapse }: TerminalProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useSse({
    projectId,
    onEvent: (event: SseEvent) => {
      if (event.type !== 'log') return;
      const p = event.payload as { stream?: 'stdout' | 'stderr'; line?: string };
      if (!p.line) return;
      setLines((prev) => {
        const next = [
          ...prev,
          {
            id: event.id,
            stream: p.stream ?? 'stdout',
            role: event.role ?? 'system',
            text: p.line!,
            at: event.createdAt,
          },
        ];
        return next.length > 500 ? next.slice(-500) : next;
      });
    },
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="h-full flex flex-col">
      <div className="panel-header">
        <span>Terminal</span>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setLines([])} className="btn text-[10px]">
            clear
          </button>
          {onRequestCollapse && (
            <button type="button" onClick={onRequestCollapse} className="btn text-[10px]">
              hide
            </button>
          )}
        </div>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-auto bg-bg-sunken p-2 text-[11px] leading-snug">
        {lines.length === 0 && (
          <div className="text-text-faint italic">no runtime output yet.</div>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn('whitespace-pre-wrap', line.stream === 'stderr' && 'text-red-400')}
          >
            <span className="text-text-faint mr-2">[{line.role}]</span>
            {line.text.trimEnd()}
          </div>
        ))}
      </div>
    </div>
  );
}
