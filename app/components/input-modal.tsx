import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface InputModalProps {
  isOpen: boolean;
  title: string;
  context?: string;
  placeholder?: string;
  options?: string[];
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
  isLoading?: boolean;
}

export function InputModal({
  isOpen,
  title,
  context,
  placeholder = 'provide input',
  options = [],
  onSubmit,
  onClose,
  isLoading = false,
}: InputModalProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || submitting) return;
      setSubmitting(true);
      try {
        await onSubmit(trimmed);
        setValue('');
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, submitting],
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void handleSubmit(value);
    },
    [value, handleSubmit],
  );

  const handleOptionClick = useCallback(
    (option: string) => {
      void handleSubmit(option);
    },
    [handleSubmit],
  );

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-bg-raised border border-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-border p-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-text mb-1">{title}</h2>
              {context && (
                <pre className="text-[11px] text-text-muted whitespace-pre-wrap font-mono bg-bg-sunken/50 border border-border/50 rounded px-2 py-1.5 overflow-auto max-h-32">
                  {context}
                </pre>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-1 hover:bg-bg-sunken rounded transition-colors"
              aria-label="Close modal"
            >
              <X size={16} className="text-text-muted hover:text-text" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {options.length > 0 && (
              <div className="p-4 border-b border-border/50">
                <div className="text-[11px] text-text-faint uppercase tracking-wider mb-2">
                  Quick options
                </div>
                <div className="flex flex-wrap gap-2">
                  {options.map((option, index) => (
                    <button
                      key={`${option}-${index}`}
                      onClick={() => handleOptionClick(option)}
                      disabled={submitting || isLoading}
                      className={cn(
                        'px-3 py-1.5 rounded border text-[11px] font-medium transition-colors',
                        'border-border bg-bg-sunken hover:bg-bg-sunken/80',
                        'text-text-muted hover:text-text',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                {options.length > 0 && (
                  <div className="mt-2 text-[10px] italic text-text-faint">
                    or type a custom response below
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleFormSubmit} className="border-t border-border p-4 bg-bg-sunken/30 flex gap-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={submitting || isLoading}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                'flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text',
                'placeholder:text-text-muted',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            />
            <button
              type="submit"
              disabled={submitting || isLoading || value.trim().length === 0}
              className={cn(
                'px-4 py-2 rounded font-medium text-sm transition-colors',
                'bg-accent text-bg hover:bg-accent/90',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                (submitting || isLoading) && 'cursor-wait',
              )}
            >
              {submitting || isLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  Sending
                </span>
              ) : (
                'Send'
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
