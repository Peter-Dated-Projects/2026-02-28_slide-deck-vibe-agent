import { llmService, dbService as db } from '../core/container';
import { getCrdtTools, CRDT_SYSTEM_INSTRUCTION } from '../core/crdt/crdtTools';
import { executeCrdtTool } from '../core/crdt/crdtExecutor';
import { assembleContext } from './buildContext';
import type {
    AgentRuntimeState,
    AgentTaskItem,
    ChatMessage,
    LLMEvent,
    MessageBlock,
    ToolCall,
} from '../core/agentTypes';

const MAX_TURNS = 12;

export type AgentEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; text: string }
    | { type: 'tool_call'; call: ToolCall }
    | { type: 'tool_result'; id: string; result: string; mutated: boolean }
    | { type: 'error'; message: string };

export interface RunAgentArgs {
    conversationId: string;
    history: ChatMessage[];
    onEvent: (event: AgentEvent) => void;
}

export interface RunAgentResult {
    finalText: string;
    toolCalls: ToolCall[];
    toolResults: { id: string; result: string }[];
    /** One ordered block array per assistant turn, in stream order. */
    turns: MessageBlock[][];
}

export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
    const { conversationId, history, onEvent } = args;
    const projectId = await getProjectIdForConversation(conversationId);
    const tools = getCrdtTools();
    const runtimeState: AgentRuntimeState = {
        tasks: await loadTasks(conversationId),
    };

    const meta = await db.query(
        'SELECT edit_log, summary FROM conversations WHERE id = $1',
        [conversationId]
    );
    const editLog: string = meta.rows[0]?.edit_log ?? '';
    const summary: string = meta.rows[0]?.summary ?? '';

    const messages: ChatMessage[] = [...history];
    const allToolCalls: ToolCall[] = [];
    const allToolResults: { id: string; result: string }[] = [];
    const turns: MessageBlock[][] = [];
    let finalText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const baseInstruction = withTaskList(CRDT_SYSTEM_INSTRUCTION, runtimeState);
        const ctx = assembleContext(baseInstruction, editLog, summary, messages);

        let turnText = '';
        const turnBlocks: MessageBlock[] = [];

        const appendStreamDelta = (kind: 'text' | 'thinking', text: string) => {
            const last = turnBlocks[turnBlocks.length - 1];
            if (last && last.type === kind) {
                last.text += text;
            } else {
                turnBlocks.push({ type: kind, text });
            }
        };

        const llmResult = await llmService.stream(
            ctx.systemInstruction,
            ctx.messages,
            tools,
            (event: LLMEvent) => {
                if (event.type === 'text_delta') {
                    turnText += event.text;
                    appendStreamDelta('text', event.text);
                    onEvent({ type: 'text_delta', text: event.text });
                } else if (event.type === 'thinking_delta') {
                    appendStreamDelta('thinking', event.text);
                    onEvent({ type: 'thinking_delta', text: event.text });
                } else if (event.type === 'tool_call') {
                    turnBlocks.push({
                        type: 'tool_call',
                        id: event.call.id,
                        name: event.call.name,
                        args: event.call.args,
                    });
                    onEvent({ type: 'tool_call', call: event.call });
                }
            }
        );

        if (llmResult.stop_reason !== 'tool_calls' || llmResult.tool_calls.length === 0) {
            finalText = turnText || llmResult.text;
            // If the provider returned text without streaming deltas, capture it as a
            // trailing block so persistence reflects what the model actually produced.
            if (!turnText && llmResult.text) {
                turnBlocks.push({ type: 'text', text: llmResult.text });
            }
            if (finalText) {
                messages.push({ role: 'assistant', content: finalText });
            }
            if (turnBlocks.length > 0) turns.push(turnBlocks);
            return { finalText, toolCalls: allToolCalls, toolResults: allToolResults, turns };
        }

        // Tool call turn — append assistant message with tool_calls, then execute each.
        messages.push({
            role: 'assistant',
            content: turnText,
            tool_calls: llmResult.tool_calls,
        });
        allToolCalls.push(...llmResult.tool_calls);

        for (const call of llmResult.tool_calls) {
            const output = await executeCrdtTool(
                projectId,
                call.name,
                call.args,
                runtimeState,
                conversationId
            );
            allToolResults.push({ id: call.id, result: output });
            turnBlocks.push({ type: 'tool_result', id: call.id, result: output });
            const mutated = parseMutated(output);
            onEvent({ type: 'tool_result', id: call.id, result: output, mutated });

            if (call.name === 'create_tasks' || call.name === 'update_task_status') {
                await persistTasks(conversationId, runtimeState.tasks);
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: output,
            });
        }

        if (turnBlocks.length > 0) turns.push(turnBlocks);
    }

    onEvent({ type: 'error', message: `Hit maximum tool turns (${MAX_TURNS}).` });
    return { finalText, toolCalls: allToolCalls, toolResults: allToolResults, turns };
}

function withTaskList(base: string, state: AgentRuntimeState): string {
    if (state.tasks.length === 0) return `${base}\n\nCurrent task checklist: (none yet)`;
    const list = state.tasks
        .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.id}: ${t.title}`)
        .join('\n');
    return `${base}\n\nCurrent task checklist:\n${list}`;
}

function parseMutated(output: string): boolean {
    try {
        const parsed = JSON.parse(output);
        return Boolean(parsed?.mutated);
    } catch {
        return false;
    }
}

async function getProjectIdForConversation(conversationId: string): Promise<string> {
    const res = await db.query(
        'SELECT project_id FROM conversations WHERE id = $1',
        [conversationId]
    );
    const id = res.rows[0]?.project_id;
    if (!id) throw new Error(`Project ID not found for conversation ${conversationId}`);
    return id;
}

async function loadTasks(conversationId: string): Promise<AgentTaskItem[]> {
    const res = await db.query(
        'SELECT task_list FROM conversations WHERE id = $1',
        [conversationId]
    );
    const raw = res.rows[0]?.task_list;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: AgentTaskItem[] = [];
    for (const entry of raw) {
        const id = String(entry?.id ?? '').trim();
        const title = String(entry?.title ?? '').trim();
        if (!id || !title || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title, done: Boolean(entry?.done) });
    }
    return out;
}

async function persistTasks(conversationId: string, tasks: AgentTaskItem[]): Promise<void> {
    await db.query(
        'UPDATE conversations SET task_list = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(tasks), conversationId]
    );
}
