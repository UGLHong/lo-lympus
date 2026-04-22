import { useCallback, type FormEvent } from 'react';
import { Form } from 'react-router';

import { cn } from '../lib/cn';

type RecreateProjectFormProps = {
  projectId: string;
  projectName: string;
  projectBrief: string;
  className?: string;
  buttonLabel?: string;
};

export function RecreateProjectForm({
  projectId,
  projectName,
  projectBrief,
  className,
  buttonLabel = 'Recreate',
}: RecreateProjectFormProps) {
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (
      !window.confirm(
        `Recreate project "${projectName}"? This will destroy the current project and create a new one with the same name and description.`,
      )
    ) {
      event.preventDefault();
    }
  }, [projectName]);

  return (
    <Form
      method="post"
      action={`/projects/${projectId}`}
      className={cn('inline', className)}
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="_intent" value="recreate" />
      <input type="hidden" name="name" value={projectName} />
      <input type="hidden" name="brief" value={projectBrief} />
      <button type="submit" className="btn btn-secondary">
        {buttonLabel}
      </button>
    </Form>
  );
}
