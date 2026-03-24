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
import { chatWithAgent, chatWithAgentStream } from './src/services/agent';
import { loadDeckHtmlForProject } from './src/services/projectDeck';
import { config } from './src/config';
const app = express();
const getTitleFromFirstRequest = (message: string) => message.trim().slice(0, 150);
const updateTitleFromFirstRequestIfNeeded = async (
    conversationId: string,
    message: string
) => {
    const existingMessageResult = await db.query(
        'SELECT 1 FROM messages WHERE conversation_id = $1 LIMIT 1',
        [conversationId]
    );
    if (existingMessageResult.rows.length > 0) {
        return;
    }
    const nextTitle = getTitleFromFirstRequest(message);
    if (!nextTitle) {
        return;
    }
    await db.query(
        'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
        [nextTitle, conversationId]
    );
};
const touchConversationActivity = async (conversationId: string) => {
    await db.query(
        `
            WITH updated_conversation AS (
                UPDATE conversations
                SET updated_at = NOW()
                WHERE id = $1
                RETURNING project_id
            )
            UPDATE projects
            SET updated_at = NOW()
            WHERE id IN (
                SELECT project_id
                FROM updated_conversation
                WHERE project_id IS NOT NULL
            )
        `,
        [conversationId]
    );
};
const normalizeAssistantContentBlocks = (blocks: any[]): any[] => {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        return blocks;
    }
    const hasTextBlock = blocks.some((block: any) => {
        if (block?.type !== 'text') return false;
        const value = typeof block?.text === 'string' ? block.text : block?.content;
        return typeof value === 'string' && value.trim().length > 0;
    });
    if (hasTextBlock) {
        return blocks;
    }
    // If model only produced think/tool blocks, promote the final think text into a visible text block.
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i];
        if (block?.type !== 'think') continue;
        const thinkText = typeof block?.text === 'string' ? block.text : block?.content;
        if (typeof thinkText === 'string' && thinkText.trim().length > 0) {
            return [...blocks, { type: 'text', text: thinkText.trim() }];
        }
    }
    return blocks;
};
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
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
                    COALESCE(p.theme_data ->> 'name', 'Untitled Project') AS "projectName",
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
                    COALESCE(p.theme_data ->> 'name', 'Untitled Project') AS "projectName",
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
// Agent Chat Route
app.post('/api/chat', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const { message, conversationId } = req.body;
        const userId = req.user!.userId;
        if (!message) {
            res.status(400).json({ error: 'Message is required' });
            return;
        }
        let currentConvId = conversationId;
        const incomingProjectId = req.body.projectId;
        // Create conversation if it doesn't exist
        if (!currentConvId) {
            // If projectId is provided, link to it; otherwise require it to be created via /api/projects
            if (!incomingProjectId) {
                res.status(400).json({ error: 'projectId or conversationId is required' });
                return;
            }
            const convResult = await db.query(
                'INSERT INTO conversations (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id',
                [userId, incomingProjectId, getTitleFromFirstRequest(message)]
            );
            currentConvId = convResult.rows[0].id;
            // Add conversation to project array
            await db.query(
                'UPDATE projects SET conversation_ids = array_append(conversation_ids, $1::UUID) WHERE id = $2',
                [currentConvId, incomingProjectId]
            );
        }
        await updateTitleFromFirstRequestIfNeeded(currentConvId, message);
        // Save user message
        await db.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [currentConvId, 'user', JSON.stringify({ text: message })]
        );
        await touchConversationActivity(currentConvId);
        // Fetch conversation history
        const historyResult = await db.query(
            'SELECT role, content, tool_calls, tool_call_id, tool_results FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [currentConvId]
        );
        let messagesContext: any[] = historyResult.rows.map((row: any) => {
            const raw = row.content;
            let text: string;
            if (typeof raw === 'string') {
                text = raw;
            } else if (raw?.text) {
                // user messages: { text: "..." }
                text = raw.text;
            } else if (Array.isArray(raw)) {
                // assistant messages blocks
                text = raw.map((b: any) => {
                    if (b.type === 'text') return b.text || b.content || "";
                    if (b.type === 'think') return `<think>\n${b.text || b.content || ""}\n</think>`;
                    return "";
                }).filter(Boolean).join('\n');
            } else {
                text = JSON.stringify(raw);
            }
            return { role: row.role as string, content: text };
        });
        // Call Agent
        let agentResponse = await chatWithAgent(currentConvId, messagesContext);
        // Save Final Assistant Response
        if (agentResponse.content && agentResponse.content.length > 0) {
             await db.query(
                'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [currentConvId, 'assistant', JSON.stringify(agentResponse.content)]
            );
            await touchConversationActivity(currentConvId);
        }
        res.json({
             conversationId: currentConvId,
             response: agentResponse.content
        });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Internal server error processing chat' });
    }
});
// ── Streaming Chat Route (SSE) ──────────────────────────────────────────────
app.post('/api/chat/stream', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    const { message, conversationId } = req.body;
    const userId = req.user!.userId;
    if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
    }
    // SSE headers — disable buffering so tokens arrive immediately
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if proxied
    res.flushHeaders();
    const send = (event: string, data: string) => {
        res.write(`event: ${event}\ndata: ${data}\n\n`);
    };
    try {
        let currentConvId = conversationId;
        const incomingProjectId = req.body.projectId;
        // Create conversation if needed
        if (!currentConvId) {
            if (!incomingProjectId) {
                send('error', JSON.stringify({ message: 'projectId or conversationId is required' }));
                res.end();
                return;
            }
            const convResult = await db.query(
                'INSERT INTO conversations (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id',
                [userId, incomingProjectId, getTitleFromFirstRequest(message)]
            );
            currentConvId = convResult.rows[0].id;
            // Add conversation to project array
            await db.query(
                'UPDATE projects SET conversation_ids = array_append(conversation_ids, $1::UUID) WHERE id = $2',
                [currentConvId, incomingProjectId]
            );
        }
        await updateTitleFromFirstRequestIfNeeded(currentConvId, message);
        const conversationMetaResult = await db.query(
            `
                SELECT
                    c.title,
                    c.project_id,
                    COALESCE(p.theme_data ->> 'name', 'Untitled Project') AS project_name
                FROM conversations c
                LEFT JOIN projects p ON p.id = c.project_id
                WHERE c.id = $1
            `,
            [currentConvId]
        );
        const conversationMeta = conversationMetaResult.rows[0];
        send('conversation', JSON.stringify({
            conversationId: currentConvId,
            projectId: conversationMeta?.project_id ?? incomingProjectId ?? null,
            title: conversationMeta?.title ?? 'New Chat',
            projectName: conversationMeta?.project_name ?? 'Untitled Project'
        }));
        // Save user message
        await db.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [currentConvId, 'user', JSON.stringify({ text: message })]
        );
        await touchConversationActivity(currentConvId);
        // Fetch conversation history
        const historyResult = await db.query(
            'SELECT role, content, tool_calls, tool_call_id, tool_results FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [currentConvId]
        );
        const messagesContext: any[] = historyResult.rows.map((row: any) => {
            const raw = row.content;
            let text: string;
            if (typeof raw === 'string') {
                text = raw;
            } else if (raw?.text) {
                text = raw.text;
            } else if (Array.isArray(raw)) {
                text = raw.map((b: any) => {
                    if (b.type === 'text') return b.text || b.content || "";
                    if (b.type === 'think') return `<think>\n${b.text || b.content || ""}\n</think>`;
                    return "";
                }).filter(Boolean).join('\n');
            } else {
                text = JSON.stringify(raw);
            }
            return { role: row.role as string, content: text };
        });
        const streamedToolCalls: any[] = [];
        const streamedToolResults: any[] = [];
        let contentBlocks: any[] = [];
        let accumulatedText = "";
        const thinkTimers: { startTime: number; endTime?: number }[] = [];
        // Stream tokens to client
        const fullText = await chatWithAgentStream(currentConvId, messagesContext, (token) => {
            if (token.startsWith('[TOOL_CALLS]') && token.endsWith('[/TOOL_CALLS]')) {
                try {
                    const jsonStr = token.substring(12, token.length - 13);
                    const parsed = JSON.parse(jsonStr);
                    if (Array.isArray(parsed.tool_calls)) {
                        streamedToolCalls.push(...parsed.tool_calls);
                        parsed.tool_calls.forEach((tc: any) => contentBlocks.push({ type: 'tool_call', tool_call: tc }));
                        send('tool_calls', JSON.stringify({ tool_calls: parsed.tool_calls }));
                    }
                } catch {
                    // Keep streaming even if one metadata chunk is malformed.
                    send('token_text', JSON.stringify({ token }));
                }
            } else {
                const cleanToken = token.trim();
                if (cleanToken.startsWith('[TOOL_RESULT]') && cleanToken.endsWith('[/TOOL_RESULT]')) {
                    try {
                        const jsonStr = cleanToken.substring(13, cleanToken.length - 14);
                        const parsed = JSON.parse(jsonStr);
                        if (parsed?.id) {
                            streamedToolResults.push(parsed);
                            contentBlocks.push({ type: 'tool_result', id: parsed.id, result: parsed.result });
                            send('tool_result', JSON.stringify({ id: parsed.id, result: parsed.result }));
                        }
                    } catch {
                        // Keep streaming even if one metadata chunk is malformed.
                        send('token_text', JSON.stringify({ token }));
                    }
                } else if (token === '[PRESENTATION_UPDATED]') {
                    send('presentation_updated', JSON.stringify({ updated: true }));
                } else {
                    // It's a text token. Coalesce into the latest text block or think block
                    accumulatedText += token;
                    // The simplest and most robust chronological interleave parser is string-splitting `accumulatedText` in its entirety,
                    // but we must preserve the `tool_call` and `tool_result` blocks that were interleaved.
                    // To do this, we can maintain an array of ONLY the `text` and `think` blocks, and re-generate it fully from `accumulatedText` every tick!
                    const newTextThinkBlocks: any[] = [];
                    let remaining = accumulatedText;
                    let thinkIdx = 0;
                    while (remaining) {
                        const startIdx = remaining.indexOf("<think>");
                        if (startIdx === -1) {
                            if (remaining.trim()) newTextThinkBlocks.push({ type: "text", text: remaining });
                            break;
                        }
                        if (startIdx > 0) {
                            const textBefore = remaining.slice(0, startIdx);
                            if (textBefore.trim()) newTextThinkBlocks.push({ type: "text", text: textBefore });
                        }
                        // We are now at a `<think>` tag. Check if there's a closing tag.
                        const endIdx = remaining.indexOf("</think>", startIdx);
                        if (endIdx === -1) {
                            // Unclosed think block (streaming in progress)
                            const timer = thinkTimers[thinkIdx];
                            newTextThinkBlocks.push({ 
                                type: "think", 
                                text: remaining.slice(startIdx + 7).trim(),
                                startTime: timer?.startTime,
                                endTime: timer?.endTime
                            });
                            break;
                        } else {
                            // Closed think block
                            const timer = thinkTimers[thinkIdx];
                            newTextThinkBlocks.push({ 
                                type: "think", 
                                text: remaining.slice(startIdx + 7, endIdx).trim(),
                                startTime: timer?.startTime,
                                endTime: timer?.endTime ? Math.max(timer.startTime, timer.endTime) : Date.now()
                            });
                            remaining = remaining.slice(endIdx + 8);
                            thinkIdx++;
                        }
                    }
                    // We successfully parsed `newTextThinkBlocks` from `accumulatedText`.
                    // But `contentBlocks` already has elements in it! Some of those might be `tool_call` or `tool_result`!
                    // What do we do? We REPLACE all `text` and `think` blocks in `contentBlocks` with our newly parsed `newTextThinkBlocks`, keeping `tool_` blocks where they were.
                    let textThinkCursor = 0;
                    const reconstructedBlocks: any[] = [];
                    // To do this chronologically: We stream out `contentBlocks`.
                    for (let b of contentBlocks) {
                        if (b.type === 'tool_call' || b.type === 'tool_result') {
                            reconstructedBlocks.push(b);
                        } else {
                            // It was a text/think block. We replace it with the next fresh one.
                            if (textThinkCursor < newTextThinkBlocks.length) {
                                reconstructedBlocks.push(newTextThinkBlocks[textThinkCursor]);
                                textThinkCursor++;
                            }
                        }
                    }
                    // What if there's leftover new text/think blocks that we just parsed (e.g. streaming new text after a tool)?
                    while (textThinkCursor < newTextThinkBlocks.length) {
                        reconstructedBlocks.push(newTextThinkBlocks[textThinkCursor]);
                        textThinkCursor++;
                    }
                    contentBlocks = reconstructedBlocks;
                    send('token_text', JSON.stringify({ token }));
                }
            }
        });
        // Persist full response and tool metadata
        if (fullText || streamedToolCalls.length > 0 || streamedToolResults.length > 0) {
            const normalizedContentBlocks = normalizeAssistantContentBlocks(contentBlocks);
            // To guarantee perfect DB storage, we will re-parse the final `accumulatedText` one last time,
            // meticulously interleaving the stored tool calls. 
            // Wait, we lost the tool call chronological positions if we don't save them.
            // But `contentBlocks` already HAS the chronological positions from the stream!
            // Let's just clean up any hanging trailing blocks.
            // Re-parse the entire sequence based on the finalized `contentBlocks`.
            // The issue is `parseContentBlocks` logic on the frontend handles full strings perfectly.
            // Let's run a robust parser over the final `accumulatedText` here, 
            // and simply insert the `streamedToolCalls` and `streamedToolResults` at the correct indexes (which `contentBlocks` knows).
            await db.query(
                'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results) VALUES ($1, $2, $3, $4, $5)',
                [
                    currentConvId,
                    'assistant',
                    JSON.stringify(normalizedContentBlocks),
                    streamedToolCalls.length > 0 ? JSON.stringify(streamedToolCalls) : null,
                    streamedToolResults.length > 0 ? JSON.stringify(streamedToolResults) : null,
                ]
            );
            await touchConversationActivity(currentConvId);
        }
        // Signal completion
        send('done', JSON.stringify({ conversationId: currentConvId }));
        res.end();
    } catch (error) {
        console.error('Stream chat error:', error);
        send('error', JSON.stringify({ message: 'Error processing your request' }));
        res.end();
    }
});
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
                    COALESCE(p.theme_data ->> 'name', 'Untitled Project') AS project_name
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
            'SELECT id, role, content, tool_calls, tool_results, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [conversationId]
        );
        const messages = messagesResult.rows.map((row: any) => {
            // content is stored as JSONB
            const rawContent = row.content;
            let displayContent: any;
            if (typeof rawContent === 'string') {
                displayContent = rawContent;
            } else if (rawContent?.text) {
                // user messages: { text: "..." }
                displayContent = rawContent.text;
            } else if (Array.isArray(rawContent)) {
                // assistant messages: array of blocks natively injected to frontend
                displayContent = rawContent; 
            } else {
                displayContent = "";
            }
            return {
                id: row.id,
                role: row.role,
                content: displayContent,
                toolCalls: row.tool_calls ?? undefined,
                toolResults: row.tool_results ?? undefined,
                thinkTimers: rawContent?.thinkTimers, // Backward compatibility
                createdAt: row.created_at,
            };
        });
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
// Presentation Data Route (Protected)
app.get('/api/presentation/:projectId', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
     try {
         const { projectId } = req.params;
         const userId = req.user!.userId;
         const projResult = await db.query(
             'SELECT p.id FROM projects p JOIN conversations c ON c.id = ANY(p.conversation_ids) WHERE p.id = $1 AND c.user_id = $2 LIMIT 1', 
             [projectId, userId]
         );
         if (projResult.rows.length === 0) {
             res.status(404).json({ error: 'Presentation not found' });
             return;
         }
         const { html, cacheHit } = await loadDeckHtmlForProject(projectId as string);
         const dbResult = await db.query('SELECT minio_object_key, theme_data FROM projects WHERE id = $1', [projectId]);
         res.json({
             slides: dbResult.rows,
             html,
             cacheHit
         });
     } catch (error) {
         console.error('Error fetching presentation:', error);
         res.status(500).json({ error: 'Error fetching presentation' });
     }
});
if (require.main === module) {
    app.listen(config.port, () => {
      console.log(`Backend server running on port ${config.port}`);
    });
}
export default app;
