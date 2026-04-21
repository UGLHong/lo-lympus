'use client';

import { HelpCircle } from 'lucide-react';
import { useCallback } from 'react';
import type { QuestionBlock } from '@/lib/schemas/content-blocks';
import { cn } from '@/lib/utils/cn';

type Props = {
  block: QuestionBlock;
  selectedOptionId: string | null;
  disabled?: boolean;
  onSelect: (questionId: string, optionId: string, label: string) => void;
};

export function QuestionCard({ block, selectedOptionId, disabled, onSelect }: Props) {
  const handleClick = useCallback(
    (optionId: string, label: string) => {
      if (disabled) return;
      onSelect(block.id, optionId, label);
    },
    [block.id, disabled, onSelect],
  );

  return (
    <div className="rounded-md border border-olympus-accent/30 bg-olympus-accent/5 p-3">
      <div className="mb-2 flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-olympus-accent" />
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-olympus-accent">Clarification</div>
          <div className="mt-0.5 text-sm text-olympus-ink">{block.question}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {block.options.map((option) => (
          <QuestionOption
            key={option.id}
            label={option.label}
            isDefault={option.isDefault}
            isSelected={selectedOptionId === option.id}
            hasSelection={selectedOptionId !== null}
            disabled={disabled}
            onClick={() => handleClick(option.id, option.label)}
          />
        ))}
      </div>
    </div>
  );
}

type OptionProps = {
  label: string;
  isDefault?: boolean;
  isSelected: boolean;
  hasSelection: boolean;
  disabled?: boolean;
  onClick: () => void;
};

function QuestionOption({
  label,
  isDefault,
  isSelected,
  hasSelection,
  disabled,
  onClick,
}: OptionProps) {
  const showDefaultHint = isDefault && !hasSelection;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60',
        isSelected
          ? 'border-olympus-accent bg-olympus-accent text-olympus-bg'
          : 'border-olympus-border bg-olympus-bg/60 text-olympus-ink hover:border-olympus-accent/60 hover:bg-olympus-accent/10',
        showDefaultHint && 'ring-1 ring-olympus-accent/40',
      )}
    >
      {label}
      {showDefaultHint && <span className="ml-1 text-[10px] text-olympus-dim">(default)</span>}
    </button>
  );
}
