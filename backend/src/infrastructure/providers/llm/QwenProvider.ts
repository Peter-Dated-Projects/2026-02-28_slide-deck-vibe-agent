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

import OpenAI from 'openai';
import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";
import { ToolCallStreamSanitizer, ToolStreamManager, extractToolCallsFromText, stripToolCallsFromText } from "./toolCallParser";
import { sanitizeMessagesForModel } from '../../../core/messageSanitizer';

const DEFAULT_SYSTEM_INSTRUCTION = "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning. When you need to call a tool, use the native OpenAI-compatible tool call format when available. If a text fallback is needed, use <execute_tool>function_name{json_arguments}</execute_tool>. Keep any reasoning in <think>...</think> blocks when the model emits it.";
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

function stringifyContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }

    try {
        return JSON.stringify(content ?? '');
    } catch {
        return String(content ?? '');
    }
}

function normalizeToolCalls(toolCalls: any[]): any[] {
    if (!Array.isArray(toolCalls)) {
        return [];
    }

    const normalized: any[] = [];
    const seen = new Set<string>();

    for (const [index, toolCall] of toolCalls.entries()) {
        const name = toolCall?.function?.name || toolCall?.name || toolCall?.tool_name;
        if (typeof name !== 'string' || !name.trim()) {
            continue;
        }

        const args = toolCall?.function?.arguments ?? toolCall?.arguments ?? {};
        const argumentsText = typeof args === 'string' ? args : JSON.stringify(args ?? {});
        const id = typeof toolCall?.id === 'string' && toolCall.id.trim() ? toolCall.id : `tool_call_${index}`;
        const signature = `${name.trim()}\n${argumentsText}`;
        if (seen.has(signature)) {
            continue;
        }

        seen.add(signature);
        normalized.push({
            id,
            type: 'function',
            function: {
                name: name.trim(),
                arguments: argumentsText,
            },
        });
    }

    return normalized;
}

export class QwenProvider implements ILLMService {
    private readonly openai: OpenAI;
    private readonly model: string;
    private readonly dbService: IDatabaseService;
    private readonly storageService: IStorageService;

    constructor(apiKey: string, model: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.openai = new OpenAI({
            apiKey,
            baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        });
        this.model = model;
        this.dbService = dbService;
        this.storageService = storageService;
    }

    private buildMessages(messages: any[], systemInstruction?: string) {
        const instruction = systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
        const formatted = sanitizeMessagesForModel(messages).map((message: any) => {
            if (message?.role === 'tool') {
                return {
                    role: 'user',
                    content: `[Tool Result for ${message?.tool_call_id || 'unknown'}]\n${stringifyContent(message?.content)}`,
                };
            }

            if (message?.role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
                const toolCallText = message.tool_calls.map((toolCall: any) => {
                    const name = toolCall?.function?.name || 'unknown';
                    const args = typeof toolCall?.function?.arguments === 'string'
                        ? toolCall.function.arguments
                        : JSON.stringify(toolCall?.function?.arguments || {});
                    return `<execute_tool>${name}${args}</execute_tool>`;
                }).join('\n\n');

                const prefix = typeof message.content === 'string' && message.content.trim() ? `${message.content}\n\n` : '';
                return {
                    role: 'assistant',
                    content: `${prefix}${toolCallText}`,
                };
            }

            if (message?.role === 'user' && Array.isArray(message?.content)) {
                return {
                    role: 'user',
                    content: stringifyContent(message.content),
                };
            }

            return {
                role: message?.role,
                content: stringifyContent(message?.content),
            };
        });

        return [
            {
                role: 'system',
                content: instruction,
            },
            ...formatted,
        ] as any[];
    }

