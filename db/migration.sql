BEGIN;

-- 1. Rename slides to projects when upgrading legacy schema.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'slides'
	) AND NOT EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'projects'
	) THEN
		EXECUTE 'ALTER TABLE slides RENAME TO projects';
	END IF;
END $$;

-- 2. Convert legacy projects.conversation_id -> projects.conversation_ids.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'projects'
	) THEN
		IF NOT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'conversation_ids'
		) THEN
			EXECUTE 'ALTER TABLE projects ADD COLUMN conversation_ids UUID[] DEFAULT ''{}''';
		END IF;

		IF EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'conversation_id'
		) THEN
			EXECUTE 'UPDATE projects SET conversation_ids = ARRAY[conversation_id] WHERE conversation_id IS NOT NULL';
			EXECUTE 'ALTER TABLE projects DROP COLUMN conversation_id';
		END IF;
	END IF;
END $$;

-- 3. Add conversations.project_id and backfill from projects.conversation_ids.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'conversations'
	) THEN
		IF NOT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'project_id'
		) THEN
			EXECUTE 'ALTER TABLE conversations ADD COLUMN project_id UUID REFERENCES projects(id) ON DELETE CASCADE';
		END IF;

		IF EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'projects'
		) THEN
			EXECUTE '
				UPDATE conversations c
				SET project_id = p.id
				FROM projects p
				WHERE c.project_id IS NULL
				  AND c.id = ANY(p.conversation_ids)
			';
		END IF;
	END IF;
END $$;

-- 4. Store generated preview location for dashboard thumbnails.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'projects'
	) THEN
		EXECUTE 'ALTER TABLE projects ADD COLUMN IF NOT EXISTS preview_url TEXT';
	END IF;
END $$;

-- 5. Persist per-conversation task checklist for agent runtime continuity.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'conversations'
	) THEN
		EXECUTE 'ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_list JSONB';
		EXECUTE 'UPDATE conversations SET task_list = ''[]''::jsonb WHERE task_list IS NULL';
		EXECUTE 'ALTER TABLE conversations ALTER COLUMN task_list SET DEFAULT ''[]''::jsonb';
		EXECUTE 'ALTER TABLE conversations ALTER COLUMN task_list SET NOT NULL';
	END IF;
END $$;

COMMIT;
