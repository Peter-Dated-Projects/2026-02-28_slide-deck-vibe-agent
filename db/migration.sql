-- Ordered block log for chat messages.
-- Stores an interleaved [text, thinking, tool_call, tool_result] array per row,
-- preserving the chronological ordering that the streaming UI sees live.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS blocks JSONB;

-- Allow content to be NULL for new block-only rows. Legacy rows keep their value.
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;
