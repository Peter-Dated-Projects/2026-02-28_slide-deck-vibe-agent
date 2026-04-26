import { llmService, dbService as db } from '../core/container';
import type { ChatMessage, ToolSpec } from '../core/agentTypes';

const SLIDING_WINDOW_SIZE = 30;
const COMPRESS_RECENCY_KEEP = 10;
const TOKEN_BUDGET_HEURISTIC = () =>
    Math.floor(parseInt(process.env.CONTEXT_WINDOW_SIZE || '16000', 10) * 0.8);

export interface AssembledContext {
    systemInstruction: string;
    messages: ChatMessage[];
}

const COMPRESS_TOOL: ToolSpec = {
    name: 'compress_history',
    description:
        'Compress an old conversation segment into structured memory. Call this exactly once with both fields populated.',
    parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['edit_log', 'summary'],
        properties: {
            edit_log: {
                type: 'array',
                description:
                    'Up to 10 short bullets capturing every concrete edit, decision, or stated preference from the segment. Mark reverted items with "[reverted]".',
                items: { type: 'string' },
                maxItems: 10,
            },
            summary: {
                type: 'string',
                description:
                    '2-4 sentence summary of what the user is trying to accomplish, key constraints, and where things stand at the end of the segment.',
            },
        },
    },
};

export function assembleContext(
    baseInstruction: string,
    editLog: string,
    summary: string,
    rawMessages: ChatMessage[]
): AssembledContext {
    let systemInstruction = baseInstruction;
    if (editLog || summary) {
        systemInstruction += '\n\n--- Memory ---';
        if (editLog) systemInstruction += `\n\n## Past edits\n${editLog}`;
        if (summary) systemInstruction += `\n\n## Conversation summary\n${summary}`;
    }
    const windowed = rawMessages.slice(-SLIDING_WINDOW_SIZE);
    return { systemInstruction, messages: windowed };
}

export function isOverBudget(
    systemInstruction: string,
    messages: ChatMessage[]
): boolean {
    let chars = systemInstruction.length;
    for (const m of messages) {
        chars += m.content.length;
        if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
    }
    const estimatedTokens = Math.ceil(chars / 4);
    return estimatedTokens >= TOKEN_BUDGET_HEURISTIC();
}

/**
 * Run a compression pass. Asks the LLM to call `compress_history` with structured
 * args; on success, persists `edit_log` + `summary` to the conversation row and
 * marks the compressed messages as `is_compressed = TRUE`.
 *
 * On any failure (LLM didn't call the tool, args missing fields, DB error) this
 * logs and returns false — never throws, never silently succeeds.
 */
export async function runCompressionPass(conversationId: string): Promise<boolean> {
    try {
        const meta = await db.query(
            'SELECT edit_log, summary FROM conversations WHERE id = $1',
            [conversationId]
        );
        if (meta.rows.length === 0) return false;
        const previousEditLog: string = meta.rows[0].edit_log ?? '';
        const previousSummary: string = meta.rows[0].summary ?? '';

        const msgRes = await db.query(
            'SELECT id, role, content FROM messages WHERE conversation_id = $1 AND is_compressed = FALSE ORDER BY created_at ASC',
            [conversationId]
        );
        const all = msgRes.rows;
        if (all.length <= COMPRESS_RECENCY_KEEP) return false;
        const toCompress = all.slice(0, all.length - COMPRESS_RECENCY_KEEP);
        const idsToCompress: string[] = toCompress.map((m: any) => m.id);

        const segment = toCompress
            .map((m: any) => `[${String(m.role).toUpperCase()}]: ${stringifyMessageContent(m.content)}`)
            .join('\n\n');

        const instruction = `You compress conversation history for a slide-deck editing assistant.

You will be given a SEGMENT of older messages plus the previous edit log and summary (if any). Call the compress_history tool exactly once with:
- edit_log: up to 10 bullets capturing every concrete edit, decision, or user preference. Merge with the previous edit log; deduplicate; mark reverts with [reverted].
- summary: 2–4 sentences on what the user is trying to accomplish and where things stand at the end of the segment.

Do not narrate. Do not output text. Only call the tool.`;

        const userPayload = `PREVIOUS EDIT LOG:\n${previousEditLog || '(none)'}

PREVIOUS SUMMARY:\n${previousSummary || '(none)'}

SEGMENT:\n${segment}`;

        const result = await llmService.stream(
            instruction,
            [{ role: 'user', content: userPayload }],
            [COMPRESS_TOOL],
            () => {} // no streaming UI for compression
        );

        const call = result.tool_calls.find((c) => c.name === 'compress_history');
        if (!call) {
            console.warn('[compress] LLM did not call compress_history');
            return false;
        }
        const args = call.args as { edit_log?: unknown; summary?: unknown };
        const editLogArr = Array.isArray(args.edit_log) ? args.edit_log : null;
        const summary = typeof args.summary === 'string' ? args.summary : null;
        if (!editLogArr || !summary) {
            console.warn('[compress] compress_history called with invalid args', args);
            return false;
        }
        const editLog = editLogArr
            .filter((b): b is string => typeof b === 'string')
            .map((b) => `- ${b}`)
            .join('\n');

        await db.query(
            'UPDATE conversations SET edit_log = $1, summary = $2, updated_at = NOW() WHERE id = $3',
            [editLog, summary, conversationId]
        );
        if (idsToCompress.length > 0) {
            await db.query(
                'UPDATE messages SET is_compressed = TRUE WHERE id = ANY($1::uuid[])',
                [idsToCompress]
            );
        }
        return true;
    } catch (err) {
        console.error('[compress] error', err);
        return false;
    }
}

function stringifyMessageContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
        if ('text' in content && typeof (content as any).text === 'string') {
            return (content as any).text;
        }
        if (Array.isArray(content)) {
            return content
                .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
                .filter(Boolean)
                .join('\n');
        }
    }
    return '';
}
