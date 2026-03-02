import type { Request, Response } from 'express';
import { dbService as db } from '../core/container';

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
