CREATE TABLE IF NOT EXISTS "beta_signups" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"experience" varchar(50),
	"use_case" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"invited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
