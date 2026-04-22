'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [requirement, setRequirement] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!name.trim() || !requirement.trim()) {
        setError('Give the project a name and describe what you want to build.');
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), requirement: requirement.trim() }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { projectId: string };
        router.push(`/project/${data.projectId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
      }
    },
    [name, requirement, router],
  );

  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleRequirementChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRequirement(event.target.value);
  }, []);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-olympus-dim">
        Project name
        <input
          value={name}
          onChange={handleNameChange}
          placeholder="e.g. Team Kudos Board"
          className="rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 text-sm text-olympus-ink outline-none focus:border-olympus-accent/60"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-olympus-dim">
        What do you want to build?
        <textarea
          value={requirement}
          onChange={handleRequirementChange}
          rows={4}
          placeholder="Describe the product in 2-5 sentences. You can paste bullet lists, link mockups, or just free-form requirements."
          className="min-h-[110px] resize-y rounded-md border border-olympus-border bg-olympus-bg px-3 py-2 text-sm leading-relaxed text-olympus-ink outline-none focus:border-olympus-accent/60"
        />
      </label>

      {error && <div className="text-xs text-olympus-red">{error}</div>}

      <div className="flex items-center justify-between">
        <span className="text-xs text-olympus-dim">
          The Orchestrator will draft <code className="rounded bg-olympus-muted px-1">REQUIREMENTS.md</code> and ask clarification questions.
        </span>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-olympus-accent px-4 py-2 text-sm font-medium text-olympus-bg disabled:opacity-50"
        >
          {submitting ? 'Spinning up office…' : 'Start project'}
        </button>
      </div>
    </form>
  );
}
