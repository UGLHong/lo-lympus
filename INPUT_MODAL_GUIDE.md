# Input Modal Component Guide

## Overview

The `InputModal` component provides a **Cursor IDE-inspired** interface for requesting human input from users when tasks are blocked or need clarification. It features a dark, minimalist design with clean typography and intuitive interactions.

## Features

- **Modal Dialog**: Centered overlay with focused input area
- **Context Panel**: Display task context, requirements, or clarification info
- **Quick Options**: Pre-defined choices with one-click selection
- **Free-form Input**: Text field for custom responses
- **Keyboard Support**: Enter to submit, Escape to close
- **Loading States**: Visual feedback during submission
- **Accessible**: Proper ARIA labels and focus management

## Components

### InputModal

The base modal component for collecting user input.

```tsx
import { InputModal } from './components/input-modal';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <InputModal
      isOpen={isOpen}
      title="Database Configuration Required"
      context="The application needs database credentials to proceed..."
      placeholder="enter database host"
      options={['localhost', 'postgres.example.com', 'custom']}
      onSubmit={async (value) => {
        console.log('User input:', value);
        setIsOpen(false);
      }}
      onClose={() => setIsOpen(false)}
    />
  );
}
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | boolean | Yes | Controls modal visibility |
| `title` | string | Yes | Modal heading |
| `context` | string | No | Context information (shows in code block) |
| `placeholder` | string | No | Input field placeholder (default: "provide input") |
| `options` | string[] | No | Quick-choice buttons |
| `onSubmit` | (value: string) => Promise<void> | void | Yes | Callback when user submits |
| `onClose` | () => void | Yes | Callback when modal closes |
| `isLoading` | boolean | No | Shows loading state |

### TaskInputDialog

Task-aware wrapper that automatically sends input to the task endpoint.

```tsx
import { TaskInputDialog } from './components/task-input-dialog';

function TaskUI() {
  return (
    <TaskInputDialog
      isOpen={isBlocked}
      taskId="task-123"
      projectId="project-456"
      taskRole="backend-dev"
      title="Task Input Required"
      context="Please provide the configuration..."
      onClose={() => setIsBlocked(false)}
    />
  );
}
```

### useInputModal Hook

Manage modal state with a custom hook.

```tsx
import { useInputModal } from './hooks/use-input-modal';

function MyComponent() {
  const [state, actions] = useInputModal(async (value) => {
    console.log('Input:', value);
  });

  return (
    <>
      <button onClick={() => actions.open({
        title: 'Configuration',
        context: 'Setup required...',
        placeholder: 'enter value'
      })}>
        Open Modal
      </button>

      <InputModal
        isOpen={state.isOpen}
        title={state.title}
        context={state.context}
        placeholder={state.placeholder}
        options={state.options}
        onSubmit={/* ... */}
        onClose={actions.close}
        isLoading={state.isLoading}
      />
    </>
  );
}
```

## Integration with TaskChat

The modal is automatically triggered when a task enters the `blocked-needs-input` status.

```tsx
// In task-chat.tsx
const [showBlockedModal, setShowBlockedModal] = useState(false);

useEffect(() => {
  setShowBlockedModal(taskStatus === 'blocked-needs-input');
}, [taskStatus]);

return (
  <>
    <TaskChat {/* ... */} />
    <InputModal
      isOpen={showBlockedModal}
      title="Task Blocked — Input Required"
      context={blockedQuestion?.context}
      placeholder="provide input to unblock the task"
      options={blockedQuestion?.options}
      onSubmit={sendMessage}
      onClose={() => setShowBlockedModal(false)}
      isLoading={sending}
    />
  </>
);
```

## Design System

The component uses the Cursor IDE-inspired color scheme:

- **Background**: Dark (`#0b0d10` / `#12151a`)
- **Borders**: Subtle (`#1f242c`)
- **Text**: Light (`#e5e7eb`)
- **Accent**: Gold/Amber (`#f59e0b`)
- **Feedback**: Yellow for attention (`#fbbf24`)

### Tailwind Classes Used

- `bg-bg-raised`: Main background
- `border-border`: Border colors
- `text-text`: Primary text
- `text-accent`: Interactive elements
- `bg-bg-sunken`: Input fields & secondary surfaces

## Examples

### Simple Input

```tsx
<InputModal
  isOpen={true}
  title="Enter API Key"
  placeholder="paste your API key"
  onSubmit={async (apiKey) => {
    await saveApiKey(apiKey);
  }}
  onClose={() => {}}
/>
```

### With Multiple Options

```tsx
<InputModal
  isOpen={true}
  title="Select Database Type"
  context="Which database should we use?"
  options={['PostgreSQL', 'MySQL', 'MongoDB', 'Other']}
  onSubmit={async (choice) => {
    await updateDatabaseType(choice);
  }}
  onClose={() => {}}
/>
```

### With Context and Options

```tsx
<InputModal
  isOpen={true}
  title="Frontend Framework Decision"
  context={`Current constraints:
- Real-time updates required
- Team: React experts
- Bundle size: < 50KB gzipped
- TypeScript mandatory`}
  placeholder="choose or explain alternative"
  options={['React', 'Vue', 'Svelte']}
  onSubmit={async (choice) => {
    await saveFrameworkChoice(choice);
  }}
  onClose={() => {}}
/>
```

### Task-specific Input

```tsx
<TaskInputDialog
  isOpen={blocked}
  taskId={taskId}
  projectId={projectId}
  taskRole="backend-dev"
  title="Database Connection Required"
  context="Please provide connection string"
  placeholder="e.g., postgresql://user:pass@host:5432/db"
  onClose={() => setBlocked(false)}
/>
```

## Styling & Customization

The component uses Tailwind CSS with the project's design system. To customize:

1. **Colors**: Update `tailwind.config.ts`
2. **Spacing**: Modify Tailwind utility classes in the component
3. **Animations**: Add custom animation classes
4. **Typography**: Adjust text size (`text-sm`, `text-xs`, etc.)

## Keyboard Shortcuts

- **Enter**: Submit the form
- **Escape**: Close modal (optional, can be disabled)
- **Tab**: Navigate between options and input

## Accessibility

- ✅ Semantic HTML (form, input, button)
- ✅ Proper ARIA labels (`aria-label` on close button)
- ✅ Focus management (auto-focus input on open)
- ✅ Keyboard navigation
- ✅ Color contrast (AA compliant)
- ✅ Screen reader friendly

## Performance

- Lightweight component (~2KB minified)
- No external dependencies (uses Lucide icons)
- Efficient re-renders with `useCallback`
- No animation janking (uses CSS transforms)

## Use Cases

1. **Blocked Tasks**: Request input when task is waiting for user decision
2. **Clarification**: Ask team for tech stack or design decisions
3. **Configuration**: Get credentials, API keys, or settings
4. **Feedback**: Collect user feedback or corrections
5. **Decision Making**: Present options and record team choices

## See Also

- `InputModal` - Base component
- `TaskInputDialog` - Task integration
- `useInputModal` - Hook for state management
- `input-modal-showcase.tsx` - Working examples
