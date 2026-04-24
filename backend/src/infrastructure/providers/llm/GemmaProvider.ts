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

import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";
import { ToolCallStreamSanitizer, ToolStreamManager, extractToolCallsFromText, stripToolCallsFromText } from "./toolCallParser";
import { sanitizeMessagesForModel } from '../../../core/messageSanitizer';

const DEFAULT_SYSTEM_INSTRUCTION = "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning. Gemma 4 reasoning uses the thought channel: emit <|channel>thought ... <channel|> when thinking. When you need to call a tool, emit exactly one Gemma 4 tool call block using <|tool_call>call:function_name{json_arguments}<tool_call|>. Do not use XML tags, bracketed text like [Tool Call], or <execute_tool> syntax.";
const GEMMA_THOUGHT_START = '<|channel>thought';
const GEMMA_THOUGHT_END = '<channel|>';
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

function splitGemmaThoughtChannel(text: string): { thinking: string; content: string } {
    if (!text) {
        return { thinking: '', content: '' };
    }

    const startIndex = text.indexOf(GEMMA_THOUGHT_START);
    if (startIndex < 0) {
        return { thinking: '', content: text };
    }

    const endIndex = text.indexOf(GEMMA_THOUGHT_END, startIndex + GEMMA_THOUGHT_START.length);
    if (endIndex < 0) {
        return {
            thinking: text.slice(startIndex + GEMMA_THOUGHT_START.length).trim(),
            content: '',
        };
    }

    const thinking = text.slice(startIndex + GEMMA_THOUGHT_START.length, endIndex).trim();
    const content = text.slice(endIndex + GEMMA_THOUGHT_END.length).trimStart();
    return { thinking, content };
}

function composeVisibleText(thinking: string, content: string): string {
    const trimmedThinking = thinking.trim();
    const trimmedContent = content.trim();

    if (!trimmedThinking) {
        return trimmedContent;
    }

    if (!trimmedContent) {
        return `${THINK_OPEN}${trimmedThinking}${THINK_CLOSE}`;
    }

    return `${THINK_OPEN}${trimmedThinking}${THINK_CLOSE}\n\n${trimmedContent}`;
}

export class GemmaProvider implements ILLMService {
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly dbService: IDatabaseService;
    private readonly storageService: IStorageService;

    constructor(baseUrl: string, model: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.baseUrl = baseUrl;
        this.model = model;
        this.dbService = dbService;
        this.storageService = storageService;
    }

