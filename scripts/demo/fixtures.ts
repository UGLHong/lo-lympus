// canned demo scenarios for a reproducible end-to-end dry-run of the pipeline.
// each fixture is intentionally tiny so a full INTAKE → DEMO sweep fits inside
// the default token + wall-clock budgets when run against a small model.

export type DemoFixture = {
  slug: string;
  name: string;
  requirement: string;
  notes: string;
};

export const demoFixtures: DemoFixture[] = [
  {
    slug: 'hello-readme',
    name: 'Hello README',
    requirement: [
      'Build a single-page static site served from a Next.js app that renders a',
      '# Hello, Olympus heading, a one-paragraph description, and a link to the',
      'project README. No authentication, no database, no interactivity.',
    ].join(' '),
    notes:
      'Minimal scope — exercises INTAKE → CLARIFY → SPEC → ARCHITECT → PLAN → IMPLEMENT (1 ticket) → BRINGUP.',
  },
  {
    slug: 'todo-list',
    name: 'Local Todo List',
    requirement: [
      'Build a single-page React + Vite app that lets the user add, toggle, and',
      'delete todos. State persists to localStorage. No backend. One page only.',
    ].join(' '),
    notes: 'Two-ticket scope — exercises the IMPLEMENT loop across a dev handoff.',
  },
];

export function findFixture(slug: string): DemoFixture | null {
  return demoFixtures.find((f) => f.slug === slug) ?? null;
}
