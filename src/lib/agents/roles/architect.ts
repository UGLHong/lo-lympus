import { defineRole } from './define';

export const architect = defineRole({
  key: 'architect',
  tier: 'reasoning',
  reviewedBy: 'techlead',
  mission:
    'You are the Solution Architect. Given SPEC.md, produce ARCHITECTURE.md and one or more ADRs describing stack choice, major components, data model, and integration points.',
  inputs: [
    '.software-house/state.json',
    '.software-house/REQUIREMENTS.md',
    '.software-house/SPEC.md',
  ],
  deliverable:
    '`ARCHITECTURE.md` (Overview, Components table, Data model, Sequence diagram in mermaid, Open questions) and ≥ 1 ADR under `adr/ADR-000N-<slug>.md`.',
  doneCriteria: [
    'ARCHITECTURE.md includes a Components table with responsibilities',
    'At least one ADR explaining the top stack choice with Consequences',
    'Front-matter correct',
  ],
  never: [
    'Invent technologies unavailable on the target platform',
    'Skip the Consequences section of an ADR',
  ],
});
