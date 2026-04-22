CREATE TYPE "public"."olympus_agent_status" AS ENUM('idle', 'working', 'blocked', 'offline');--> statement-breakpoint
CREATE TYPE "public"."olympus_event_type" AS ENUM('code-chunk', 'state', 'log', 'chat', 'workspace-change', 'task-update');--> statement-breakpoint
CREATE TYPE "public"."olympus_project_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."olympus_task_status" AS ENUM('todo', 'in-progress', 'pending-review', 'blocked-needs-input', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "olympus_agents" (
	"role" text PRIMARY KEY NOT NULL,
	"status" "olympus_agent_status" DEFAULT 'idle' NOT NULL,
	"current_task_id" uuid,
	"current_project_id" uuid,
	"position" jsonb DEFAULT '{"x":0,"y":0}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "olympus_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text,
	"task_id" uuid,
	"type" "olympus_event_type" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "olympus_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"brief" text NOT NULL,
	"workspace_dir" text NOT NULL,
	"status" "olympus_project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "olympus_projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "olympus_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "olympus_task_status" DEFAULT 'todo' NOT NULL,
	"depends_on" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thread_id" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"result" jsonb,
	"blocked_reason" text,
	"parent_task_id" uuid,
	"iteration" integer DEFAULT 0 NOT NULL,
	"max_iterations_override" integer,
	"user_notes" text,
	"model_tier" text,
	"model_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "olympus_tasks" ADD CONSTRAINT "olympus_tasks_project_id_olympus_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."olympus_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_project_created_idx" ON "olympus_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_slug_idx" ON "olympus_projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tasks_status_role_idx" ON "olympus_tasks" USING btree ("status","role");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "olympus_tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "olympus_tasks" USING btree ("parent_task_id");