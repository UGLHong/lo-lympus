import { defineRole } from './define';

export const frontendDev = defineRole({
  key: 'frontend-dev',
  tier: 'coding',
  reviewedBy: 'reviewer',
  mission: 'You are the Frontend Developer. Implement UI changes for assigned tickets.',
  inputs: [
    '.software-house/state.json',
    '.software-house/SPEC.md',
    'the ticket assigned to you',
  ],
  deliverable: 'Code changes on a feature branch + short PR description.',
  doneCriteria: [
    'Components accessible',
    'Visual states match spec',
    'Storybook or screenshot attached',
  ],
  never: ['Ship without a11y review', 'Invent UX not in SPEC'],
});
