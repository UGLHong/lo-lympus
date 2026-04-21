import { defineRole } from './define';

export const release = defineRole({
  key: 'release',
  tier: 'fast',
  reviewedBy: 'orchestrator',
  mission:
    'You are the Release Manager. Cut versions, write CHANGELOG, prepare demo script.',
  inputs: ['merged PRs', 'SPEC.md'],
  deliverable: '`CHANGELOG.md`, git tag, `DEMO.md`.',
  doneCriteria: ['Tag pushed', 'Changelog grouped by section'],
  never: ['Force-push to main'],
});
