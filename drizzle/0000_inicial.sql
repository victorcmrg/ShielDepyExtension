CREATE TABLE "chaos_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chaos_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repo_id" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"commit_sha" text NOT NULL,
	"branch" text,
	"pr" integer,
	"pr_url" text,
	"run_url" text,
	"status" text NOT NULL,
	"hits" integer NOT NULL,
	"failed" integer NOT NULL,
	"passed" integer NOT NULL,
	"invalid" integer NOT NULL,
	"untested" integer NOT NULL,
	"fail_on" text NOT NULL,
	"engine" text NOT NULL,
	"cost_usd" double precision NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_permissions" (
	"company_id" integer NOT NULL,
	"key" text NOT NULL,
	"value" boolean NOT NULL,
	CONSTRAINT "company_permissions_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "device_auth_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "device_auth_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"state" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" integer,
	"exchange_code_hash" text,
	"exchange_code_expires_at" bigint,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"confirmed_at" bigint,
	"exchanged_at" bigint,
	CONSTRAINT "device_auth_requests_state_unique" UNIQUE("state"),
	CONSTRAINT "device_auth_requests_status" CHECK ("device_auth_requests"."status" in ('pending', 'confirmed', 'exchanged', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "device_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"label" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	"last_used_at" bigint,
	CONSTRAINT "device_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_company_assignments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_company_assignments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"company_id" integer NOT NULL,
	"initial_password_hash" text,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "email_company_assignments_email_unique" UNIQUE("email"),
	CONSTRAINT "email_company_assignments_role" CHECK ("email_company_assignments"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "oauth_identities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_identities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "oauth_identities_provider_user" UNIQUE("provider","provider_user_id"),
	CONSTRAINT "oauth_identities_provider" CHECK ("oauth_identities"."provider" in ('google', 'github'))
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_states_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"state" text NOT NULL,
	"provider" text NOT NULL,
	"redirect_context" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	CONSTRAINT "oauth_states_state_unique" UNIQUE("state"),
	CONSTRAINT "oauth_states_provider" CHECK ("oauth_states"."provider" in ('google', 'github'))
);
--> statement-breakpoint
CREATE TABLE "project_ci_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_ci_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	CONSTRAINT "project_ci_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" integer NOT NULL,
	"email" text NOT NULL,
	"added_at" bigint NOT NULL,
	CONSTRAINT "project_members_project_id_email_pk" PRIMARY KEY("project_id","email")
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_repos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"remote" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "project_repos_project_remote" UNIQUE("project_id","remote")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "projects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_activity" (
	"repo_id" integer NOT NULL,
	"email" text NOT NULL,
	"branch" text,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "repo_activity_repo_id_email_pk" PRIMARY KEY("repo_id","email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text,
	"company_id" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"last_login_at" bigint,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "chaos_runs" ADD CONSTRAINT "chaos_runs_repo_id_project_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_permissions" ADD CONSTRAINT "company_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_auth_requests" ADD CONSTRAINT "device_auth_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_company_assignments" ADD CONSTRAINT "email_company_assignments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_identities" ADD CONSTRAINT "oauth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ci_tokens" ADD CONSTRAINT "project_ci_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_activity" ADD CONSTRAINT "repo_activity_repo_id_project_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."project_repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chaos_runs_repo" ON "chaos_runs" USING btree ("repo_id","created_at" DESC NULLS LAST);