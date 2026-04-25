/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary
 * information of Freedom, LLC ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in accordance
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import type { Request, Response } from 'express';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';
import { generatePreviewForProject } from '../services/previewRenderer';

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
                res.json({ projects: JSON.parse(cachedPayload) });
                return;
            }
        } catch (error) {
            console.warn(`[projectController] Failed to read projects cache for user ${userId}:`, error);
        }

        const result = await db.query(
            `
            SELECT
                p.id,
                p.name AS project_name,
                p.preview_url,
                p.created_at AS "createdAt",
                p.updated_at AS "updatedAt",
                (
                    SELECT c2.id
                    FROM conversations c2
                    WHERE c2.project_id = p.id
                    ORDER BY c2.created_at DESC
                    LIMIT 1
                ) AS latest_conversation_id
            FROM projects p
            WHERE p.id IN (
                SELECT project_id FROM conversations WHERE user_id = $1
            )
            ORDER BY p.created_at DESC
            `,
            [userId]
        );

        const projects = await Promise.all(
            result.rows.map(async (row: any) => {
                let thumbnailUrl: string | undefined;
                if (row.preview_url) {
                    try {
                        thumbnailUrl = await storageService.getFileUrl(row.preview_url);
                    } catch (error) {
                        console.error(
                            `[projectController] Failed to sign preview URL for project ${row.id}:`,
                            error
                        );
                    }
                }
                return {
                    id: row.id,
                    name: row.project_name || `Project ${String(row.id).slice(0, 8)}`,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    thumbnailUrl,
                    latest_conversation_id: row.latest_conversation_id,
                };
            })
        );

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

        const projResult = await db.query(
            'INSERT INTO projects (name) VALUES ($1) RETURNING id, created_at, updated_at',
            [defaultProjectName]
        );
        const { id: projectId, created_at, updated_at } = projResult.rows[0];

        const convResult = await db.query(
            'INSERT INTO conversations (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id',
            [userId, projectId, defaultTitle]
        );
        const conversationId = convResult.rows[0].id;

        await invalidateProjectsCache(userId);
        res.status(201).json({
            project: {
                id: projectId,
                name: defaultProjectName,
                createdAt: created_at,
                updatedAt: updated_at,
                thumbnailUrl: undefined,
                latest_conversation_id: conversationId,
            },
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

        const ownership = await db.query(
            'SELECT 1 FROM conversations WHERE project_id = $1 AND user_id = $2 LIMIT 1',
            [projectId, userId]
        );
        if (ownership.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        // Fire-and-forget: rendering can take several seconds; the frontend polls
        // /api/projects until projects.preview_url appears.
        generatePreviewForProject(projectId)
            .then(() => invalidateProjectsCache(userId))
            .catch((error) => {
                console.error(
                    `[projectController] Preview generation failed for project ${projectId}:`,
                    error
                );
            });

        res.status(202).json({ status: 'pending' });
    } catch (error) {
        console.error('Error scheduling project preview:', error);
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
        if (typeof name !== 'string' || !name.trim()) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const trimmedName = name.trim();

        const ownership = await db.query(
            'SELECT 1 FROM conversations WHERE project_id = $1 AND user_id = $2 LIMIT 1',
            [projectId, userId]
        );
        if (ownership.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        await db.query(
            'UPDATE projects SET name = $2, updated_at = NOW() WHERE id = $1',
            [projectId, trimmedName]
        );
        await invalidateProjectsCache(userId);
        res.json({ name: trimmedName });
    } catch (error) {
        console.error('Error updating project name:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteProject = async (req: Request, res: Response): Promise<void> => {
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

        const ownership = await db.query(
            'SELECT 1 FROM conversations WHERE project_id = $1 AND user_id = $2 LIMIT 1',
            [projectId, userId]
        );
        if (ownership.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
        await invalidateProjectsCache(userId);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
