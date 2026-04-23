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
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { VibeManager } from '../core/vibeManager';
import { getTools, executeTool, type AgentRuntimeState, type AgentTaskItem, type OnLayoutRequest } from '../core/tools';
import { loadDeckHtmlForProject, saveDeckHtmlForProject } from './projectDeck';
const buildSystemInstructionWithTaskList = (baseInstruction: string, runtimeState: AgentRuntimeState) => {
    if (!runtimeState.tasks.length) {
        return `${baseInstruction}\n\nCurrent task checklist: (none yet)`;
    }
    const checklist = runtimeState.tasks
        .map((task: AgentRuntimeState['tasks'][number]) => `${task.done ? '[x]' : '[ ]'} ${task.id}: ${task.title}`)
        .join('\n');
    return `${baseInstruction}\n\nCurrent task checklist:\n${checklist}`;
};
const normalizeTaskList = (raw: unknown): AgentTaskItem[] => {
    if (!Array.isArray(raw)) {
        return [];
    }
    const normalized: AgentTaskItem[] = [];
    const seenIds = new Set<string>();
    for (const entry of raw) {
        const item = entry as Partial<AgentTaskItem> | null | undefined;
        const id = String(item?.id || '').trim();
        const title = String(item?.title || '').trim();
        if (!id || !title || seenIds.has(id)) {
            continue;
        }
        seenIds.add(id);
        normalized.push({
            id,
            title,
            done: Boolean(item?.done)
        });
    }
    return normalized;
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
            // fall through to empty object
        }
    }
    return {};
};
const sanitizeToolCalls = (toolCalls: any[]): any[] => {
    if (!Array.isArray(toolCalls)) {
        return [];
    }
    return toolCalls
        .map((tc: any, index: number) => {
            const name = tc?.function?.name;
            if (typeof name !== 'string' || !name.trim()) {
                return null;
            }
            return {
                id: typeof tc?.id === 'string' && tc.id.trim() ? tc.id : `tool_call_${index}`,
                type: tc?.type || 'function',
                function: {
                    name: name.trim(),
                    index: tc?.function?.index,
                    arguments: parseToolArguments(tc?.function?.arguments)
                }
            };
        })
        .filter(Boolean);
};
const sanitizeMessagesForLlm = (messages: any[]): any[] => {
    return messages.map((msg: any) => {
        const base: any = {
            role: msg?.role,
            content: typeof msg?.content === 'string' ? msg.content : String(msg?.content ?? '')
        };
        if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
            base.tool_calls = sanitizeToolCalls(msg.tool_calls);
        }
        if (typeof msg?.tool_call_id === 'string' && msg.tool_call_id.trim()) {
            base.tool_call_id = msg.tool_call_id;
        }
        return base;
    });
};
const loadConversationTaskList = async (conversationId: string): Promise<AgentTaskItem[]> => {
    const result = await db.query('SELECT task_list FROM conversations WHERE id = $1', [conversationId]);
    const rawTasks = result.rows[0]?.task_list;
    return normalizeTaskList(rawTasks);
};
const persistConversationTaskList = async (conversationId: string, tasks: AgentTaskItem[]) => {
    await db.query(
        'UPDATE conversations SET task_list = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(tasks), conversationId]
    );
};
const createConversationVibeManager = async (conversationId: string) => {
    const res = await db.query('SELECT project_id FROM conversations WHERE id = $1', [conversationId]);
    const projectId = res.rows[0]?.project_id;
    if (!projectId) throw new Error("Project ID not found for conversation");
    const { html } = await loadDeckHtmlForProject(projectId);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-agent-'));
    const tempFilePath = path.join(tempDir, `${projectId}.html`);
    await fs.writeFile(tempFilePath, html, { encoding: 'utf-8' });
    const vibeManager = await VibeManager.create(tempFilePath);
    const persist = async () => {
        const updatedHtml = await fs.readFile(tempFilePath, { encoding: 'utf-8' });
        await saveDeckHtmlForProject(projectId, updatedHtml);
    };
    const cleanup = async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    };
    return { vibeManager, persist, cleanup };
};
export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    const { vibeManager, persist, cleanup } = await createConversationVibeManager(conversationId);
    const { tools, systemInstruction } = await getTools(vibeManager);
    const runtimeState: AgentRuntimeState = { tasks: await loadConversationTaskList(conversationId) };
    let currentMessages = [...messages];
    let turnCount = 0;
    const maxTurns = 100;
    try {
        while (turnCount < maxTurns) {
            turnCount++;
            const dynamicSystemInstruction = buildSystemInstructionWithTaskList(systemInstruction, runtimeState);
            const result = await llmService.chatWithAgent(
                conversationId,
                sanitizeMessagesForLlm(currentMessages),
                tools,
                dynamicSystemInstruction
            );
            if (result.stop_reason === 'tool_calls' && result.tool_calls) {
                const safeToolCalls = sanitizeToolCalls(result.tool_calls);
                if (safeToolCalls.length === 0) {
                    return { content: [{ type: 'text', text: "I received malformed tool calls from the model." }], stop_reason: 'error' as any };
                }
                // Add assistant's tool calls to history
                currentMessages.push({
                    role: 'assistant',
                    content: '',
                    tool_calls: safeToolCalls
                });
                // Execute all tools
                for (const tc of safeToolCalls) {
                    const name = tc.function.name;
                    const args = parseToolArguments(tc.function.arguments);
                    const output = await executeTool(vibeManager, name, args, runtimeState);
                    try {
                        const parsed = JSON.parse(output);
                        if (parsed?.mutated) {
                            await persist();
                        }
                        if (parsed?.success && (name === 'create_tasks' || name === 'update_task_status')) {
                            await persistConversationTaskList(conversationId, runtimeState.tasks);
                        }
                    } catch {
                        // keep going even if tool output is non-JSON
                    }
                    // Add tool result to history
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: output
                    });
                }
                // Loop back to LLM with the tool results
            } else {
                // Final response or stop
                return result;
            }
        }
        return { content: [{ type: 'text', text: "I've hit the maximum number of tool execution steps." }], stop_reason: 'max_turns' };
    } finally {
        await cleanup();
    }
};
export const chatWithAgentStream = async (
    conversationId: string,
    messages: any[],
    onChunk: (token: string) => void,
    onLayoutRequest?: OnLayoutRequest
): Promise<string> => {
    const { vibeManager, persist, cleanup } = await createConversationVibeManager(conversationId);
    const { tools, systemInstruction } = await getTools(vibeManager);
    const runtimeState: AgentRuntimeState = { tasks: await loadConversationTaskList(conversationId) };
    try {
        if (!llmService.chatWithAgentStream) {
            // Fallback: non-streaming, emit full text as one chunk
            const result = await chatWithAgent(conversationId, messages);
            const text = result.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n');
            onChunk(text);
            return text;
        }
        let currentMessages = [...messages];
        let turnCount = 0;
        const maxTurns = 100;
        while (turnCount < maxTurns) {
            turnCount++;
        const dynamicSystemInstruction = buildSystemInstructionWithTaskList(systemInstruction, runtimeState);
        let localToolCalls: any[] = [];
        let localText = '';
        // Wrap the callback to intercept the tool_calls event
        const wrappedCallback = (token: string) => {
            if (token.startsWith('[TOOL_CALLS]') && token.endsWith('[/TOOL_CALLS]')) {
                 try {
                     const jsonStr = token.substring(12, token.length - 13);
                     const parsed = JSON.parse(jsonStr);
                     if (parsed.tool_calls) {
                         localToolCalls = parsed.tool_calls;
                     }
                 } catch (e) {
                     console.error("Error parsing streaming tool calls", e);
                 }
                 // pass to frontend so it can display them
                 onChunk(token);
            } else {
                  // Stream text tokens immediately so think blocks remain visible even on tool-call turns.
                  onChunk(token);
                  localText += token;
            }
        };
           await llmService.chatWithAgentStream(
               conversationId,
               sanitizeMessagesForLlm(currentMessages),
               wrappedCallback,
               tools,
               dynamicSystemInstruction
           );
        if (localToolCalls.length > 0) {
             const safeToolCalls = sanitizeToolCalls(localToolCalls);
             if (safeToolCalls.length === 0) {
                 return "I received malformed tool calls from the model.";
             }
             currentMessages.push({
                 role: 'assistant',
                 content: '',
                 tool_calls: safeToolCalls
             });
             for (const tc of safeToolCalls) {
                 const name = tc.function.name;
                 const args = parseToolArguments(tc.function.arguments);
                 const output = await executeTool(vibeManager, name, args, runtimeState, onLayoutRequest);
                 let shouldRefreshPresentation = false;
                 try {
                     const parsed = JSON.parse(output);
                     if (parsed?.mutated) {
                         await persist();
                         shouldRefreshPresentation = true;
                     }
                     if (parsed?.success && (name === 'create_tasks' || name === 'update_task_status')) {
                         await persistConversationTaskList(conversationId, runtimeState.tasks);
                     }
                 } catch {
                     // keep going even if tool output is non-JSON
                 }
                 currentMessages.push({
                     role: 'tool',
                     tool_call_id: tc.id,
                     content: output
                 });
                 // Optionally stream back the tool result so the UI knows it finished
                 onChunk(`\n[TOOL_RESULT]${JSON.stringify({ id: tc.id, result: output })}[/TOOL_RESULT]\n`);
                 if (shouldRefreshPresentation) {
                     // Signal the frontend to refetch the presentation endpoint (which hydrates from Redis cache first).
                     onChunk('[PRESENTATION_UPDATED]');
                 }
             }
             // Loop again to give LLM the results
        } else {
             return localText;
        }
        }
        return "I've hit the maximum number of tool execution steps.";
    } finally {
        await cleanup();
    }
};
