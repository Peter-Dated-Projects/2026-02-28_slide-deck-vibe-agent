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
import { extractToolCallsFromText } from "./toolCallParser";
import { sanitizeMessagesForModel } from '../../../core/messageSanitizer';

/**
 * LM Studio provider.
 *
 * LM Studio exposes an OpenAI-compatible REST API (typically at
 * http://localhost:1234/v1). We use the official OpenAI SDK pointed
 * at LM Studio's base URL with a dummy API key.
 */
export class LMStudioProvider implements ILLMService {
    private client: OpenAI;
    private model: string;

    constructor(baseUrl: string, model: string) {
        this.model = model;
        this.client = new OpenAI({
            baseURL: baseUrl,
            apiKey: 'lm-studio', // LM Studio doesn't validate API keys
        });
    }

    private buildMessages(messages: any[], systemInstruction?: string, tools?: any[]): OpenAI.Chat.ChatCompletionMessageParam[] {
        let instruction = systemInstruction || "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning.";
        const normalizedMessages = sanitizeMessagesForModel(messages);

        // For local models that might ignore the OpenAI tools array,
        // explicitly inject the tool definitions into the system prompt.
        if (tools && tools.length > 0) {
            const toolDocs = tools.map((t) => JSON.stringify(t)).join('\n');
            instruction += `\n\n# Available Tools\nYou have access to the following tools. You can invoke them by returning JSON tool calls. If your native tool calling is disabled, output a JSON block like: {"tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "tool_name", "arguments": "{\\"key\\":\\"value\\"}"}}]}\n\n${toolDocs}`;
        }

        const converted: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: instruction },
        ];

        for (const m of normalizedMessages) {
            // Assistant message that made tool calls — convert to plain text
            if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                const toolCallText = m.tool_calls.map((tc: any) => {
                    const name = tc?.function?.name || 'unknown';
                    const args = typeof tc?.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc?.function?.arguments || {});
                    return `[Tool Call: ${name}]\n${args}`;
                }).join('\n\n');

                const prefix = m.content ? `${m.content}\n\n` : '';
                converted.push({
                    role: 'assistant',
                    content: `${prefix}${toolCallText}`,
                });
                continue;
            }

            // Tool result message — convert to user message
            if (m.role === 'tool') {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
                converted.push({
                    role: 'user',
                    content: `[Tool Result for ${m.tool_call_id || 'unknown'}]\n${content}`,
                });
                continue;
            }

            // Regular user/assistant message — pass through
            converted.push({
                role: m.role,
                content: m.content || '',
            });
        }

        console.error('[LM Studio Debug] outgoing messages:', JSON.stringify(converted, null, 2));
        return converted;
    }

    async chatWithAgent(
        conversationId: string,
        messages: any[],
        tools?: any[],
        systemInstruction?: string
    ) {
        const params: OpenAI.Chat.ChatCompletionCreateParams = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction, tools),
            stream: false,
        };

        // Native tools removed to prevent 400 errors from LM Studio

        const response = await this.client.chat.completions.create(params) as OpenAI.Chat.ChatCompletion;

        const choice = response.choices?.[0];
        if (!choice) {
            return { content: [{ type: 'text', text: 'No response from model.' }], stop_reason: 'error' };
        }

        // Check for native tool calls
        if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
            return {
                content: [],
                tool_calls: choice.message.tool_calls,
                stop_reason: 'tool_calls',
            };
        }

        const text = choice.message?.content || '';

        // Some models embed tool calls in text even when native tool calling is available.
        // Try to extract them as a fallback.
        const extractedToolCalls = extractToolCallsFromText(text);
        if (extractedToolCalls.length > 0) {
            return {
                content: [],
                tool_calls: extractedToolCalls,
                stop_reason: 'tool_calls',
            };
        }

        return {
            content: [{ type: 'text', text }],
            stop_reason: choice.finish_reason || 'end_turn',
        };
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void,
        tools?: any[],
        systemInstruction?: string
    ): Promise<string> {
        const params: OpenAI.Chat.ChatCompletionCreateParams = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction, tools),
            stream: true,
        };

        // Native tools removed to prevent 400 errors from LM Studio

        const stream = await this.client.chat.completions.create(params) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;

        let fullText = '';
        let isThinking = false;
        let accumulatedThinking = '';

        // Accumulate streamed tool call deltas (OpenAI-style)
        const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();

        for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            const finishReason = chunk.choices?.[0]?.finish_reason;

            if (!delta && !finishReason) continue;

            // Handle thinking tokens (model-specific, some models use a `thinking` field)
            const thinkingToken = (delta as any)?.thinking ?? '';
            if (thinkingToken) {
                if (!isThinking) {
                    onChunk('<think>');
                    fullText += '<think>';
                    isThinking = true;
                    accumulatedThinking = '';
                }
                onChunk(thinkingToken);
                fullText += thinkingToken;
                accumulatedThinking += thinkingToken;
            }

            // Handle text content
            const token = delta?.content ?? '';
            if (token) {
                if (isThinking) {
                    // Transition out of thinking
                    const extractedToolCalls = extractToolCallsFromText(accumulatedThinking);
                    if (extractedToolCalls.length > 0) {
                        // Will be emitted after stream ends
                        for (let i = 0; i < extractedToolCalls.length; i++) {
                            const tc = extractedToolCalls[i]!;
                            toolCallAccumulator.set(1000 + i, {
                                id: tc.id,
                                name: tc.function.name,
                                arguments: tc.function.arguments,
                            });
                        }
                    }
                    onChunk('</think>');
                    fullText += '</think>';
                    isThinking = false;
                    accumulatedThinking = '';
                }
                onChunk(token);
                fullText += token;
            }

            // Handle native streamed tool call deltas
            if (delta?.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                    const idx = tcDelta.index ?? 0;
                    if (!toolCallAccumulator.has(idx)) {
                        toolCallAccumulator.set(idx, {
                            id: tcDelta.id || `tool_call_${idx}`,
                            name: tcDelta.function?.name || '',
                            arguments: '',
                        });
                    }
                    const acc = toolCallAccumulator.get(idx)!;
                    if (tcDelta.id) acc.id = tcDelta.id;
                    if (tcDelta.function?.name) acc.name += tcDelta.function.name;
                    if (tcDelta.function?.arguments) acc.arguments += tcDelta.function.arguments;
                }
            }

            // Handle stream completion
            if (finishReason) {
                if (isThinking) {
                    const extractedToolCalls = extractToolCallsFromText(accumulatedThinking);
                    if (extractedToolCalls.length > 0) {
                        for (let i = 0; i < extractedToolCalls.length; i++) {
                            const tc = extractedToolCalls[i]!;
                            toolCallAccumulator.set(2000 + i, {
                                id: tc.id,
                                name: tc.function.name,
                                arguments: tc.function.arguments,
                            });
                        }
                    }
                    onChunk('</think>');
                    fullText += '</think>';
                    isThinking = false;
                }

                // Also check the final text for embedded tool calls
                if (toolCallAccumulator.size === 0 && fullText.trim()) {
                    const textToolCalls = extractToolCallsFromText(fullText);
                    for (let i = 0; i < textToolCalls.length; i++) {
                        const tc = textToolCalls[i]!;
                        toolCallAccumulator.set(3000 + i, {
                            id: tc.id,
                            name: tc.function.name,
                            arguments: tc.function.arguments,
                        });
                    }
                }
            }
        }

        // Emit all collected tool calls
        if (toolCallAccumulator.size > 0) {
            const toolCalls = Array.from(toolCallAccumulator.values()).map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                    name: tc.name,
                    arguments: tc.arguments,
                },
            }));
            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: toolCalls });
            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
        }

        return fullText;
    }
}
