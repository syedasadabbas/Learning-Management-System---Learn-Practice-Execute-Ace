CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'suppressed', 'bounced');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('quiz_submitted', 'exam_completed', 'assignment_feedback', 'penalty_issued', 'forum_reply', 'badge_earned', 'grade_posted', 'course_message');--> statement-breakpoint
CREATE TYPE "public"."activity_action" AS ENUM('login', 'login_failed', 'logout', 'password_change', 'password_reset_request', 'password_reset_confirm', 'profile_update', 'quiz_submit', 'exam_start', 'exam_submit', 'problem_attempt', 'learn_step_complete', 'code_execute', 'submission_ingest', 'submission_graded', 'role_change', 'cohort_change', 'course_access_decision', 'video_decision', 'deadline_change', 'quiz_authored', 'penalty_issued', 'attendance_recorded', 'report_export', 'jobs_requeued', 'activity_export', 'activity_export_denied', 'activity_pruned');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "badge_awards" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"type" varchar(48) NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"quiz_submitted" boolean DEFAULT true NOT NULL,
	"exam_completed" boolean DEFAULT true NOT NULL,
	"assignment_feedback" boolean DEFAULT true NOT NULL,
	"penalty_issued" boolean DEFAULT true NOT NULL,
	"forum_reply" boolean DEFAULT true NOT NULL,
	"badge_earned" boolean DEFAULT true NOT NULL,
	"grade_posted" boolean DEFAULT true NOT NULL,
	"course_message" boolean DEFAULT true NOT NULL,
	"digest_daily" boolean DEFAULT false NOT NULL,
	"digest_weekly" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "notification_type" NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"recipient_email" varchar(320) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"body_template" text NOT NULL,
	"logo_path" varchar(500),
	"accent_color" varchar(7) DEFAULT '#4f5bd5' NOT NULL,
	"font_family" varchar(100) DEFAULT 'Helvetica' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"template_id" integer,
	"verification_code" varchar(64) NOT NULL,
	"recipient_name" varchar(255) NOT NULL,
	"course_title" varchar(255) NOT NULL,
	"weeks_completed" integer NOT NULL,
	"weeks_total" integer NOT NULL,
	"score_points" integer NOT NULL,
	"max_score_points" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer,
	"revocation_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_solution" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" integer,
	"removal_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"created_by" integer NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" integer,
	"removal_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_role" varchar(32),
	"action" "activity_action" NOT NULL,
	"status" "activity_status" DEFAULT 'success' NOT NULL,
	"entity_type" varchar(50),
	"entity_id" integer,
	"ip_prefix" varchar(45),
	"client_family" varchar(120),
	"correlation_id" varchar(64),
	"details" jsonb,
	"error_code" varchar(64),
	"dedupe_key" varchar(200),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_prerequisite_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"unmet_at_grant" varchar(1000),
	"granted_by" integer,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer
);
--> statement-breakpoint
CREATE TABLE "course_prerequisites" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"prerequisite_course_id" integer NOT NULL,
	"min_score" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_prerequisites_no_self" CHECK ("course_prerequisites"."course_id" <> "course_prerequisites"."prerequisite_course_id"),
	CONSTRAINT "course_prerequisites_min_score_range" CHECK ("course_prerequisites"."min_score" IS NULL OR ("course_prerequisites"."min_score" >= 0 AND "course_prerequisites"."min_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "grading_rubrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer,
	"name" varchar(255) NOT NULL,
	"criteria" jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_review_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"submission_id" integer NOT NULL,
	"reviewee_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "peer_review_allocations_no_self_review" CHECK ("peer_review_allocations"."reviewer_id" <> "peer_review_allocations"."reviewee_id")
);
--> statement-breakpoint
CREATE TABLE "peer_review_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"rubric_id" integer NOT NULL,
	"reviews_per_submission" integer DEFAULT 2 NOT NULL,
	"review_due_at" timestamp with time zone NOT NULL,
	"allocated_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_by" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "peer_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"allocation_id" integer NOT NULL,
	"content" text NOT NULL,
	"rubric_scores" jsonb NOT NULL,
	"total_score" integer,
	"visibility" varchar(20) DEFAULT 'anonymous' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"flagged_at" timestamp with time zone,
	"flagged_by" integer,
	"instructor_note" text
);
--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_certificate_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_topic_id_forum_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."forum_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisite_overrides" ADD CONSTRAINT "course_prerequisite_overrides_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisite_overrides" ADD CONSTRAINT "course_prerequisite_overrides_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisite_overrides" ADD CONSTRAINT "course_prerequisite_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisite_overrides" ADD CONSTRAINT "course_prerequisite_overrides_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_prerequisite_course_id_courses_id_fk" FOREIGN KEY ("prerequisite_course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_rubrics" ADD CONSTRAINT "grading_rubrics_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_rubrics" ADD CONSTRAINT "grading_rubrics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_allocations" ADD CONSTRAINT "peer_review_allocations_round_id_peer_review_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."peer_review_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_allocations" ADD CONSTRAINT "peer_review_allocations_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_allocations" ADD CONSTRAINT "peer_review_allocations_reviewee_id_users_id_fk" FOREIGN KEY ("reviewee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_allocations" ADD CONSTRAINT "peer_review_allocations_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_rubric_id_grading_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."grading_rubrics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_allocation_id_peer_review_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."peer_review_allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "peer_reviews" ADD CONSTRAINT "peer_reviews_flagged_by_users_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "badge_awards_student_type_idx" ON "badge_awards" USING btree ("student_id","type");--> statement-breakpoint
CREATE INDEX "badge_awards_student_awarded_idx" ON "badge_awards" USING btree ("student_id","awarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "certificate_templates_active_idx" ON "certificate_templates" USING btree ("is_active","id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_student_course_idx" ON "certificates" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "certificates_verification_code_idx" ON "certificates" USING btree ("verification_code");--> statement-breakpoint
CREATE INDEX "certificates_student_idx" ON "certificates" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "forum_posts_topic_idx" ON "forum_posts" USING btree ("topic_id","created_at");--> statement-breakpoint
CREATE INDEX "forum_posts_author_idx" ON "forum_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "forum_topics_week_idx" ON "forum_topics" USING btree ("week_id","is_pinned");--> statement-breakpoint
CREATE INDEX "forum_topics_created_by_idx" ON "forum_topics" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "activity_logs_actor_time_idx" ON "activity_logs" USING btree ("actor_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_action_time_idx" ON "activity_logs" USING btree ("action","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_entity_idx" ON "activity_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "activity_logs_occurred_at_brin_idx" ON "activity_logs" USING brin ("occurred_at") WITH (pages_per_range=32);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_logs_dedupe_key_idx" ON "activity_logs" USING btree ("dedupe_key") WHERE "activity_logs"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "course_prerequisite_overrides_live_idx" ON "course_prerequisite_overrides" USING btree ("student_id","course_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "course_prerequisite_overrides_student_course_idx" ON "course_prerequisite_overrides" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE INDEX "course_prerequisite_overrides_granted_at_idx" ON "course_prerequisite_overrides" USING btree ("granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "course_prerequisites_edge_idx" ON "course_prerequisites" USING btree ("course_id","prerequisite_course_id");--> statement-breakpoint
CREATE INDEX "course_prerequisites_course_idx" ON "course_prerequisites" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "grading_rubrics_assignment_idx" ON "grading_rubrics" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_review_allocations_pair_idx" ON "peer_review_allocations" USING btree ("submission_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "peer_review_allocations_reviewer_idx" ON "peer_review_allocations" USING btree ("reviewer_id","round_id");--> statement-breakpoint
CREATE INDEX "peer_review_allocations_round_idx" ON "peer_review_allocations" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_review_rounds_assignment_idx" ON "peer_review_rounds" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "peer_reviews_allocation_idx" ON "peer_reviews" USING btree ("allocation_id");--> statement-breakpoint
CREATE INDEX "peer_reviews_flagged_idx" ON "peer_reviews" USING btree ("flagged_at");