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

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as authController from './src/controllers/auth';
import * as userController from './src/controllers/user';
import * as projectController from './src/controllers/project';
import { requireAuth, type AuthRequest } from './src/middleware/auth';
import { dbService as db } from './src/core/container';
import { loadDesignForProject, saveDesignForProject } from './src/services/projectDeck';
import { config } from './src/config';
import { mountCrdtWebsocket } from './src/routes/crdtWebsocket';
import { uploadsRouter } from './src/routes/uploads';
import { chatRouter } from './src/routes/chat';
import { rowToBlocks } from './src/core/conversationBlocks';
import http from 'http';

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use('/api', uploadsRouter);
// Auth Routes
app.post('/api/auth/google', authController.googleAuth);
app.post('/api/auth/refresh', authController.refreshToken);
app.post('/api/auth/logout', authController.logout);
// User Routes
app.get('/api/user/me', requireAuth, userController.getMe);
app.put('/api/user/me', requireAuth, userController.updateMe);
app.patch('/api/user/profile', requireAuth, userController.updateProfile);
app.delete('/api/user/me', requireAuth, userController.deleteUser);
// Project Routes
app.get('/api/projects', requireAuth, projectController.getProjects);
app.post('/api/projects', requireAuth, projectController.createProject);
app.patch('/api/projects/:projectId/name', requireAuth, projectController.updateProjectName);
app.post('/api/projects/:projectId/preview', requireAuth, projectController.generateProjectPreview);
app.delete('/api/projects/:projectId', requireAuth, projectController.deleteProject);
app.get('/api/conversations', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const userId = req.user!.userId;
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
        const query = projectId
            ? `
                SELECT
                    c.id,
                    c.project_id AS "projectId",
                    c.title,
                    COALESCE(p.name, 'Untitled Project') AS "projectName",
                    c.created_at AS "createdAt",
                    c.updated_at AS "updatedAt"
                FROM conversations c
                LEFT JOIN projects p ON p.id = c.project_id
                WHERE c.user_id = $1 AND c.project_id = $2
                ORDER BY c.updated_at DESC, c.created_at DESC
            `
            : `
                SELECT
                    c.id,
                    c.project_id AS "projectId",
                    c.title,
                    COALESCE(p.name, 'Untitled Project') AS "projectName",
                    c.created_at AS "createdAt",
                    c.updated_at AS "updatedAt"
                FROM conversations c
                LEFT JOIN projects p ON p.id = c.project_id
                WHERE c.user_id = $1
                ORDER BY c.updated_at DESC, c.created_at DESC
            `;
        const params = projectId ? [userId, projectId] : [userId];
        const result = await db.query(
            query,
            params
        );
        const conversations = result.rows.map((row: any) => ({
            id: row.id,
            projectId: row.projectId,
            title: row.title,
            projectName: row.projectName,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
        res.json({ conversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.use("/api", chatRouter);
// Conversation Message History Route (Protected)
app.get('/api/conversations/:conversationId/messages', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const { conversationId } = req.params;
        const userId = req.user!.userId;
        // Verify ownership and fetch title
        const convResult = await db.query(
            `
                SELECT
                    c.user_id,
                    c.title,
                    COALESCE(p.name, 'Untitled Project') AS project_name
                FROM conversations c
                LEFT JOIN projects p ON p.id = c.project_id
                WHERE c.id = $1
            `,
            [conversationId]
        );
        if (convResult.rows.length === 0 || convResult.rows[0].user_id !== userId) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        const messagesResult = await db.query(
            'SELECT id, role, blocks, content, tool_calls, tool_results, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [conversationId]
        );
        const messages = messagesResult.rows.map((row: any) => ({
            id: row.id,
            role: row.role,
            // Always returned as an ordered MessageBlock[]. Legacy rows are
            // synthesized from the old (content, tool_calls, tool_results) triplet
            // — best-effort ordering only, since the original interleaving wasn't
            // preserved before the blocks column existed.
            blocks: rowToBlocks(row),
            createdAt: row.created_at,
        }));
        res.json({
            messages,
            title: convResult.rows[0].title ?? 'Untitled',
            projectName: convResult.rows[0].project_name ?? 'Untitled Project'
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Error fetching conversation messages' });
    }
});
// Update Conversation Title Route (Protected)
app.patch('/api/conversations/:conversationId/title', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const { conversationId } = req.params;
        const { title } = req.body;
        const userId = req.user!.userId;
        if (!title || typeof title !== 'string') {
            res.status(400).json({ error: 'title is required' });
            return;
        }
        const check = await db.query(
            'SELECT user_id FROM conversations WHERE id = $1',
            [conversationId]
        );
        if (check.rows.length === 0 || check.rows[0].user_id !== userId) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }
        await db.query(
            'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
            [title.trim(), conversationId]
        );
        await db.query(
            `
                UPDATE projects p
                SET updated_at = NOW()
                FROM conversations c
                WHERE c.id = $1 AND p.id = c.project_id
            `,
            [conversationId]
        );
        res.json({ title: title.trim() });
    } catch (error) {
        console.error('Error updating conversation title:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Design Document Route (Protected)
app.get('/api/projects/:projectId/design', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const projectId = req.params.projectId as string;
        const userId = req.user!.userId;
        const projResult = await db.query(
            'SELECT p.id FROM projects p JOIN conversations c ON c.project_id = p.id WHERE p.id = $1 AND c.user_id = $2 LIMIT 1', 
            [projectId, userId]
        );
        if (projResult.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        const designContent = await loadDesignForProject(projectId);
        res.json({ design: designContent });
    } catch (error) {
        console.error('Error fetching design:', error);
        res.status(500).json({ error: 'Error fetching design document' });
    }
});

app.put('/api/projects/:projectId/design', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const projectId = req.params.projectId as string;
        const { design } = req.body;
        const userId = req.user!.userId;
        
        if (typeof design !== 'string') {
            res.status(400).json({ error: 'design content is required' });
            return;
        }

        const projResult = await db.query(
            'SELECT p.id FROM projects p JOIN conversations c ON c.project_id = p.id WHERE p.id = $1 AND c.user_id = $2 LIMIT 1', 
            [projectId, userId]
        );
        if (projResult.rows.length === 0) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }

        await saveDesignForProject(projectId, design);
        res.json({ success: true });
    } catch (error) {
        console.error('Error saving design:', error);
        res.status(500).json({ error: 'Error saving design document' });
    }
});
if (require.main === module) {
    const server = http.createServer(app);
    mountCrdtWebsocket(server);
    server.listen(config.port, () => {
      console.log(`Backend server running on port ${config.port}`);
      console.log(`CRDT WebSocket mounted at /ws/presentation/:projectId`);
    });
}
export default app;
