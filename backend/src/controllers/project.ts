import type { Request, Response } from 'express';
import { dbService as db } from '../core/container';
import { ensureDeckExistsForProject } from '../services/projectDeck';

export const getProjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Fetch projects, and rely on the latest conversation dynamically.
        // Or if we just rely on `projects` being the top layer.
        // In the new schema:
        // project owner is implied by the first conversation in conversation_ids, or we could join
        // For security, project belong to the user of the conversations.
        const query = `
            SELECT 
                p.id, 
                c.title as name, 
                p.created_at as "createdAt", 
                p.updated_at as "updatedAt",
                p.theme_data,
                p.conversation_ids
            FROM projects p
            JOIN conversations c ON c.id = p.conversation_ids[1]
            WHERE c.user_id = $1
            ORDER BY p.created_at DESC
        `;

        const result = await db.query(query, [userId]);

        const projects = result.rows.map((row: any) => {
            let theme = 'Professional';
            let thumbnailUrl = undefined;
            if (row.theme_data) {
                const data = typeof row.theme_data === 'string' ? JSON.parse(row.theme_data) : row.theme_data;
                theme = data.theme || 'Professional';
                thumbnailUrl = data.preview_url;
            }
            
            // Just use the latest conversation ID for the routing link instead of the first
            const latestConversationId = row.conversation_ids[row.conversation_ids.length - 1];
            
            return {
                id: row.id,
                name: row.name,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                theme,
                thumbnailUrl,
                latest_conversation_id: latestConversationId
            };
        });

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
             'UPDATE projects SET conversation_ids = ARRAY[$1]::UUID[] WHERE id = $2',
             [conversation.id, projectId]
        );

        // 4. Ensure the project deck is seeded from frontend/public/default.html in S3 and cached.
        await ensureDeckExistsForProject(projectId, userId);

        res.status(201).json({
            project: {
                id: projectId,
                name: conversation.title,
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