    private buildMessages(messages: any[], systemInstruction?: string) {
        const instruction = systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
        const formatted = sanitizeMessagesForModel(messages).map((message: any) => {
            if (message?.role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
                const toolCallText = message.tool_calls.map((toolCall: any) => {
                    const name = toolCall?.function?.name || 'unknown';
                    const args = typeof toolCall?.function?.arguments === 'string'
                        ? toolCall.function.arguments
                        : JSON.stringify(toolCall?.function?.arguments || {});
                    return `<|tool_call>call:${name}${args}<tool_call|>`;
                }).join('\n\n');

                const prefix = typeof message.content === 'string' && message.content.trim() ? `${message.content}\n\n` : '';
                return {
                    role: 'assistant',
                    content: `${prefix}${toolCallText}`,
                };
            }

            if (message?.role === 'tool') {
                return {
                    role: 'user',
                    content: `[Tool Result for ${message?.tool_call_id || 'unknown'}]\n${stringifyContent(message?.content)}`,
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
            { role: 'system', content: instruction },
            ...formatted,
        ];
    }

    async chatWithAgent(
        conversationId: string,
        messages: any[],
        tools?: any[],
        systemInstruction?: string
    ) {
        const body: any = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction),
            stream: false,
            think: true,
            options: {
                temperature: 0.7,
                top_p: 0.95,
                top_k: 64,
            },
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`Gemma API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        const data: any = await response.json();
        const rawThinking = typeof data?.message?.thinking === 'string' ? data.message.thinking : '';
        const rawContent = typeof data?.message?.content === 'string' ? data.message.content : '';
        const parsed = rawThinking ? { thinking: rawThinking, content: rawContent } : splitGemmaThoughtChannel(rawContent);
        const visible = stripToolCallsFromText(composeVisibleText(parsed.thinking, parsed.content));

        const toolCalls = normalizeToolCalls([
            ...(Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : []),
            ...extractToolCallsFromText(rawContent),
        ]);

        if (toolCalls.length > 0) {
            return {
                content: [],
                tool_calls: toolCalls,
                stop_reason: 'tool_calls',
            };
        }

        return {
            content: [{ type: 'text', text: visible }],
            stop_reason: data?.done_reason || 'end_turn',
        };
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void,
        tools?: any[],
        systemInstruction?: string
    ): Promise<string> {
        const body: any = {
            model: this.model,
            messages: this.buildMessages(messages, systemInstruction),
            stream: true,
            think: true,
            options: {
                temperature: 0.7,
                top_p: 0.95,
                top_k: 64,
            },
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            throw new Error(`Gemma API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let ndjsonBuffer = '';
        let rawFullText = '';
        let visibleFullText = '';
        let isThinking = false;
        const toolCalls: any[] = [];
        const collectedTextToolCalls: any[] = [];
        const toolStreamManager = new ToolStreamManager();
        const visibleTextStream = new ToolCallStreamSanitizer();

        const collectTextToolCalls = (calls: any[]) => {
            for (const toolCall of normalizeToolCalls(calls)) {
                const signature = `${toolCall.function.name}\n${toolCall.function.arguments}`;
                if (!collectedTextToolCalls.some((existing) => `${existing.function.name}\n${existing.function.arguments}` === signature)) {
                    collectedTextToolCalls.push(toolCall);
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

        const processJson = (json: any): boolean => {
            const rawThinking = typeof json?.message?.thinking === 'string' ? json.message.thinking : '';
            const rawContent = typeof json?.message?.content === 'string' ? json.message.content : '';
            const parsed = rawThinking ? { thinking: rawThinking, content: rawContent } : splitGemmaThoughtChannel(rawContent);

            if (parsed.thinking) {
                emitThinking(parsed.thinking);
            }

            if (parsed.content) {
                emitContent(parsed.content);
            }

            if (Array.isArray(json?.message?.tool_calls) && json.message.tool_calls.length > 0) {
                toolCalls.push(...normalizeToolCalls(json.message.tool_calls));
            }

            if (json?.done) {
                if (isThinking) {
                    onChunk(THINK_CLOSE);
                    rawFullText += THINK_CLOSE;
                    visibleFullText += THINK_CLOSE;
                    isThinking = false;
                }
                return true;
            }

            return false;
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            ndjsonBuffer += decoder.decode(value, { stream: true });
            const lines = ndjsonBuffer.split('\n');
            ndjsonBuffer = lines.pop() ?? '';

            for (const line of lines) {
                if (!line.trim()) {
                    continue;
                }

                try {
                    const json = JSON.parse(line);
                    if (processJson(json)) {
                        const finalToolCalls = normalizeToolCalls([
                            ...toolCalls,
                            ...collectedTextToolCalls,
                            ...extractToolCallsFromText(fullText),
                        ]);

                        if (finalToolCalls.length > 0) {
                            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: finalToolCalls });
                            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
                        }

                        return fullText;
                    }
                } catch {
                    // Ignore malformed NDJSON lines and continue processing.
                }
            }
        }

        ndjsonBuffer += decoder.decode();
        const trailingLine = ndjsonBuffer.trim();
        if (trailingLine) {
            try {
                const json = JSON.parse(trailingLine);
                processJson(json);
            } catch {
                // Ignore trailing malformed content.
            }
        }

        if (isThinking) {
            onChunk(THINK_CLOSE);
            rawFullText += THINK_CLOSE;
            visibleFullText += THINK_CLOSE;
        }

        const finalToolCalls = normalizeToolCalls([
            ...toolCalls,
            ...collectedTextToolCalls,
            ...extractToolCallsFromText(rawFullText),
        ]);

        if (finalToolCalls.length > 0) {
            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: finalToolCalls });
            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
        }

        return visibleFullText;
    }
}