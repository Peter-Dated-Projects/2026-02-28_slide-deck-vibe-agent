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

/**
 * Tests for extracting tool calls from thinking blocks
 */
import { describe, expect, it } from 'bun:test';
import { ToolCallStreamSanitizer, ToolStreamManager, extractToolCallsFromText } from '../../infrastructure/providers/llm/toolCallParser';

const STREAM_CHUNK_SIZE = 3;

function chunkAsStream(text: string, chunkSize = STREAM_CHUNK_SIZE): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

function extractToolCallsFromStream(text: string): any[] {
    const manager = new ToolStreamManager();
    const calls: any[] = [];
    for (const chunk of chunkAsStream(text)) {
        calls.push(...manager.addChunk(chunk));
    }
    return calls;
}

function sanitizeVisibleTextFromStream(text: string): { visibleText: string; emissions: string[] } {
    const sanitizer = new ToolCallStreamSanitizer();
    const emissions: string[] = [];

    for (const chunk of chunkAsStream(text)) {
        emissions.push(sanitizer.addChunk(chunk));
    }

    emissions.push(sanitizer.flush());

    return {
        visibleText: emissions.join(''),
        emissions,
    };
}

describe('extractToolCallsFromText', () => {
    it('should extract tool call from JSON with singular tool_call object', () => {
        const text = `
        Let me call one function.
        { "tool_call": {
            "id": "call_single_1",
            "type": "function",
            "function": {
                "name": "read_full_html_document",
                "arguments": "{\\"page\\": 1}"
            }
        }}
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('read_full_html_document');
    });

    it('should extract tool calls from JSON with tool_calls array', () => {
        const text = `
        Let me think about this...
        { "tool_calls": [
            {
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "update_slide",
                    "arguments": "{\\"slide_index\\": 2}"
                }
            }
        ]}
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('update_slide');
    });
    it('should extract tool calls from XML-style function_calls tags', () => {
        const text = `
        <function_calls>
            <invoke name="update_slide">
            {
                "id": "call_456",
                "type": "function",
                "function": {
                    "name": "update_slide",
                    "arguments": "{\\"content\\": \\"New slide\\"}"
                }
            }
            </invoke>
        </function_calls>
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls.length).toBeGreaterThan(0);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('update_slide');
    });
    it('should extract multiple tool calls', () => {
        const text = `
        { "tool_calls": [
            {
                "id": "call_1",
                "function": {
                    "name": "add_slide",
                    "arguments": "{}"
                }
            },
            {
                "id": "call_2",
                "function": {
                    "name": "update_slide",
                    "arguments": "{\\"text\\": \\"Title\\"}"
                }
            }
        ]}
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls.length).toBe(2);
        const firstToolCall = toolCalls[0];
        const secondToolCall = toolCalls[1];
        expect(firstToolCall).toBeDefined();
        expect(secondToolCall).toBeDefined();
        if (!firstToolCall || !secondToolCall) throw new Error('Expected two tool calls');
        expect(firstToolCall.function.name).toBe('add_slide');
        expect(secondToolCall.function.name).toBe('update_slide');
    });
    it('should handle tool calls inside thinking blocks', () => {
        const text = `
        <think>
        The user wants to modify the presentation. Let me use the tools to update the slide.
        { "tool_calls": [
            {
                "id": "call_789",
                "function": {
                    "name": "update_slide",
                    "arguments": "{\\"background\\": \\"blue\\"}"
                }
            }
        ]}
        </think>
        I'll update the slide background color for you.
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('update_slide');
    });
    it('should extract tool calls from execute_tool tags', () => {
        const text = `
        <execute_tool>read_full_html_document{"page":1}</execute_tool>
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('read_full_html_document');
    });
    it('should extract execute_tool calls when arguments include CSS braces', () => {
        const text = `
        <execute_tool> theme{action:<|"|>write<|"|>,css:<|"|>body { color: red; } .slide { padding: 4rem; }<|"|>,hash:<|"|>abc123<|"|>} </execute_tool>
        `;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(1);
        const firstToolCall = toolCalls[0];
        expect(firstToolCall).toBeDefined();
        if (!firstToolCall) throw new Error('Expected first tool call');
        expect(firstToolCall.function.name).toBe('theme');
        const args = JSON.parse(firstToolCall.function.arguments);
        expect(args.action).toBe('write');
        expect(args.css).toContain('body { color: red; }');
        expect(args.css).toContain('.slide { padding: 4rem; }');
        expect(args.hash).toBe('abc123');
    });
    it('should strip tool call blocks from visible stream output', () => {
        const text = 'Before <execute_tool>read_slide{"page":1}</execute_tool> after';
        const { visibleText } = sanitizeVisibleTextFromStream(text);
        expect(visibleText).toBe('Before  after');
    });
    it('should hide tool-call payload while streaming 3 chars at a time', () => {
        const text = 'Before <execute_tool>read_slide{"page":1}</execute_tool> after';
        const { visibleText, emissions } = sanitizeVisibleTextFromStream(text);

        expect(visibleText).toBe('Before  after');
        expect(emissions.join('')).not.toContain('read_slide');
        expect(emissions.join('')).not.toContain('"page"');
    });
    it('should not extract malformed tool calls', () => {
        const text = `Some text with { broken json ]}`;
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(0);
    });
    it('should return empty array when no tool calls found', () => {
        const text = 'Just some regular assistant text with no tool calls.';
        const toolCalls = extractToolCallsFromStream(text);
        expect(toolCalls).toHaveLength(0);
    });
    it('should keep one-shot extraction parity with stream extraction', () => {
        const text = 'Before <execute_tool>read_full_html_document{"page":1}</execute_tool> after';
        const direct = extractToolCallsFromText(text);
        const streamed = extractToolCallsFromStream(text);

        expect(streamed).toHaveLength(direct.length);
        expect(streamed[0]?.function?.name).toBe(direct[0]?.function?.name);
        expect(streamed[0]?.function?.arguments).toBe(direct[0]?.function?.arguments);
    });
});
