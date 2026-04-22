import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';

import { getSettings } from '../../server/lib/settings';

import type { Route } from './+types/settings';

export async function loader() {
  return { settings: getSettings() };
}

export const meta: Route.MetaFunction = () => [{ title: "Settings · L'Olympus" }];

type Settings = Awaited<ReturnType<typeof loader>>['settings'];

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const initial = loaderData.settings;
  const [form, setForm] = useState<Settings>(initial);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const handleNumberChange = useCallback(
    (key: 'maxRetries' | 'maxReviewIterations' | 'pollMs') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value);
        setForm((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
      },
    [],
  );

  const handleTierChange = useCallback(
    (tier: keyof Settings['modelTiers']) =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setForm((prev) => ({
          ...prev,
          modelTiers: { ...prev.modelTiers, [tier]: value },
        }));
      },
    [],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSaved('saving');
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error('failed');
        setSaved('ok');
      } catch {
        setSaved('error');
      }
    },
    [form],
  );

  return (
    <div className="min-h-screen bg-bg text-text p-6">
      <header className="flex items-center gap-3 mb-6">
        <Link to="/projects" className="text-accent text-sm">
          ← back to projects
        </Link>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <section className="panel p-4 space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-text-muted">Workforce behavior</h2>
          <NumberField
            label="Max retries per task"
            hint="Transient errors (rate-limits, 5xx) will retry up to this many times before the task is marked failed."
            value={form.maxRetries}
            onChange={handleNumberChange('maxRetries')}
          />
          <NumberField
            label="Max review iterations"
            hint="Maximum reviewer → fix → re-review cycles per task before the self-healing loop escalates to a human. Default 10."
            value={form.maxReviewIterations}
            onChange={handleNumberChange('maxReviewIterations')}
          />
          <NumberField
            label="Default poll interval (ms)"
            hint="How often idle employees look for new work. Lower values are more responsive but use more CPU."
            value={form.pollMs}
            onChange={handleNumberChange('pollMs')}
            min={500}
            step={500}
          />
        </section>

        <section className="panel p-4 space-y-4">
          <h2 className="text-xs uppercase tracking-wider text-text-muted">Model tiers</h2>
          <p className="text-[11px] text-text-faint">
            OpenRouter model ids for each capability tier. Leave blank to fall back to environment variables.
          </p>
          <TextField
            label="Fast"
            value={form.modelTiers.fast}
            onChange={handleTierChange('fast')}
            placeholder="e.g. google/gemini-flash-1.5"
          />
          <TextField
            label="Reasoning"
            value={form.modelTiers.reasoning}
            onChange={handleTierChange('reasoning')}
            placeholder="e.g. openai/o1-mini"
          />
          <TextField
            label="Coding"
            value={form.modelTiers.coding}
            onChange={handleTierChange('coding')}
            placeholder="e.g. anthropic/claude-3.5-sonnet"
          />
          <TextField
            label="Vision"
            value={form.modelTiers.vision}
            onChange={handleTierChange('vision')}
            placeholder="e.g. openai/gpt-4o"
          />
        </section>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={saved === 'saving'}>
            {saved === 'saving' ? 'Saving…' : 'Save settings'}
          </button>
          {saved === 'ok' && <span className="text-emerald-300 text-xs">saved</span>}
          {saved === 'error' && <span className="text-red-300 text-xs">failed to save</span>}
        </div>
      </form>
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function NumberField({ label, hint, value, min = 0, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="block">
      <div className="text-xs mb-1">{label}</div>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={onChange}
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
      />
      {hint && <div className="text-[11px] text-text-faint mt-1">{hint}</div>}
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function TextField({ label, value, placeholder, onChange }: TextFieldProps) {
  return (
    <label className="block">
      <div className="text-xs mb-1">{label}</div>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className="w-full bg-bg-sunken border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
      />
    </label>
  );
}
