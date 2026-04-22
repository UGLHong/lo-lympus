import { useCallback, useMemo } from 'react';
import { InputModal, type InputModalProps } from './input-modal';

interface TaskInputDialogProps extends Omit<InputModalProps, 'onSubmit'> {
  taskId: string;
  projectId: string;
  taskRole: string;
  onSubmit?: (value: string) => Promise<void> | void;
}

export function TaskInputDialog({
  taskId,
  projectId,
  taskRole,
  onSubmit,
  ...props
}: TaskInputDialogProps) {
  const handleSubmit = useCallback(
    async (value: string) => {
      if (onSubmit) {
        await onSubmit(value);
        return;
      }

      // Default: send as chat message to the task
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            role: taskRole,
            taskId,
            message: value,
            scope: 'task',
          }),
        });
        if (!res.ok) {
          console.error(`Failed to send input: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        console.error('Error sending input:', err);
      }
    },
    [projectId, taskRole, taskId, onSubmit],
  );

  return <InputModal {...props} onSubmit={handleSubmit} />;
}
