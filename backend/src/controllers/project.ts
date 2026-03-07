import type { Request, Response } from 'express';
import { dbService as db, storageService } from '../core/container';

export const getProjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Fetch conversations and their latest slide's theme data
        const query = `
            SELECT 
                c.id, 
                c.title as name, 
                c.created_at as "createdAt", 
                c.updated_at as "updatedAt",
                s.theme_data
            FROM conversations c
            LEFT JOIN LATERAL (
                SELECT theme_data 
                FROM slides 
                WHERE conversation_id = c.id 
                ORDER BY created_at ASC 
                LIMIT 1
            ) s ON true
            WHERE c.user_id = $1
            ORDER BY c.created_at DESC
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
            return {
                id: row.id,
                name: row.name,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                theme,
                thumbnailUrl
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

        const defaultTitle = 'New Project';

        // 1. Create conversation record in postgres
        const convResult = await db.query(
            'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at, updated_at',
            [userId, defaultTitle]
        );
        const conversation = convResult.rows[0];
        const projectId = conversation.id;

        // 2. Upload skeleton HTML file to S3
        const s3Key = `users/${userId}/${projectId}.html`;
        const skeletonHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${defaultTitle}</title>
</head>
<body>
</body>
</html>`;

        await storageService.uploadFile(s3Key, skeletonHtml, 'text/html');

        // 3. Create a slide record linking the conversation to the S3 file
        await db.query(
            'INSERT INTO slides (conversation_id, minio_object_key) VALUES ($1, $2)',
            [projectId, s3Key]
        );

        // 4. Return the new project in the same shape as getProjects
        res.status(201).json({
            project: {
                id: projectId,
                name: conversation.title,
                createdAt: conversation.created_at,
                updatedAt: conversation.updated_at,
                theme: 'Professional',
                thumbnailUrl: undefined,
            }
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
