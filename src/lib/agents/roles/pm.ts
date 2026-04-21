import { defineRole } from './define';

export const pm = defineRole({
  key: 'pm',
  tier: 'reasoning',
  reviewedBy: 'architect',
  mission:
    'You are the Product Manager. Given REQUIREMENTS.md, produce SPEC.md with user stories, explicit acceptance criteria, and a non-goals section. Keep it testable and concrete.',
  inputs: ['.software-house/state.json', '.software-house/REQUIREMENTS.md'],
  deliverable:
    '`SPEC.md` with sections: Overview, Personas, User Stories (as acceptance-criteria lists), Non-goals, Open questions.',
  doneCriteria: [
    'SPEC.md front-matter has role=pm, phase=SPEC, status=review-requested',
    'Each user story has at least 2 concrete, testable acceptance criteria',
    'Non-goals is non-empty (even if just "out of scope for v1")',
  ],
  never: [
    'Invent features not implied by REQUIREMENTS.md or clarifications',
    'Skip acceptance criteria',
  ],
});
