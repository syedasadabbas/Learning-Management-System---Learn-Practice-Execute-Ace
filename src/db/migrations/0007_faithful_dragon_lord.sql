CREATE TABLE "class_qa_votes" (
	"question_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_qa_votes_question_id_user_id_pk" PRIMARY KEY("question_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "class_chat" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_chat" ADD COLUMN "reactions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "class_qa" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_qa_votes" ADD CONSTRAINT "class_qa_votes_question_id_class_qa_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."class_qa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_qa_votes" ADD CONSTRAINT "class_qa_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_qa_votes_user_idx" ON "class_qa_votes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "class_chat" ADD CONSTRAINT "class_chat_deleted_consistent" CHECK (("class_chat"."deleted_at" IS NOT NULL) = "class_chat"."is_deleted");--> statement-breakpoint
ALTER TABLE "class_chat" ADD CONSTRAINT "class_chat_deleted_after_created" CHECK ("class_chat"."deleted_at" IS NULL OR "class_chat"."deleted_at" >= "class_chat"."created_at");--> statement-breakpoint
ALTER TABLE "class_qa" ADD CONSTRAINT "class_qa_resolved_after_asked" CHECK ("class_qa"."resolved_at" IS NULL OR "class_qa"."resolved_at" >= "class_qa"."created_at");