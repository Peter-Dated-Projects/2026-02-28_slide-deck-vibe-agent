import express from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { dbService as db } from '../core/container';
import { runAgent, type AgentEvent } from '../services/agent';
import { isOverBudget, runCompressionPass } from '../services/buildContext';
import { CRDT_SYSTEM_INSTRUCTION } from '../core/crdt/crdtTools';
import type { ChatMessage } from '../core/agentTypes';
import { rowsToHistory } from '../core/conversationBlocks';

export const chatRouter = express.Router();

chatRouter.post('/chat/stream', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    const { message, conversationId: incomingConvId, projectId: incomingProjectId } = req.body ?? {};
    const userId = req.user!.userId;
    if (typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Message is required' });
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (eventName: string, data: unknown) => {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const convId = await ensureConversation(userId, incomingConvId, incomingProjectId, message);
        const conversationMeta = await loadConversationMeta(convId);
        sendEvent('conversation', {
            conversationId: convId,
            projectId: conversationMeta.projectId,
            title: conversationMeta.title,
            projectName: conversationMeta.projectName,
        });

        await db.query(
            'INSERT INTO messages (conversation_id, role, content, blocks) VALUES ($1, $2, $3, $4)',
            [
                convId,
                'user',
                JSON.stringify({ text: message }),
                JSON.stringify([{ type: 'text', text: message }]),
            ]
        );
        await touchActivity(convId);

        // Compression pass (silent — happens server-side before agent runs)
        const baseHistory = await loadHistoryForModel(convId);
        if (isOverBudget(CRDT_SYSTEM_INSTRUCTION, baseHistory)) {
            sendEvent('compression_started', {});
            const ok = await runCompressionPass(convId);
            sendEvent('compression_done', { ok });
        }

        const history = await loadHistoryForModel(convId);

        let mutatedAny = false;

        const onEvent = (event: AgentEvent) => {
            switch (event.type) {
                case 'text_delta':
                    sendEvent('text_delta', { text: event.text });
                    break;
                case 'thinking_delta':
                    sendEvent('thinking_delta', { text: event.text });
                    break;
                case 'tool_call':
                    sendEvent('tool_call', event.call);
                    break;
                case 'tool_result':
                    if (event.mutated) {
                        mutatedAny = true;
                        sendEvent('presentation_updated', {});
                    }
                    sendEvent('tool_result', { id: event.id, result: event.result });
                    break;
                case 'error':
                    sendEvent('error', { message: event.message });
                    break;
            }
        };

        const result = await runAgent({
            conversationId: convId,
            history,
            onEvent,
        });

        // Persist one row per assistant turn — keeps the original interleaving of
        // text / thinking / tool_call / tool_result inside each row's `blocks` array.
        const turnsToPersist = result.turns.length > 0
            ? result.turns
            : (result.finalText
                ? [[{ type: 'text' as const, text: result.finalText }]]
                : []);
        for (const turnBlocks of turnsToPersist) {
            if (turnBlocks.length === 0) continue;
            await db.query(
                'INSERT INTO messages (conversation_id, role, blocks) VALUES ($1, $2, $3)',
                [convId, 'assistant', JSON.stringify(turnBlocks)]
            );
        }
        if (turnsToPersist.length > 0) await touchActivity(convId);

        if (mutatedAny) sendEvent('presentation_updated', {});
        sendEvent('done', { conversationId: convId });
        res.end();
    } catch (err) {
        console.error('[chat/stream] error', err);
        sendEvent('error', { message: 'Error processing your request' });
        res.end();
    }
});

async function ensureConversation(
    userId: string,
    incomingConvId: string | undefined,
    incomingProjectId: string | undefined,
    firstMessage: string
): Promise<string> {
    if (incomingConvId) {
        // First message in this conversation? Set the title.
        const existing = await db.query(
            'SELECT 1 FROM messages WHERE conversation_id = $1 LIMIT 1',
            [incomingConvId]
        );
        if (existing.rows.length === 0) {
            await db.query(
                'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
                [titleFromFirstMessage(firstMessage), incomingConvId]
            );
        }
        return incomingConvId;
    }
    if (!incomingProjectId) {
        throw new Error('projectId or conversationId is required');
    }
    const created = await db.query(
        'INSERT INTO conversations (user_id, project_id, title) VALUES ($1, $2, $3) RETURNING id',
        [userId, incomingProjectId, titleFromFirstMessage(firstMessage)]
    );
    return created.rows[0].id as string;
}

function titleFromFirstMessage(message: string): string {
    return message.trim().slice(0, 150);
}

async function loadConversationMeta(convId: string): Promise<{
    projectId: string | null;
    title: string;
    projectName: string;
}> {
    const r = await db.query(
        `SELECT c.title, c.project_id, COALESCE(p.name, 'Untitled Project') AS project_name
         FROM conversations c LEFT JOIN projects p ON p.id = c.project_id
         WHERE c.id = $1`,
        [convId]
    );
    const row = r.rows[0];
    return {
        projectId: row?.project_id ?? null,
        title: row?.title ?? 'New Chat',
        projectName: row?.project_name ?? 'Untitled Project',
    };
}

async function touchActivity(convId: string): Promise<void> {
    await db.query(
        `WITH updated AS (
             UPDATE conversations SET updated_at = NOW() WHERE id = $1 RETURNING project_id
         )
         UPDATE projects SET updated_at = NOW()
         WHERE id IN (SELECT project_id FROM updated WHERE project_id IS NOT NULL)`,
        [convId]
    );
}

/**
 * Reads uncompressed messages out of the DB and reconstructs a clean
 * ChatMessage[] suitable for the LLM. Thinking blocks are filtered out here —
 * users see them, the model never does.
 */
async function loadHistoryForModel(convId: string): Promise<ChatMessage[]> {
    const res = await db.query(
        `SELECT role, blocks, content, tool_calls, tool_results
         FROM messages
         WHERE conversation_id = $1 AND is_compressed = FALSE
         ORDER BY created_at ASC`,
        [convId]
    );
    return rowsToHistory(res.rows);
}
