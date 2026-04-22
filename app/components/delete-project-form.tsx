import { useCallback, type FormEvent } from 'react';
import { Form } from 'react-router';

import { cn } from '../lib/cn';

type DeleteProjectFormProps = {
  projectId: string;
  className?: string;
  buttonLabel?: string;
};

export function DeleteProjectForm({
  projectId,
  className,
  buttonLabel = 'Delete',
}: DeleteProjectFormProps) {
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    if (
      !window.confirm(
        'Delete this project, all tasks, events, and the workspace folder on disk? This cannot be undone.',
      )
    ) {
      event.preventDefault();
    }
  }, []);

  return (
    <Form
      method="post"
      action={`/projects/${projectId}`}
      className={cn('inline', className)}
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="_intent" value="delete" />
      <button type="submit" className="btn btn-danger">
        {buttonLabel}
      </button>
    </Form>
  );
}
