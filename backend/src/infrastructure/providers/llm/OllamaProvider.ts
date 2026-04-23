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
import { extractToolCallsFromText } from "./toolCallParser";
export class OllamaProvider implements ILLMService {
    private baseUrl: string;
    private model: string;
    private dbService: IDatabaseService;
    private storageService: IStorageService;
    constructor(baseUrl: string, model: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.baseUrl = baseUrl;
        this.model = model;
        this.dbService = dbService;
        this.storageService = storageService;
    }
    private buildMessages(messages: any[], systemInstruction?: string) {
        const instruction = systemInstruction || "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning.";
        const normalizedMessages = messages.map((m: any) => {
            if (m?.role === 'assistant' && Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) {
                const toolCallText = m.tool_calls.map((tc: any) => {
                    const name = tc?.function?.name || 'unknown';
                    const args = typeof tc?.function?.arguments === 'string'
                        ? tc.function.arguments
                        : JSON.stringify(tc?.function?.arguments || {});
                    return `[Tool Call: ${name}]\n${args}`;
                }).join('\n\n');
                const prefix = typeof m?.content === 'string' && m.content.trim() ? `${m.content}\n\n` : '';
                return {
                    role: 'assistant',
                    content: `${prefix}${toolCallText}`
                };
            }

            if (m?.role === 'tool') {
                const content = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
                return {
                    role: 'user',
                    content: `[Tool Result for ${m?.tool_call_id || 'unknown'}]\n${content}`
                };
            }

            return m;
        });
        return [
            {
                role: 'system',
                content: instruction 
            },
            ...normalizedMessages
        ];
    }
    private truncate(value: string, max = 240): string {
        if (value.length <= max) return value;
        return `${value.slice(0, max)}...`;
    }
    private summarizeMessages(messages: any[]): any[] {
        return messages.slice(-12).map((m, idx) => {
            const content = m?.content;
            const contentType = Array.isArray(content) ? 'array' : typeof content;
            const contentStr =
                typeof content === 'string'
                    ? content
                    : (() => {
                        try {
                            return JSON.stringify(content ?? '');
                        } catch {
                            return String(content ?? '');
                        }
                    })();
            const toolCalls = Array.isArray(m?.tool_calls) ? m.tool_calls : [];
            const toolCallSummary = toolCalls.slice(0, 5).map((tc: any) => {
                const args = tc?.function?.arguments;
                const argsType = Array.isArray(args) ? 'array' : typeof args;
                let argsParseOk: boolean | null = null;
                if (typeof args === 'string') {
                    try {
                        JSON.parse(args);
                        argsParseOk = true;
                    } catch {
                        argsParseOk = false;
                    }
                }
                return {
                    id: tc?.id,
                    name: tc?.function?.name,
                    argsType,
                    argsParseOk,
                    argsPreview: this.truncate(typeof args === 'string' ? args : JSON.stringify(args ?? {}), 180)
                };
            });
            return {
                idx,
                role: m?.role,
                contentType,
                contentLength: contentStr.length,
                contentPreview: this.truncate(contentStr.replace(/\s+/g, ' '), 260),
                hasToolCalls: toolCalls.length > 0,
                toolCallId: m?.tool_call_id ?? null,
                toolCalls: toolCallSummary
            };
        });
    }
    private logOllamaRequestDebug(
        methodName: 'chatWithAgent' | 'chatWithAgentStream',
        conversationId: string,
        body: any,
        payload: string,
        status: number,
        statusText: string,
        errorBody: string
    ): void {
        const payloadHead = payload.slice(0, 1600);
        const payloadTail = payload.length > 1600 ? payload.slice(-1600) : '';
        const toolNames = Array.isArray(body?.tools)
            ? body.tools.map((t: any) => t?.function?.name).filter(Boolean)
            : [];
        console.error('[ollama-debug] request failed', {
            methodName,
            conversationId,
            model: body?.model,
            stream: body?.stream,
            status,
            statusText,
            errorBody,
            payloadBytes: payload.length,
            messageCount: Array.isArray(body?.messages) ? body.messages.length : 0,
            toolCount: toolNames.length,
            toolNames,
            recentMessages: this.summarizeMessages(Array.isArray(body?.messages) ? body.messages : []),
            payloadHead,
            payloadTail
        });
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
            stream: false
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
        }
        const payload = JSON.stringify(body);
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            this.logOllamaRequestDebug(
                'chatWithAgent',
                conversationId,
                body,
                payload,
                response.status,
                response.statusText,
                errorBody
            );
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        }
        const data: any = await response.json();
        // Handle tool calls if present
        if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
             return {
                 content: [],
                 tool_calls: data.message.tool_calls,
                 stop_reason: 'tool_calls'
             };
        }
        return {
            content: [{ type: 'text', text: data.message?.content }],
            stop_reason: 'end_turn'
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
            stream: true
        };
        if (tools && tools.length > 0) {
            body.tools = tools;
        }
        const payload = JSON.stringify(body);
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => '');
            this.logOllamaRequestDebug(
                'chatWithAgentStream',
                conversationId,
                body,
                payload,
                response.status,
                response.statusText,
                errorBody
            );
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let isThinking = false;
        let accumulatedThinking = '';
        let toolCallsCollected: any[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Ollama streams NDJSON — each chunk may contain multiple lines
            const lines = decoder.decode(value, { stream: true }).split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json: any = JSON.parse(line);
                    const thinkingToken: string = json.message?.thinking ?? '';
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
                    const token: string = json.message?.content ?? '';
                    if (token) {
                        if (isThinking) {
                            // Thinking block is ending, extract any tool calls from it
                            const extractedToolCalls = extractToolCallsFromText(accumulatedThinking);
                            if (extractedToolCalls.length > 0) {
                                toolCallsCollected.push(...extractedToolCalls);
                            }
                            onChunk('</think>');
                            fullText += '</think>';
                            isThinking = false;
                            accumulatedThinking = '';
                        }
                        onChunk(token);
                        fullText += token;
                    }
                    // Ollama streaming tool calls (handled similarly to standard content)
                    // Note: Ollama usually returns tool calls in a single non-streamed chunk at the end,
                    // but we handle the structure if it streams it.
                    if (json.message?.tool_calls) {
                         toolCallsCollected.push(...json.message.tool_calls);
                    }
                    if (json.done) {
                        if (isThinking) {
                            // Extract tool calls from final thinking block
                            const extractedToolCalls = extractToolCallsFromText(accumulatedThinking);
                            if (extractedToolCalls.length > 0) {
                                toolCallsCollected.push(...extractedToolCalls);
                            }
                            onChunk('</think>');
                            fullText += '</think>';
                        }
                        // Emit all collected tool calls at the end
                        if (toolCallsCollected.length > 0) {
                            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: toolCallsCollected });
                            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
                        }
                        return fullText;
                    }
                } catch {
                    // Incomplete JSON chunk — skip
                }
            }
        }
        // Final check: emit any collected tool calls
        if (toolCallsCollected.length > 0) {
            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: toolCallsCollected });
            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
        }
        return fullText;
    }
}