    async chatWithAgent(
        conversationId: string,
        messages: any[],
        tools?: any[],
        systemInstruction?: string
    ) {
        const params: any = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction),
            max_tokens: 4096,
            temperature: 0.7,
        };

        if (tools && tools.length > 0) {
            params.tools = tools;
            params.tool_choice = 'auto';
        }

        const response = await this.openai.chat.completions.create(params);
        const message = response.choices[0]?.message;
        if (!message) {
            throw new Error('Qwen returned no choices in response.');
        }

        const reasoningContent = typeof (message as any).reasoning_content === 'string' ? (message as any).reasoning_content : '';
        const thinkingContent = typeof (message as any).thinking === 'string' ? (message as any).thinking : '';
        const finalText = [
            reasoningContent ? `${THINK_OPEN}${reasoningContent}${THINK_CLOSE}` : '',
            thinkingContent ? `${THINK_OPEN}${thinkingContent}${THINK_CLOSE}` : '',
            typeof message.content === 'string' ? message.content : '',
        ].filter(Boolean).join('\n\n');
        const visibleText = stripToolCallsFromText(finalText);

        const toolCalls = normalizeToolCalls([
            ...(Array.isArray(message.tool_calls) ? message.tool_calls : []),
            ...extractToolCallsFromText(finalText),
        ]);

        if (toolCalls.length > 0) {
            return {
                content: [],
                tool_calls: toolCalls,
                stop_reason: 'tool_calls',
            };
        }

        return {
            content: [{ type: 'text', text: visibleText }],
            stop_reason: 'end_turn',
        };
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void,
        tools?: any[],
        systemInstruction?: string
    ): Promise<string> {
        const params: any = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction),
            max_tokens: 4096,
            temperature: 0.7,
            stream: true,
        };

        if (tools && tools.length > 0) {
            params.tools = tools;
            params.tool_choice = 'auto';
        }

        const stream = await this.openai.chat.completions.create(params) as AsyncIterable<any>;
        const toolStreamManager = new ToolStreamManager();
        const visibleTextStream = new ToolCallStreamSanitizer();
        const textToolCalls: any[] = [];
        const structuredToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

        let rawFullText = '';
        let visibleFullText = '';
        let isThinking = false;

        const collectTextToolCalls = (calls: any[]) => {
            for (const toolCall of normalizeToolCalls(calls)) {
                const signature = `${toolCall.function.name}\n${toolCall.function.arguments}`;
                if (!textToolCalls.some((existing) => `${existing.function.name}\n${existing.function.arguments}` === signature)) {
                    textToolCalls.push(toolCall);
                }
            }
        };

        const emitThinking = (token: string) => {
            if (!token) {
                return;
            }

            if (!isThinking) {
                onChunk(THINK_OPEN);
                rawFullText += THINK_OPEN;
                visibleFullText += THINK_OPEN;
                isThinking = true;
            }

            collectTextToolCalls(toolStreamManager.addChunk(token));
            rawFullText += token;
            const visibleToken = visibleTextStream.addChunk(token);
            if (visibleToken) {
                onChunk(visibleToken);
                visibleFullText += visibleToken;
            }
        };

        const emitContent = (token: string) => {
            if (!token) {
                return;
            }

            if (isThinking) {
                onChunk(THINK_CLOSE);
                rawFullText += THINK_CLOSE;
                visibleFullText += THINK_CLOSE;
                isThinking = false;
            }

            collectTextToolCalls(toolStreamManager.addChunk(token));
            rawFullText += token;
            const visibleToken = visibleTextStream.addChunk(token);
            if (visibleToken) {
                onChunk(visibleToken);
                visibleFullText += visibleToken;
            }
        };

        for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            const finishReason = chunk.choices?.[0]?.finish_reason;

            if (!delta && !finishReason) {
                continue;
            }

            const reasoningToken = (delta as any)?.reasoning_content ?? (delta as any)?.thinking ?? '';
            if (reasoningToken) {
                emitThinking(reasoningToken);
            }

            const token = delta?.content ?? '';
            if (token) {
                emitContent(token);
            }

            if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index ?? 0;
                    if (!structuredToolCalls.has(index)) {
                        structuredToolCalls.set(index, {
                            id: toolCallDelta.id || `tool_call_${index}`,
                            name: toolCallDelta.function?.name || '',
                            arguments: '',
                        });
                    }

                    const accumulator = structuredToolCalls.get(index)!;
                    if (toolCallDelta.id) {
                        accumulator.id = toolCallDelta.id;
                    }
                    if (toolCallDelta.function?.name) {
                        accumulator.name += toolCallDelta.function.name;
                    }
                    if (toolCallDelta.function?.arguments) {
                        accumulator.arguments += toolCallDelta.function.arguments;
                    }
                }
            }

            if (finishReason && isThinking) {
                onChunk(THINK_CLOSE);
                fullText += THINK_CLOSE;
                isThinking = false;
            }
        }

        if (isThinking) {
            onChunk(THINK_CLOSE);
            rawFullText += THINK_CLOSE;
            visibleFullText += THINK_CLOSE;
        }

        const normalizedToolCalls = normalizeToolCalls([
            ...Array.from(structuredToolCalls.values()).map((toolCall) => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                },
            })),
            ...textToolCalls,
            ...extractToolCallsFromText(rawFullText),
        ]);

        if (normalizedToolCalls.length > 0) {
            const toolCallString = JSON.stringify({ type: 'tool_calls', tool_calls: normalizedToolCalls });
            onChunk(`[TOOL_CALLS]${toolCallString}[/TOOL_CALLS]`);
        }

        return visibleFullText;
    }
}
