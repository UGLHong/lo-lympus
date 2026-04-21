import type { ModelTier, RoleKey } from '@/lib/const/roles';

export type RoleDefinition = {
  key: RoleKey;
  tier: ModelTier;
  /** Used when `ROLE_MODEL_<ROLE>` env is unset. `tier:fast` / `openrouter:model` / bare model id. */
  modelSpec?: string;
  /** Tried in order after primary when the LLM errors before any streamed token. */
  modelFallbackSpecs?: string[];
  reviewedBy: RoleKey | null;
  mission: string;
  inputs: string[];
  deliverable: string;
  doneCriteria: string[];
  never: string[];
};

export function defineRole(definition: RoleDefinition): RoleDefinition {
  return definition;
}
