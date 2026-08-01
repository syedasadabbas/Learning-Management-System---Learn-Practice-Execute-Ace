CREATE TABLE "presentation_grade_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"submission_id" integer NOT NULL,
	"score" integer NOT NULL,
	"feedback" text,
	"rubric_scores" jsonb,
	"graded_by" integer,
	"graded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "presentation_grade_events_score_in_range" CHECK ("presentation_grade_events"."score" >= 0 AND "presentation_grade_events"."score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "presentation_grade_events" ADD CONSTRAINT "presentation_grade_events_submission_id_presentation_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."presentation_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentation_grade_events" ADD CONSTRAINT "presentation_grade_events_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presentation_grade_events_submission_graded_at_idx" ON "presentation_grade_events" USING btree ("submission_id","graded_at");