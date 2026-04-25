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

import { llmService, dbService as db } from '../core/container';
import { getCrdtTools, CRDT_SYSTEM_INSTRUCTION } from '../core/crdt/crdtTools';
import { executeCrdtTool } from '../core/crdt/crdtExecutor';
import { sanitizeMessagesForModel } from '../core/messageSanitizer';
import { ContextManager } from './contextManager';
import type { AgentRuntimeState, AgentTaskItem } from '../core/agentTypes';

// ─── helpers ─────────────────────────────────────────────────────────────────

const buildSystemInstructionWithTaskList = (
    baseInstruction: string,
    runtimeState: AgentRuntimeState
) => {
    if (!runtimeState.tasks.length) {
        return `${baseInstruction}\n\nCurrent task checklist: (none yet)`;
    }
    const checklist = runtimeState.tasks
        .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.id}: ${t.title}`)
        .join('\n');
    return `${baseInstruction}\n\nCurrent task checklist:\n${checklist}`;
};

const normalizeTaskList = (raw: unknown): AgentTaskItem[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: AgentTaskItem[] = [];
    for (const entry of raw) {
        const item = entry as Partial<AgentTaskItem> | null | undefined;
        const id = String(item?.id ?? '').trim();
        const title = String(item?.title ?? '').trim();
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
        result.push({ id, title, done: Boolean(item?.done) });
    }
    return result;
};

const parseToolArguments = (raw: unknown): Record<string, unknown> => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // fall through
        }
    }
    return {};
};

const sanitizeToolCalls = (toolCalls: any[]): any[] => {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls
        .map((tc: any, index: number) => {
            const name = tc?.function?.name;
            if (typeof name !== 'string' || !name.trim()) return null;
            return {
                id: typeof tc?.id === 'string' && tc.id.trim() ? tc.id : `tool_call_${index}`,
                type: tc?.type || 'function',
                function: {
                    name: name.trim(),
                    index: tc?.function?.index,
                    arguments: parseToolArguments(tc?.function?.arguments),
                },
            };
        })
        .filter(Boolean);
};

const sanitizeMessagesForLlm = (messages: any[]): any[] => {
    const sanitized = sanitizeMessagesForModel(messages);
    return sanitized.map((msg: any) => {
        if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
            return { ...msg, tool_calls: sanitizeToolCalls(msg.tool_calls) };
        }
        return msg;
    });
};

// ─── DB helpers ───────────────────────────────────────────────────────────────

const getProjectIdForConversation = async (conversationId: string): Promise<string> => {
    const res = await db.query('SELECT project_id FROM conversations WHERE id = $1', [conversationId]);
    const projectId = res.rows[0]?.project_id;
    if (!projectId) throw new Error(`Project ID not found for conversation ${conversationId}`);
    return projectId;
};

const loadConversationTaskList = async (conversationId: string): Promise<AgentTaskItem[]> => {
    const result = await db.query(
        'SELECT task_list FROM conversations WHERE id = $1',
        [conversationId]
    );
    return normalizeTaskList(result.rows[0]?.task_list);
};

const persistConversationTaskList = async (
    conversationId: string,
    tasks: AgentTaskItem[]
): Promise<void> => {
    await db.query(
        'UPDATE conversations SET task_list = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(tasks), conversationId]
    );
};

// ─── public API ───────────────────────────────────────────────────────────────

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    const projectId = await getProjectIdForConversation(conversationId);
    const tools = getCrdtTools();
    const runtimeState: AgentRuntimeState = {
        tasks: await loadConversationTaskList(conversationId),
    };
    const memRes = await db.query(
        'SELECT edit_log, summary FROM conversations WHERE id = $1',
        [conversationId]
    );
    const { edit_log: editLog = '', summary: convSummary = '' } = memRes.rows[0] || {};

    let currentMessages = [...messages];
    let turnCount = 0;
    const maxTurns = 100;

    while (turnCount < maxTurns) {
        turnCount++;
        const dynamicInstruction = buildSystemInstructionWithTaskList(
            CRDT_SYSTEM_INSTRUCTION,
            runtimeState
        );
        const assembledContext = ContextManager.assembleContext(
            dynamicInstruction,
            editLog,
            convSummary,
            currentMessages
        );
        const result = await llmService.chatWithAgent(
            conversationId,
            sanitizeMessagesForLlm(assembledContext.messages),
            tools,
            assembledContext.systemInstruction
        );

        if (result.stop_reason === 'tool_calls' && result.tool_calls) {
            const safeToolCalls = sanitizeToolCalls(result.tool_calls);
            if (safeToolCalls.length === 0) {
                return {
                    content: [{ type: 'text', text: 'I received malformed tool calls from the model.' }],
                    stop_reason: 'error' as any,
                };
            }
            currentMessages.push({ role: 'assistant', content: '', tool_calls: safeToolCalls });
            for (const tc of safeToolCalls) {
                const name = tc.function.name;
                const args = parseToolArguments(tc.function.arguments);
                const output = await executeCrdtTool(
                    projectId,
                    name,
                    args,
                    runtimeState,
                    conversationId
                );
                try {
                    const parsed = JSON.parse(output);
                    if (parsed?.success && (name === 'create_tasks' || name === 'update_task_status')) {
                        await persistConversationTaskList(conversationId, runtimeState.tasks);
                    }
                } catch {
                    // non-JSON output is fine
                }
                currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: output });
            }
        } else {
            return result;
        }
    }

    return {
        content: [{ type: 'text', text: "I've hit the maximum number of tool execution steps." }],
        stop_reason: 'max_turns' as any,
    };
};

export const chatWithAgentStream = async (
    conversationId: string,
    messages: any[],
    onChunk: (token: string) => void
): Promise<string> => {
    const projectId = await getProjectIdForConversation(conversationId);
    const tools = getCrdtTools();
    const runtimeState: AgentRuntimeState = {
        tasks: await loadConversationTaskList(conversationId),
    };

    if (!llmService.chatWithAgentStream) {
        const result = await chatWithAgent(conversationId, messages);
        const text = result.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
        onChunk(text);
        return text;
    }

    const memRes = await db.query(
        'SELECT edit_log, summary FROM conversations WHERE id = $1',
        [conversationId]
    );
    const { edit_log: editLog = '', summary: convSummary = '' } = memRes.rows[0] || {};

    let currentMessages = [...messages];
    let turnCount = 0;
    const maxTurns = 100;

    while (turnCount < maxTurns) {
        turnCount++;
        const dynamicInstruction = buildSystemInstructionWithTaskList(
            CRDT_SYSTEM_INSTRUCTION,
            runtimeState
        );
        const assembledContext = ContextManager.assembleContext(
            dynamicInstruction,
            editLog,
            convSummary,
            currentMessages
        );

        let localToolCalls: any[] = [];
        let localText = '';

        const wrappedCallback = (token: string) => {
            if (token.startsWith('[TOOL_CALLS]') && token.endsWith('[/TOOL_CALLS]')) {
                try {
                    const jsonStr = token.substring(12, token.length - 13);
                    const parsed = JSON.parse(jsonStr);
                    if (parsed.tool_calls) localToolCalls = parsed.tool_calls;
                } catch (e) {
                    console.error('[agent] error parsing streaming tool calls', e);
                }
                onChunk(token);
            } else {
                onChunk(token);
                localText += token;
            }
        };

        await llmService.chatWithAgentStream(
            conversationId,
            sanitizeMessagesForLlm(assembledContext.messages),
            wrappedCallback,
            tools,
            assembledContext.systemInstruction
        );

        if (localToolCalls.length > 0) {
            const safeToolCalls = sanitizeToolCalls(localToolCalls);
            if (safeToolCalls.length === 0) {
                return 'I received malformed tool calls from the model.';
            }
            currentMessages.push({ role: 'assistant', content: '', tool_calls: safeToolCalls });

            for (const tc of safeToolCalls) {
                const name = tc.function.name;
                const args = parseToolArguments(tc.function.arguments);
                const output = await executeCrdtTool(
                    projectId,
                    name,
                    args,
                    runtimeState,
                    conversationId
                );

                try {
                    const parsed = JSON.parse(output);
                    if (parsed?.success && (name === 'create_tasks' || name === 'update_task_status')) {
                        await persistConversationTaskList(conversationId, runtimeState.tasks);
                    }
                    // CRDT mutations are persisted automatically via the doc update listener;
                    // signal the frontend that the presentation changed for any mutation.
                    if (parsed?.mutated) {
                        onChunk('[PRESENTATION_UPDATED]');
                    }
                } catch {
                    // non-JSON output is fine
                }

                currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: output });
                onChunk(
                    `\n[TOOL_RESULT]${JSON.stringify({ id: tc.id, result: output })}[/TOOL_RESULT]\n`
                );
            }
        } else {
            return localText;
        }
    }

    return "I've hit the maximum number of tool execution steps.";
};
