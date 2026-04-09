-- Phase 3 Memory: Add pgvector embedding column to chat_messages
--
-- Decision: pgvector IS available on Neon (v0.8.0).
-- Verified 2026-04-08 via: SELECT * FROM pg_available_extensions WHERE name = 'vector';
-- Result: name=vector, default_version=0.8.0, installed_version=NULL
--
-- This migration enables the vector extension and adds a 512-dimensional
-- embedding column to chat_messages for semantic recall search.
-- The IVFFlat index uses cosine distance (vector_cosine_ops).
--
-- NOTE: IVFFlat requires at least (lists * 39) rows to build properly.
-- With lists=100 that means ~3,900 rows with non-null embeddings before
-- the index becomes effective. Until then Postgres will use a sequential
-- scan, which is fine for early traffic.
--
-- DO NOT apply to prod until the embedding writer service is ready.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "chat_messages" ADD COLUMN "embedding" vector(512);

CREATE INDEX "idx_chat_messages_embedding"
  ON "chat_messages"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);
