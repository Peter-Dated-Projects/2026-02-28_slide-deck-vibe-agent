import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as authController from './src/controllers/auth';
import * as userController from './src/controllers/user';
import * as projectController from './src/controllers/project';
import { requireAuth, type AuthRequest } from './src/middleware/auth';
import { dbService as db } from './src/core/container';
import { chatWithAgent, chatWithAgentStream } from './src/services/agent';
import { config } from './src/config';

const app = express();

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

        // Create conversation if it doesn't exist
        if (!currentConvId) {
            const convResult = await db.query(
                'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
                [userId, message.substring(0, 50) + '...']
            );
            currentConvId = convResult.rows[0].id;
        }

        // Save user message
        await db.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [currentConvId, 'user', JSON.stringify({ text: message })]
        );

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
            
            const msg: any = { role: row.role as string, content: text };
            if (row.tool_calls) msg.tool_calls = row.tool_calls;
            if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
            if (row.tool_results) msg.tool_results = row.tool_results;
            if (raw?.thinkTimers) msg.thinkTimers = raw.thinkTimers;
            
            return msg;
        });

        // Call Agent
        let agentResponse = await chatWithAgent(currentConvId, messagesContext);
        
        // Save Final Assistant Response
        if (agentResponse.content && agentResponse.content.length > 0) {
             await db.query(
                'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [currentConvId, 'assistant', JSON.stringify(agentResponse.content)]
            );
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

        // Create conversation if needed
        if (!currentConvId) {
            const convResult = await db.query(
                'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
                [userId, message.substring(0, 50) + '...']
            );
            currentConvId = convResult.rows[0].id;
        }

        // Save user message
        await db.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [currentConvId, 'user', JSON.stringify({ text: message })]
        );

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
            const msg: any = { role: row.role as string, content: text };
            if (row.tool_calls) msg.tool_calls = row.tool_calls;
            if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
            if (row.tool_results) msg.tool_results = row.tool_results;
            if (raw?.thinkTimers) msg.thinkTimers = raw.thinkTimers;
            
            return msg;
        });

        const streamedToolCalls: any[] = [];
        const streamedToolResults: any[] = [];
        const contentBlocks: any[] = [];
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
                    }
                } catch {
                    // Keep streaming even if one metadata chunk is malformed.
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
                        }
                    } catch {
                        // Keep streaming even if one metadata chunk is malformed.
                    }
                } else {
                    // It's a text token. Coalesce into the latest text block or think block
                    accumulatedText += token;
                    
                    // We can either try to build the blocks live during streaming, or just parse accumulatedText 
                    // at the end, BUT if we parse accumulatedText at the end, we lose the chronological interleaving 
                    // with tool calls. So we should build the text blocks live.
                    
                    const lastBlock = contentBlocks[contentBlocks.length - 1];
                    const isThinking = accumulatedText.lastIndexOf("<think>") > accumulatedText.lastIndexOf("</think>");
                    
                    if (isThinking) {
                        // Currently inside a thinking block
                        if (lastBlock?.type === "think") {
                            lastBlock.text += token;
                        } else {
                            // Strip <think> from the new block's text since we just entered it
                            const cleanText = token.replace("<think>", "").replace("</think>", "");
                            const newThinkTimer = { startTime: Date.now() };
                            thinkTimers.push(newThinkTimer);
                            contentBlocks.push({ type: "think", text: cleanText, startTime: newThinkTimer.startTime });
                        }
                    } else {
                        // Currently inside normal text
                        // Check if we just exited a think block
                        if (lastBlock?.type === "think" && token.includes("</think>")) {
                            // Close the think block timers
                            const timer = thinkTimers[thinkTimers.length - 1];
                            if (timer && !timer.endTime) timer.endTime = Date.now();
                            lastBlock.endTime = timer?.endTime;
                            
                            // Any text after </think> goes into a new text block
                            const afterThink = token.substring(token.indexOf("</think>") + 8);
                            if (afterThink) {
                                contentBlocks.push({ type: "text", text: afterThink });
                            }
                        } else if (lastBlock?.type === "text") {
                            lastBlock.text += token;
                        } else {
                            // Wait, what if `<think>` is in this token but we didn't end up `isThinking` because `</think>` is also in it?
                            // This means a think block started and ended in the exact same token chunk.
                            if (token.includes("<think>") && token.includes("</think>")) {
                                const beforeText = token.substring(0, token.indexOf("<think>"));
                                const thinkText = token.substring(token.indexOf("<think>") + 7, token.indexOf("</think>"));
                                const afterText = token.substring(token.indexOf("</think>") + 8);
                                
                                if (beforeText) {
                                    if (lastBlock?.type === "text") lastBlock.text += beforeText;
                                    else contentBlocks.push({ type: "text", text: beforeText });
                                }
                                
                                const timer = { startTime: Date.now(), endTime: Date.now() };
                                thinkTimers.push(timer);
                                contentBlocks.push({ type: "think", text: thinkText, startTime: timer.startTime, endTime: timer.endTime });
                                
                                if (afterText) {
                                    contentBlocks.push({ type: "text", text: afterText });
                                }
                            } else {
                                contentBlocks.push({ type: "text", text: token });
                            }
                        }
                    }
                }
            }
            send('token', JSON.stringify({ token }));
        });

        // Persist full response and tool metadata
        if (fullText || streamedToolCalls.length > 0 || streamedToolResults.length > 0) {
            // contentBlocks is already fully interleaved and chronologically ordered from the stream loop above!

            await db.query(
                'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_results) VALUES ($1, $2, $3, $4, $5)',
                [
                    currentConvId,
                    'assistant',
                    JSON.stringify(contentBlocks),
                    streamedToolCalls.length > 0 ? JSON.stringify(streamedToolCalls) : null,
                    streamedToolResults.length > 0 ? JSON.stringify(streamedToolResults) : null,
                ]
            );
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
            'SELECT user_id, title FROM conversations WHERE id = $1',
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

        res.json({ messages, title: convResult.rows[0].title ?? 'Untitled' });
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

        res.json({ title: title.trim() });
    } catch (error) {
        console.error('Error updating conversation title:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Presentation Data Route (Protected)
app.get('/api/presentation/:conversationId', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
     try {
         const { conversationId } = req.params;
         const userId = req.user!.userId;

         const convResult = await db.query('SELECT user_id FROM conversations WHERE id = $1', [conversationId]);
         if (convResult.rows.length === 0 || convResult.rows[0].user_id !== userId) {
             res.status(404).json({ error: 'Presentation not found' });
             return;
         }

         const slidesResult = await db.query('SELECT minio_object_key, theme_data FROM slides WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId]);
         
         res.json({
             slides: slidesResult.rows
         });
     } catch (error) {
         res.status(500).json({ error: 'Error fetching presentation' });
     }
});


if (require.main === module) {
    app.listen(config.port, () => {
      console.log(`Backend server running on port ${config.port}`);
    });
}

export default app;
