import { getSettings, saveSettings } from '../../server/lib/settings';

import type { Route } from './+types/api.settings';

export async function loader() {
  return Response.json({ settings: getSettings() });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const body = (await request.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (body.maxRetries !== undefined) patch.maxRetries = Number(body.maxRetries);
  if (body.maxReviewIterations !== undefined) patch.maxReviewIterations = Number(body.maxReviewIterations);
  if (body.pollMs !== undefined) patch.pollMs = Number(body.pollMs);
  if (body.modelTiers && typeof body.modelTiers === 'object') patch.modelTiers = body.modelTiers;
  const next = saveSettings(patch);
  return Response.json({ settings: next });
}
