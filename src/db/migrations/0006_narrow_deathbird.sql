CREATE TYPE "public"."class_status" AS ENUM('scheduled', 'active', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'system', 'poll', 'announcement');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('not_started', 'recording', 'processing', 'available', 'failed');--> statement-breakpoint
CREATE TYPE "public"."presentation_feedback_type" AS ENUM('peer', 'instructor', 'self');--> statement-breakpoint
CREATE TYPE "public"."presentation_submission_type" AS ENUM('recorded', 'live', 'document');--> statement-breakpoint
CREATE TABLE "assignment_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"sample_order" integer DEFAULT 0 NOT NULL,
	"sample_output_html" text,
	"screenshot_url" varchar(500),
	"code_example" jsonb,
	"live_url" varchar(500),
	"features" jsonb,
	"video_walkthrough_url" varchar(500),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_samples_order_non_negative" CHECK ("assignment_samples"."sample_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lecture_id" integer,
	"week_id" integer,
	"title" varchar(255) NOT NULL,
	"difficulty_level" "proficiency_level" DEFAULT 'intermediate' NOT NULL,
	"category" varchar(50),
	"question_text" text NOT NULL,
	"context" text,
	"sample_answer" text NOT NULL,
	"answer_explanation" text,
	"common_mistakes" jsonb,
	"follow_up_questions" jsonb,
	"visual_walkthrough_html" text,
	"code_example" text,
	"related_concepts" jsonb,
	"related_practice_id" integer,
	"question_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interview_questions_exactly_one_parent" CHECK (("interview_questions"."lecture_id" IS NULL) <> ("interview_questions"."week_id" IS NULL)),
	CONSTRAINT "interview_questions_order_non_negative" CHECK ("interview_questions"."question_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lecture_visualizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"lecture_id" integer NOT NULL,
	"topic_key" varchar(120),
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"svg_markup" text,
	"animation_spec" jsonb,
	"interactive_data" jsonb,
	"explanation" text,
	"learning_point" text,
	"width_px" integer,
	"height_px" integer,
	"is_interactive" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_visualizations_order_non_negative" CHECK ("lecture_visualizations"."order_index" >= 0),
	CONSTRAINT "lecture_visualizations_size_positive" CHECK (("lecture_visualizations"."width_px" IS NULL OR "lecture_visualizations"."width_px" > 0) AND ("lecture_visualizations"."height_px" IS NULL OR "lecture_visualizations"."height_px" > 0))
);
--> statement-breakpoint
CREATE TABLE "practice_problems" (
	"id" serial PRIMARY KEY NOT NULL,
	"lecture_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"difficulty_level" "proficiency_level" DEFAULT 'beginner' NOT NULL,
	"learning_objectives" jsonb,
	"problem_context" text NOT NULL,
	"problem_statement" text NOT NULL,
	"acceptance_criteria" jsonb,
	"starter_code" text,
	"starter_language" varchar(32),
	"hints" jsonb NOT NULL,
	"solution_code" text,
	"solution_explanation" text,
	"solution_screenshot_url" varchar(500),
	"test_cases" jsonb,
	"execution_mode" "execution_mode" DEFAULT 'browser' NOT NULL,
	"problem_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_problems_order_non_negative" CHECK ("practice_problems"."problem_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "class_attendance" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"time_present_minutes" integer,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	"screen_share_count" integer DEFAULT 0 NOT NULL,
	"marked_present" boolean DEFAULT true NOT NULL,
	"participation_score" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "class_attendance_left_after_joined" CHECK ("class_attendance"."left_at" IS NULL OR "class_attendance"."left_at" >= "class_attendance"."joined_at"),
	CONSTRAINT "class_attendance_time_present_non_negative" CHECK ("class_attendance"."time_present_minutes" IS NULL OR "class_attendance"."time_present_minutes" >= 0),
	CONSTRAINT "class_attendance_counters_non_negative" CHECK ("class_attendance"."messages_sent" >= 0 AND "class_attendance"."questions_asked" >= 0 AND "class_attendance"."screen_share_count" >= 0),
	CONSTRAINT "class_attendance_participation_in_range" CHECK ("class_attendance"."participation_score" >= 0 AND "class_attendance"."participation_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "class_chat" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"message" text NOT NULL,
	"message_type" "message_type" DEFAULT 'text' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"parent_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	CONSTRAINT "class_chat_edited_after_created" CHECK ("class_chat"."edited_at" IS NULL OR "class_chat"."edited_at" >= "class_chat"."created_at"),
	CONSTRAINT "class_chat_no_self_parent" CHECK ("class_chat"."parent_message_id" IS NULL OR "class_chat"."parent_message_id" <> "class_chat"."id")
);
--> statement-breakpoint
CREATE TABLE "class_qa" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"instructor_id" integer,
	"question" text NOT NULL,
	"is_answered" boolean DEFAULT false NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_qa_upvotes_non_negative" CHECK ("class_qa"."upvotes" >= 0),
	CONSTRAINT "class_qa_answered_consistent" CHECK (("class_qa"."answered_at" IS NOT NULL) = "class_qa"."is_answered"),
	CONSTRAINT "class_qa_answered_after_asked" CHECK ("class_qa"."answered_at" IS NULL OR "class_qa"."answered_at" >= "class_qa"."created_at")
);
--> statement-breakpoint
CREATE TABLE "class_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"file_name" varchar(500),
	"file_path" varchar(500),
	"file_size_mb" integer,
	"duration_seconds" integer,
	"recording_started_at" timestamp with time zone,
	"recording_ended_at" timestamp with time zone,
	"transcription" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"hls_url" varchar(500),
	"dash_url" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "class_recordings_ends_after_starts" CHECK ("class_recordings"."recording_ended_at" IS NULL OR "class_recordings"."recording_started_at" IS NULL OR "class_recordings"."recording_ended_at" > "class_recordings"."recording_started_at"),
	CONSTRAINT "class_recordings_size_non_negative" CHECK ("class_recordings"."file_size_mb" IS NULL OR "class_recordings"."file_size_mb" >= 0),
	CONSTRAINT "class_recordings_duration_non_negative" CHECK ("class_recordings"."duration_seconds" IS NULL OR "class_recordings"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_id" integer NOT NULL,
	"lecture_id" integer,
	"instructor_id" integer NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"status" "class_status" DEFAULT 'scheduled' NOT NULL,
	"jitsi_room_name" varchar(255),
	"jitsi_password" varchar(255),
	"enable_recording" boolean DEFAULT true NOT NULL,
	"recording_url" varchar(500),
	"recording_status" "recording_status" DEFAULT 'not_started' NOT NULL,
	"max_participants" integer,
	"allow_chat" boolean DEFAULT true NOT NULL,
	"allow_qa" boolean DEFAULT true NOT NULL,
	"allow_screen_share" boolean DEFAULT true NOT NULL,
	"attendance_count" integer DEFAULT 0 NOT NULL,
	"engagement_score" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "live_classes_duration_positive" CHECK ("live_classes"."duration_minutes" > 0),
	CONSTRAINT "live_classes_attendance_non_negative" CHECK ("live_classes"."attendance_count" >= 0),
	CONSTRAINT "live_classes_max_participants_positive" CHECK ("live_classes"."max_participants" IS NULL OR "live_classes"."max_participants" > 0),
	CONSTRAINT "live_classes_ends_after_starts" CHECK ("live_classes"."ended_at" IS NULL OR "live_classes"."started_at" IS NULL OR "live_classes"."ended_at" > "live_classes"."started_at"),
	CONSTRAINT "live_classes_engagement_in_range" CHECK ("live_classes"."engagement_score" IS NULL OR ("live_classes"."engagement_score" >= 0 AND "live_classes"."engagement_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "presentation_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"presentation_id" integer NOT NULL,
	"from_user_id" integer NOT NULL,
	"to_user_id" integer NOT NULL,
	"feedback_type" "presentation_feedback_type" DEFAULT 'peer' NOT NULL,
	"comment" text NOT NULL,
	"rating" integer,
	"category" varchar(50),
	"improvement_suggestions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presentation_feedback_rating_in_range" CHECK ("presentation_feedback"."rating" IS NULL OR ("presentation_feedback"."rating" >= 1 AND "presentation_feedback"."rating" <= 5)),
	CONSTRAINT "presentation_feedback_self_typed" CHECK (("presentation_feedback"."from_user_id" = "presentation_feedback"."to_user_id") = ("presentation_feedback"."feedback_type" = 'self'))
);
--> statement-breakpoint
CREATE TABLE "presentation_slides" (
	"id" serial PRIMARY KEY NOT NULL,
	"presentation_id" integer NOT NULL,
	"slide_number" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255),
	"body" text,
	"speaker_notes" text,
	"content_json" jsonb,
	"layout" varchar(50),
	"background_color" varchar(7),
	"background_image_url" varchar(500),
	"text_color" varchar(7),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presentation_slides_number_positive" CHECK ("presentation_slides"."slide_number" > 0),
	CONSTRAINT "presentation_slides_hex_colors" CHECK (("presentation_slides"."background_color" IS NULL OR "presentation_slides"."background_color" ~ '^#[0-9A-Fa-f]{6}$') AND ("presentation_slides"."text_color" IS NULL OR "presentation_slides"."text_color" ~ '^#[0-9A-Fa-f]{6}$'))
);
--> statement-breakpoint
CREATE TABLE "presentation_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"assignment_id" integer NOT NULL,
	"presentation_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"submission_type" "presentation_submission_type" DEFAULT 'recorded' NOT NULL,
	"video_url" varchar(500),
	"video_duration_seconds" integer,
	"presentation_date" timestamp with time zone,
	"audience_count" integer,
	"score" integer,
	"feedback" text,
	"rubric_scores" jsonb,
	"graded_by" integer,
	"graded_at" timestamp with time zone,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "submission_status" DEFAULT 'submitted' NOT NULL,
	CONSTRAINT "presentation_submissions_score_in_range" CHECK ("presentation_submissions"."score" IS NULL OR ("presentation_submissions"."score" >= 0 AND "presentation_submissions"."score" <= 100)),
	CONSTRAINT "presentation_submissions_duration_non_negative" CHECK ("presentation_submissions"."video_duration_seconds" IS NULL OR "presentation_submissions"."video_duration_seconds" >= 0),
	CONSTRAINT "presentation_submissions_audience_non_negative" CHECK ("presentation_submissions"."audience_count" IS NULL OR "presentation_submissions"."audience_count" >= 0),
	CONSTRAINT "presentation_submissions_grade_consistent" CHECK (("presentation_submissions"."graded_at" IS NULL AND "presentation_submissions"."score" IS NULL) OR ("presentation_submissions"."graded_at" IS NOT NULL AND "presentation_submissions"."score" IS NOT NULL)),
	CONSTRAINT "presentation_submissions_graded_after_submitted" CHECK ("presentation_submissions"."graded_at" IS NULL OR "presentation_submissions"."graded_at" >= "presentation_submissions"."submitted_at")
);
--> statement-breakpoint
CREATE TABLE "presentations" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" integer NOT NULL,
	"assignment_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text,
	"theme" varchar(50) DEFAULT 'default' NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"slides_json" jsonb NOT NULL,
	"show_speaker_notes" boolean DEFAULT true NOT NULL,
	"show_slide_numbers" boolean DEFAULT true NOT NULL,
	"allow_export" boolean DEFAULT true NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"shared_with_roles" jsonb,
	"related_class_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"presentation_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "presentations_counters_non_negative" CHECK ("presentations"."view_count" >= 0 AND "presentations"."presentation_count" >= 0),
	CONSTRAINT "presentations_published_consistent" CHECK (("presentations"."published_at" IS NOT NULL) = "presentations"."is_published")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "samples_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "functional_requirements" jsonb;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "acceptance_criteria_visual" jsonb;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "rubric_with_examples" jsonb;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "sample_screenshots" jsonb;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "is_enhanced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "learning_objectives" text;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "estimated_duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "difficulty_level" "proficiency_level" DEFAULT 'beginner';--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "visualizations_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "practice_problems_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "is_enhanced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "explanation_html" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "correct_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "incorrect_analysis" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "deeper_learning_resources" jsonb;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "is_enhanced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_samples" ADD CONSTRAINT "assignment_samples_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_samples" ADD CONSTRAINT "assignment_samples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_related_practice_id_practice_problems_id_fk" FOREIGN KEY ("related_practice_id") REFERENCES "public"."practice_problems"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_visualizations" ADD CONSTRAINT "lecture_visualizations_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_visualizations" ADD CONSTRAINT "lecture_visualizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_problems" ADD CONSTRAINT "practice_problems_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_class_id_live_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_attendance" ADD CONSTRAINT "class_attendance_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_chat" ADD CONSTRAINT "class_chat_class_id_live_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_chat" ADD CONSTRAINT "class_chat_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_chat" ADD CONSTRAINT "class_chat_parent_message_id_class_chat_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."class_chat"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_qa" ADD CONSTRAINT "class_qa_class_id_live_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_qa" ADD CONSTRAINT "class_qa_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_qa" ADD CONSTRAINT "class_qa_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_recordings" ADD CONSTRAINT "class_recordings_class_id_live_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."live_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_classes" ADD CONSTRAINT "live_classes_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_feedback" ADD CONSTRAINT "presentation_feedback_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_feedback" ADD CONSTRAINT "presentation_feedback_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_feedback" ADD CONSTRAINT "presentation_feedback_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_slides" ADD CONSTRAINT "presentation_slides_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_submissions" ADD CONSTRAINT "presentation_submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_submissions" ADD CONSTRAINT "presentation_submissions_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_submissions" ADD CONSTRAINT "presentation_submissions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_submissions" ADD CONSTRAINT "presentation_submissions_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_related_class_id_live_classes_id_fk" FOREIGN KEY ("related_class_id") REFERENCES "public"."live_classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_samples_assignment_idx" ON "assignment_samples" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "assignment_samples_created_at_idx" ON "assignment_samples" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_samples_order_idx" ON "assignment_samples" USING btree ("assignment_id","sample_order");--> statement-breakpoint
CREATE INDEX "interview_questions_lecture_idx" ON "interview_questions" USING btree ("lecture_id");--> statement-breakpoint
CREATE INDEX "interview_questions_week_idx" ON "interview_questions" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "interview_questions_difficulty_idx" ON "interview_questions" USING btree ("difficulty_level");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_questions_lecture_order_idx" ON "interview_questions" USING btree ("lecture_id","question_order") WHERE "interview_questions"."lecture_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_questions_week_order_idx" ON "interview_questions" USING btree ("week_id","question_order") WHERE "interview_questions"."week_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lecture_visualizations_lecture_idx" ON "lecture_visualizations" USING btree ("lecture_id","order_index");--> statement-breakpoint
CREATE INDEX "lecture_visualizations_topic_idx" ON "lecture_visualizations" USING btree ("topic_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_visualizations_order_idx" ON "lecture_visualizations" USING btree ("lecture_id","order_index");--> statement-breakpoint
CREATE INDEX "practice_problems_lecture_idx" ON "practice_problems" USING btree ("lecture_id");--> statement-breakpoint
CREATE INDEX "practice_problems_difficulty_idx" ON "practice_problems" USING btree ("difficulty_level");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_problems_order_idx" ON "practice_problems" USING btree ("lecture_id","problem_order");--> statement-breakpoint
CREATE UNIQUE INDEX "class_attendance_class_student_idx" ON "class_attendance" USING btree ("class_id","student_id");--> statement-breakpoint
CREATE INDEX "class_attendance_class_idx" ON "class_attendance" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "class_attendance_student_idx" ON "class_attendance" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "class_attendance_class_joined_idx" ON "class_attendance" USING btree ("class_id","joined_at");--> statement-breakpoint
CREATE INDEX "class_chat_class_created_idx" ON "class_chat" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE INDEX "class_chat_sender_idx" ON "class_chat" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "class_chat_parent_idx" ON "class_chat" USING btree ("parent_message_id");--> statement-breakpoint
CREATE INDEX "class_qa_class_created_idx" ON "class_qa" USING btree ("class_id","created_at");--> statement-breakpoint
CREATE INDEX "class_qa_class_unanswered_idx" ON "class_qa" USING btree ("class_id","is_answered","upvotes");--> statement-breakpoint
CREATE INDEX "class_qa_student_idx" ON "class_qa" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_recordings_class_idx" ON "class_recordings" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "class_recordings_public_created_idx" ON "class_recordings" USING btree ("is_public","created_at");--> statement-breakpoint
CREATE INDEX "live_classes_week_idx" ON "live_classes" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "live_classes_instructor_idx" ON "live_classes" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX "live_classes_status_idx" ON "live_classes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "live_classes_scheduled_idx" ON "live_classes" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "live_classes_status_scheduled_idx" ON "live_classes" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "live_classes_recording_status_idx" ON "live_classes" USING btree ("recording_status");--> statement-breakpoint
CREATE INDEX "presentation_feedback_presentation_created_idx" ON "presentation_feedback" USING btree ("presentation_id","created_at");--> statement-breakpoint
CREATE INDEX "presentation_feedback_to_user_idx" ON "presentation_feedback" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "presentation_feedback_from_user_idx" ON "presentation_feedback" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "presentation_feedback_type_idx" ON "presentation_feedback" USING btree ("feedback_type");--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_slides_number_idx" ON "presentation_slides" USING btree ("presentation_id","slide_number");--> statement-breakpoint
CREATE INDEX "presentation_slides_presentation_idx" ON "presentation_slides" USING btree ("presentation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presentation_submissions_assignment_student_idx" ON "presentation_submissions" USING btree ("assignment_id","student_id");--> statement-breakpoint
CREATE INDEX "presentation_submissions_student_idx" ON "presentation_submissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "presentation_submissions_assignment_idx" ON "presentation_submissions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "presentation_submissions_assignment_status_idx" ON "presentation_submissions" USING btree ("assignment_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "presentation_submissions_presentation_idx" ON "presentation_submissions" USING btree ("presentation_id");--> statement-breakpoint
CREATE INDEX "presentations_creator_idx" ON "presentations" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "presentations_assignment_idx" ON "presentations" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "presentations_published_idx" ON "presentations" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "presentations_template_idx" ON "presentations" USING btree ("is_template");--> statement-breakpoint
CREATE INDEX "presentations_related_class_idx" ON "presentations" USING btree ("related_class_id");--> statement-breakpoint
CREATE INDEX "presentations_published_at_idx" ON "presentations" USING btree ("is_published","published_at");--> statement-breakpoint
CREATE INDEX "lectures_enhanced_idx" ON "lectures" USING btree ("is_enhanced");