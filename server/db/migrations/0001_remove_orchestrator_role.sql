-- merge orchestrator role into pm. existing tasks created under the old role
-- are re-homed on pm so the kanban does not orphan them after the ROLES enum
-- shrinks at the application layer.
UPDATE "olympus_tasks" SET "role" = 'pm' WHERE "role" = 'orchestrator';
--> statement-breakpoint
DELETE FROM "olympus_agents" WHERE "role" = 'orchestrator';
