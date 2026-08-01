CREATE TYPE "public"."execution_mode" AS ENUM('browser', 'piston', 'none');--> statement-breakpoint
CREATE TYPE "public"."proficiency_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."quiz_kind" AS ENUM('practice', 'grand', 'realtime');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('password_reset', 'email_verify');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('candidate', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."question_type" ADD VALUE 'code_write';--> statement-breakpoint
ALTER TYPE "public"."question_type" ADD VALUE 'code_fix';--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coding_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"problem_id" integer NOT NULL,
	"code" text NOT NULL,
	"language" varchar(32) NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"execution" "execution_mode" DEFAULT 'browser' NOT NULL,
	"runtime_ms" integer,
	"stderr" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coding_problem_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"problem_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"input" text,
	"expected_output" text,
	"hidden" boolean DEFAULT true NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coding_problems" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"title" varchar(255) NOT NULL,
	"statement" text NOT NULL,
	"track" varchar(64) NOT NULL,
	"level" "proficiency_level" DEFAULT 'beginner' NOT NULL,
	"is_interview" boolean DEFAULT false NOT NULL,
	"language" varchar(32) NOT NULL,
	"starter_code" text,
	"reference_solution" text,
	"hints" jsonb,
	"tags" jsonb,
	"execution" "execution_mode" DEFAULT 'browser' NOT NULL,
	"time_limit_ms" integer DEFAULT 5000 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(120) NOT NULL,
	"track" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"summary" text,
	"level" "proficiency_level" DEFAULT 'beginner' NOT NULL,
	"estimated_minutes" integer,
	"order_index" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"step_id" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"module_id" integer NOT NULL,
	"step_number" integer NOT NULL,
	"kind" varchar(24) DEFAULT 'explain' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"starter_code" text,
	"language" varchar(32),
	"execution" "execution_mode" DEFAULT 'none' NOT NULL,
	"expectation" jsonb
);
--> statement-breakpoint
CREATE TABLE "topic_videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_key" varchar(120) NOT NULL,
	"youtube_id" varchar(32) NOT NULL,
	"title" varchar(500),
	"channel_title" varchar(255),
	"duration_seconds" integer,
	"status" "video_status" DEFAULT 'candidate' NOT NULL,
	"source" varchar(16) DEFAULT 'curated' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "code_answer" text;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "awarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "max_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "topic_key" varchar(120);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "language" varchar(32);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "starter_code" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "tests" jsonb;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "auto_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quizzes" ADD COLUMN "kind" "quiz_kind" DEFAULT 'practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_attempts" ADD CONSTRAINT "coding_attempts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_attempts" ADD CONSTRAINT "coding_attempts_problem_id_coding_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."coding_problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coding_problem_tests" ADD CONSTRAINT "coding_problem_tests_problem_id_coding_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."coding_problems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_step_id_learning_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."learning_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_steps" ADD CONSTRAINT "learning_steps_module_id_learning_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."learning_modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_videos" ADD CONSTRAINT "topic_videos_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_idx" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "coding_attempts_student_problem_idx" ON "coding_attempts" USING btree ("student_id","problem_id");--> statement-breakpoint
CREATE INDEX "coding_problem_tests_problem_idx" ON "coding_problem_tests" USING btree ("problem_id","hidden");--> statement-breakpoint
CREATE UNIQUE INDEX "coding_problems_slug_idx" ON "coding_problems" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "coding_problems_browse_idx" ON "coding_problems" USING btree ("track","level","is_interview","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_modules_slug_idx" ON "learning_modules" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "learning_modules_track_idx" ON "learning_modules" USING btree ("track","level","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_progress_student_step_idx" ON "learning_progress" USING btree ("student_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_steps_module_step_idx" ON "learning_steps" USING btree ("module_id","step_number");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_videos_topic_video_idx" ON "topic_videos" USING btree ("topic_key","youtube_id");--> statement-breakpoint
CREATE INDEX "topic_videos_topic_status_idx" ON "topic_videos" USING btree ("topic_key","status");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_attempt_question_idx" ON "answers" USING btree ("attempt_id","question_id");--> statement-breakpoint
CREATE INDEX "lectures_topic_idx" ON "lectures" USING btree ("topic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_student_quiz_number_idx" ON "quiz_attempts" USING btree ("student_id","quiz_id","attempt_number");