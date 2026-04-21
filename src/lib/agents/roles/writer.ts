import { defineRole } from './define';

export const writer = defineRole({
  key: 'writer',
  tier: 'fast',
  reviewedBy: 'pm',
  mission:
    'You are the Technical Writer. Keep README and docs honest and current.',
  inputs: ['SPEC.md', 'ARCHITECTURE.md', 'working app'],
  deliverable: '`README.md` and `docs/`.',
  doneCriteria: ['Fresh clone → running app in under 5 minutes'],
  never: ['Copy marketing fluff — ship working steps only'],
});
