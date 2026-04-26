import OpenAI from 'openai';
import type { ILLMService } from '../../../core/interfaces/ILLMService';
import type {
    ChatMessage,
    LLMEvent,
    LLMResult,
    StopReason,
    ToolCall,
    ToolSpec,
} from '../../../core/agentTypes';

export class QwenProvider implements ILLMService {
    private readonly openai: OpenAI;
    private readonly model: string;

    constructor(apiKey: string, model: string) {
        this.openai = new OpenAI({
            apiKey,
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        });
        this.model = model;
    }

    async stream(
        systemInstruction: string,
        messages: ChatMessage[],
        tools: ToolSpec[],
        onEvent: (event: LLMEvent) => void
    ): Promise<LLMResult> {
        const wireMessages: any[] = [
            { role: 'system', content: systemInstruction },
            ...messages.map(toWireMessage),
        ];
        const wireTools = tools.length > 0 ? tools.map(toOpenAITool) : undefined;

        const stream = (await this.openai.chat.completions.create({
            model: this.model,
            messages: wireMessages,
            tools: wireTools,
            tool_choice: wireTools ? 'auto' : undefined,
            temperature: 0.7,
            max_tokens: 4096,
            stream: true,
        })) as AsyncIterable<any>;

        let text = '';
        let finishReason: string | null = null;
        const toolAccumulator = new Map<number, { id: string; name: string; arguments: string }>();
        const emittedToolIndexes = new Set<number>();

        for await (const chunk of stream) {
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};

            const reasoning = (delta as any).reasoning_content ?? (delta as any).thinking;
            if (typeof reasoning === 'string' && reasoning.length > 0) {
                onEvent({ type: 'thinking_delta', text: reasoning });
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
                text += delta.content;
                onEvent({ type: 'text_delta', text: delta.content });
            }

            if (Array.isArray(delta.tool_calls)) {
                for (const tcDelta of delta.tool_calls) {
                    const idx = tcDelta.index ?? 0;
                    let acc = toolAccumulator.get(idx);
                    if (!acc) {
                        acc = { id: tcDelta.id || `tool_call_${idx}`, name: '', arguments: '' };
                        toolAccumulator.set(idx, acc);
                    }
                    if (tcDelta.id) acc.id = tcDelta.id;
                    if (tcDelta.function?.name) acc.name += tcDelta.function.name;
                    if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
                }
            }

            if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        // Emit accumulated tool calls in their canonical order
        const toolCalls: ToolCall[] = [];
        const sortedIndexes = Array.from(toolAccumulator.keys()).sort((a, b) => a - b);
        for (const idx of sortedIndexes) {
            if (emittedToolIndexes.has(idx)) continue;
            const acc = toolAccumulator.get(idx)!;
            if (!acc.name.trim()) continue;
            const call: ToolCall = {
                id: acc.id,
                name: acc.name.trim(),
                args: parseJsonObject(acc.arguments),
            };
            toolCalls.push(call);
            onEvent({ type: 'tool_call', call });
            emittedToolIndexes.add(idx);
        }

        const stop_reason: StopReason = mapFinishReason(finishReason, toolCalls.length > 0);
        return { stop_reason, text, tool_calls: toolCalls };
    }
}

function mapFinishReason(reason: string | null, hasToolCalls: boolean): StopReason {
    if (hasToolCalls || reason === 'tool_calls') return 'tool_calls';
    if (reason === 'length') return 'length';
    return 'end';
}

function parseJsonObject(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function toOpenAITool(spec: ToolSpec) {
    return {
        type: 'function' as const,
        function: {
            name: spec.name,
            description: spec.description,
            parameters: spec.parameters,
        },
    };
}

function toWireMessage(msg: ChatMessage): any {
    if (msg.role === 'tool') {
        return {
            role: 'tool',
            tool_call_id: msg.tool_call_id,
            content: msg.content,
        };
    }
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.tool_calls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.name,
                    arguments: JSON.stringify(tc.args ?? {}),
                },
            })),
        };
    }
    return { role: msg.role, content: msg.content };
}
