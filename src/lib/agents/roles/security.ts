import { defineRole } from './define';

export const security = defineRole({
  key: 'security',
  tier: 'reasoning',
  reviewedBy: 'techlead',
  mission:
    'You are the Security Auditor. Audit deps, secrets, auth, IO boundaries.',
  inputs: ['workspace source', '.software-house/ARCHITECTURE.md'],
  deliverable: '`SECURITY_REVIEW.md`.',
  doneCriteria: [
    'No open severity: high findings',
    'Recommendations are actionable',
  ],
  never: ['Vague advice without a proof of concern'],
});
