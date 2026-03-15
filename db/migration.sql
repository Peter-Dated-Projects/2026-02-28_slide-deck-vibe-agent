BEGIN;

-- 1. Rename slides to projects
ALTER TABLE slides RENAME TO projects;

-- 2. Modify conversation_id to conversation_ids array
ALTER TABLE projects ADD COLUMN conversation_ids UUID[] DEFAULT '{}';
UPDATE projects SET conversation_ids = ARRAY[conversation_id];
ALTER TABLE projects DROP COLUMN conversation_id;

-- 3. Add project_id to conversations table
ALTER TABLE conversations ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- 4. Set project_id in conversations
UPDATE conversations c 
SET project_id = p.id 
FROM projects p
WHERE c.id = ANY(p.conversation_ids);

-- 5. Store generated preview location for dashboard thumbnails
ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview_url TEXT;

COMMIT;
