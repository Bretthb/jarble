-- Fractal Piece 6: distinguish personal chats from team delegation sessions
ALTER TABLE "chat_sessions" ADD COLUMN "origin_type" varchar(20) DEFAULT 'user' NOT NULL;
ALTER TABLE "chat_sessions" ADD COLUMN "origin_caller_deployment_id" varchar(255);
ALTER TABLE "chat_sessions" ADD COLUMN "origin_task" text;
