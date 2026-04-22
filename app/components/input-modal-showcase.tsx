import { useState } from 'react';
import { InputModal } from './input-modal';

export function InputModalShowcase() {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [clarificationOpen, setClarificationOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);

  return (
    <div className="space-y-4 p-4">
      <button
        onClick={() => setBlockedOpen(true)}
        className="btn btn-primary"
      >
        Show Blocked Input Modal
      </button>

      <button
        onClick={() => setClarificationOpen(true)}
        className="btn btn-primary"
      >
        Show Clarification Modal
      </button>

      <button
        onClick={() => setChoiceOpen(true)}
        className="btn btn-primary"
      >
        Show Choice Modal
      </button>

      <InputModal
        isOpen={blockedOpen}
        title="Task Blocked — Database Configuration Required"
        context={`Current status: blocked-needs-input
Task: BE-1 Implement Authentication & WebSocket Server
Reason: Database connection details needed

Required fields:
- Database host (e.g., localhost, postgres.example.com)
- Database port (default: 5432)
- Database name (e.g., chat_app_db)
- Database user credentials`}
        placeholder="provide database connection details"
        onSubmit={async (value) => {
          console.log('Submitted:', value);
          setBlockedOpen(false);
        }}
        onClose={() => setBlockedOpen(false)}
      />

      <InputModal
        isOpen={clarificationOpen}
        title="Clarification Needed — Authentication Method"
        context={`Task: Define API Security Strategy
Current context: Building authentication system

Questions to resolve:
1. Should we use JWT tokens or OAuth2?
2. Session timeout preferences?
3. Multi-factor authentication required?`}
        placeholder="provide clarification on authentication approach"
        options={['JWT tokens', 'OAuth2', 'Session-based', 'Custom solution']}
        onSubmit={async (value) => {
          console.log('Selected:', value);
          setClarificationOpen(false);
        }}
        onClose={() => setClarificationOpen(false)}
      />

      <InputModal
        isOpen={choiceOpen}
        title="Technology Decision — Frontend Framework"
        context={`Task: ARC-1 Design System Architecture
Team decision needed: Which frontend framework?

Constraints:
- Must support real-time updates
- Team expertise: React, Vue, Svelte
- Bundle size matters for initial load
- Need TypeScript support`}
        placeholder="choose a frontend framework or explain alternative"
        options={['React', 'Vue 3', 'Svelte', 'SolidJS', 'Other (please specify)']}
        onSubmit={async (value) => {
          console.log('Framework choice:', value);
          setChoiceOpen(false);
        }}
        onClose={() => setChoiceOpen(false)}
      />
    </div>
  );
}
