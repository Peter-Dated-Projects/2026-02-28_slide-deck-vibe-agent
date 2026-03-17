import type { Request, Response } from 'express';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';
import { ensureDeckExistsForProject, generatePreviewForProject } from '../services/projectDeck';

const PROJECTS_CACHE_PREFIX = 'projects:list:';
const PROJECTS_CACHE_TTL_SECONDS = Math.max(5, Math.min(config.redis.ttlSeconds, 30));

const getProjectsCacheKey = (userId: string): string => `${PROJECTS_CACHE_PREFIX}${userId}`;

const invalidateProjectsCache = async (userId: string): Promise<void> => {
    try {
        await cacheService.del(getProjectsCacheKey(userId));
    } catch (error) {
        console.warn(`[projectController] Failed to invalidate projects cache for user ${userId}:`, error);
    }
};

export const getProjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const cacheKey = getProjectsCacheKey(userId);
        try {
            const cachedPayload = await cacheService.get(cacheKey);
            if (cachedPayload) {
                const cachedProjects = JSON.parse(cachedPayload);
                res.json({ projects: cachedProjects });
                return;
            }
        } catch (error) {
            console.warn(`[projectController] Failed to read projects cache for user ${userId}:`, error);
        }

        // Fetch projects, and rely on the latest conversation dynamically.
        // Or if we just rely on `projects` being the top layer.
        // In the new schema:
        // project owner is implied by the first conversation in conversation_ids, or we could join
        // For security, project belong to the user of the conversations.
        const query = `
            SELECT 
                p.id, 
                p.theme_data ->> 'name' as project_name,
                p.created_at as "createdAt", 
                p.updated_at as "updatedAt",
                p.theme_data ->> 'preview_url' as preview_url,
                p.theme_data,
                p.conversation_ids
            FROM projects p
            JOIN conversations c ON c.id = p.conversation_ids[1]
            WHERE c.user_id = $1
            ORDER BY p.created_at DESC
        `;

        const result = await db.query(query, [userId]);

        const projects = await Promise.all(result.rows.map(async (row: any) => {
            let theme = 'Professional';
            let thumbnailUrl: string | undefined;
            let resolvedName = typeof row.project_name === 'string' ? row.project_name.trim() : '';

            if (!resolvedName) {
                resolvedName = `Project ${String(row.id).slice(0, 8)}`;
            }

            if (!row.project_name) {
                await db.query(
                    `
                        UPDATE projects
                        SET theme_data = COALESCE(theme_data, '{}'::jsonb) || jsonb_build_object('name', to_jsonb($2::text))
                        WHERE id = $1
                    `,
                    [row.id, resolvedName]
                );
            }

            if (row.preview_url) {
                try {
                    thumbnailUrl = await storageService.getFileUrl(row.preview_url);
                } catch (error) {
                    console.error(`[projectController] Failed to sign preview URL for project ${row.id}:`, error);
                }
            }

            if (row.theme_data) {
                const data = typeof row.theme_data === 'string' ? JSON.parse(row.theme_data) : row.theme_data;
                theme = data.theme || 'Professional';
            }
            
            // Just use the latest conversation ID for the routing link instead of the first
            const latestConversationId = row.conversation_ids[row.conversation_ids.length - 1];
            
            return {
                id: row.id,
                name: resolvedName,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                theme,
                thumbnailUrl,
                latest_conversation_id: latestConversationId
            };
        }));

        try {
            await cacheService.set(cacheKey, JSON.stringify(projects), PROJECTS_CACHE_TTL_SECONDS);
        } catch (error) {
            console.warn(`[projectController] Failed to set projects cache for user ${userId}:`, error);
        }

        res.json({ projects });
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createProject = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const defaultTitle = 'New Chat';
        const defaultProjectName = 'Untitled Project';

        // 1. Create project first (we need to generate its UUID upfront, or return it)
        // Wait, project needs `minio_object_key`. We'll just generate the DB id first.
        const projResult = await db.query(
             'INSERT INTO projects (minio_object_key) VALUES ($1) RETURNING id',
             ['temp']
        );
        const projectId = projResult.rows[0].id;
        
        // 2. Create conversation record
        const convResult = await db.query(
            'INSERT INTO conversations (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id, title, created_at, updated_at',
            [userId, projectId, defaultTitle]
        );
        const conversation = convResult.rows[0];
        
        // 3. Update project with the conversation ID
        await db.query(
               `
                  UPDATE projects
                  SET
                    conversation_ids = ARRAY[$1]::UUID[],
                    theme_data = COALESCE(theme_data, '{}'::jsonb) || jsonb_build_object('name', to_jsonb($3::text))
                  WHERE id = $2
               `,
               [conversation.id, projectId, defaultProjectName]
        );

        // 4. Ensure the project deck is seeded from backend/src/core/template.html in S3 and cached.
        await ensureDeckExistsForProject(projectId, userId);
        await invalidateProjectsCache(userId);

        res.status(201).json({
            project: {
                id: projectId,
                name: defaultProjectName,
                createdAt: conversation.created_at,
                updatedAt: conversation.updated_at,
                theme: 'Professional',
                thumbnailUrl: undefined,
                latest_conversation_id: conversation.id
            }
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const generateProjectPreview = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        const rawProjectId = req.params.projectId;
        const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!projectId) {
            res.status(400).json({ error: 'Project ID is required' });
            return;
        }

        const ownerCheck = await db.query(
            'SELECT 1 FROM conversations WHERE project_id = $1 AND user_id = $2 LIMIT 1',
            [projectId, userId]
        );

        if (ownerCheck.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        if (process.env.PREVIEW_DEBUG !== 'false' && process.env.PREVIEW_DEBUG !== '0') {
            console.info('[projectController][debug] Preview request accepted', {
                projectId,
                userId
            });
        }

        // Fire-and-forget: preview generation can be expensive and should not block the request.
        void generatePreviewForProject(projectId, userId).catch((error) => {
            console.error(`Error generating project preview for project ${projectId}:`, error);
        }).finally(() => {
            void invalidateProjectsCache(userId);
        });

        res.status(202).json({ success: true });
    } catch (error) {
        console.error('Error generating project preview:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateProjectName = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        const rawProjectId = req.params.projectId;
        const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;
        const { name } = req.body;

        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (!projectId) {
            res.status(400).json({ error: 'Project ID is required' });
            return;
        }

        if (typeof name !== 'string') {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            res.status(400).json({ error: 'name is required' });
            return;
        }

        const ownership = await db.query(
            'SELECT 1 FROM conversations WHERE project_id = $1 AND user_id = $2 LIMIT 1',
            [projectId, userId]
        );

        if (ownership.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        await db.query(
            `
                UPDATE projects
                SET
                    theme_data = COALESCE(theme_data, '{}'::jsonb) || jsonb_build_object('name', to_jsonb($2::text)),
                    updated_at = NOW()
                WHERE id = $1
            `,
            [projectId, trimmedName]
        );

        await invalidateProjectsCache(userId);

        res.json({ name: trimmedName });
    } catch (error) {
        console.error('Error updating project name:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
