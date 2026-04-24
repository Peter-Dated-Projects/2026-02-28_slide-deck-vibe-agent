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
 * Utility to parse and extract tool calls from text content,
 * including those that may appear within thinking blocks or other text.
 */
export interface ParsedToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

function extractBalancedObject(source: string, startIndex: number): string | null {
    if (startIndex < 0 || startIndex >= source.length || source[startIndex] !== '{') {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < source.length; i++) {
        const ch = source[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            depth++;
            continue;
        }

        if (ch === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(startIndex, i + 1);
            }
        }
    }

    return null;
}

function findNextToolCallStartIndex(source: string): number {
    const startMarkers = ['<execute_tool>', '<tool_call>', '<function_calls>', '<|tool_call>'];
    let nextIndex = -1;

    for (const marker of startMarkers) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex >= 0 && (nextIndex < 0 || markerIndex < nextIndex)) {
            nextIndex = markerIndex;
        }
    }

    const jsonPatterns = [/\{\s*"?\$?tool_calls"?\s*:/g, /\{\s*"?\$?tool_call"?\s*:/g];
    for (const pattern of jsonPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(source);
        if (match && match.index >= 0 && (nextIndex < 0 || match.index < nextIndex)) {
            nextIndex = match.index;
        }
    }

    return nextIndex;
}

function getPendingStartPrefixLength(source: string): number {
    if (!source) {
        return 0;
    }

    const startCandidates = [
        '<execute_tool>',
        '<tool_call>',
        '<function_calls>',
        '<|tool_call>',
        '{"tool_calls"',
        '{"tool_call"',
        '{"$tool_calls"',
        '{"$tool_call"',
    ];

    const maxCandidateLength = Math.max(...startCandidates.map((candidate) => candidate.length));
    const maxSuffixLength = Math.min(source.length, maxCandidateLength - 1);

    for (let length = maxSuffixLength; length > 0; length--) {
        const suffix = source.slice(-length);
        for (const candidate of startCandidates) {
            if (candidate.startsWith(suffix)) {
                return length;
            }
        }
    }

    return 0;
}

function consumeToolCallBlockFromStart(source: string): number | null {
    if (source.startsWith('<execute_tool>')) {
        const closeIndex = source.indexOf('</execute_tool>');
        return closeIndex >= 0 ? closeIndex + '</execute_tool>'.length : null;
    }

    if (source.startsWith('<tool_call>')) {
        const closeIndex = source.indexOf('</tool_call>');
        return closeIndex >= 0 ? closeIndex + '</tool_call>'.length : null;
    }

    if (source.startsWith('<function_calls>')) {
        const closeIndex = source.indexOf('</function_calls>');
        return closeIndex >= 0 ? closeIndex + '</function_calls>'.length : null;
    }

    if (source.startsWith('<|tool_call>')) {
        const closeIndex = source.indexOf('<tool_call|>');
        return closeIndex >= 0 ? closeIndex + '<tool_call|>'.length : null;
    }

    if (/^\{\s*"?\$?tool_calls"?\s*:/.test(source) || /^\{\s*"?\$?tool_call"?\s*:/.test(source)) {
        const balanced = extractBalancedObject(source, 0);
        return balanced ? balanced.length : null;
    }

    return null;
}

export function stripToolCallsFromText(text: string): string {
    if (!text) {
        return '';
    }

    let remaining = text;
    let visible = '';

    while (remaining) {
        const startIndex = findNextToolCallStartIndex(remaining);
        if (startIndex < 0) {
            visible += remaining;
            break;
        }

        if (startIndex > 0) {
            visible += remaining.slice(0, startIndex);
            remaining = remaining.slice(startIndex);
        }

        const consumedLength = consumeToolCallBlockFromStart(remaining);
        if (consumedLength === null) {
            break;
        }

        remaining = remaining.slice(consumedLength);
    }

    return visible;
}

function parseLooseArguments(rawArgs: string): Record<string, any> {
    const normalizedToken = '<|Q|>';
    const tokenNormalized = rawArgs.replace(/<\|"\|>/g, normalizedToken);

    // Gemma-style key/value payloads: key:<|"|>value<|"|>
    const tokenValuePattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*<\|Q\|>([\s\S]*?)<\|Q\|>/g;
    const tokenArgs: Record<string, any> = {};
    for (const match of tokenNormalized.matchAll(tokenValuePattern)) {
        const key = match[1];
        const value = match[2];
        if (!key || value === undefined) {
            continue;
        }
        tokenArgs[key] = value;
    }
    if (Object.keys(tokenArgs).length > 0) {
        return tokenArgs;
    }

    let normalizedJsonLike = tokenNormalized.replace(new RegExp(normalizedToken, 'g'), '"');

    try {
        return JSON.parse(normalizedJsonLike);
    } catch {
        // Try quoting unquoted keys
        try {
            const fixedArgsStr = normalizedJsonLike.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
            return JSON.parse(fixedArgsStr);
        } catch {
            // Loose parser for key:"value" pairs (including multiline values)
            const looseArgs: Record<string, any> = {};
            const trimmed = normalizedJsonLike.trim().replace(/^\{/, '').replace(/\}$/, '');
            const pairPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([\s\S]*?)"(?=\s*,\s*[A-Za-z_][A-Za-z0-9_]*\s*:|\s*$)/g;
            for (const match of trimmed.matchAll(pairPattern)) {
                const key = match[1];
                const value = match[2];
                if (!key || value === undefined) {
                    continue;
                }
                looseArgs[key] = value;
            }
            if (Object.keys(looseArgs).length > 0) {
                return looseArgs;
            }
        }
    }

    return { raw: rawArgs };
}
/**
 * Attempts to extract tool calls from arbitrary text.
 * Supports multiple patterns:
 * 1. Standard JSON tool_calls array: { "tool_calls": [...] }
 * 2. XML-style function_calls tags: <function_calls><invoke>...</invoke></function_calls>
 * 3. XML-style tool_call tags: <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
 */
export function extractToolCallsFromText(text: string): ParsedToolCall[] {
    const toolCalls: ParsedToolCall[] = [];
    // Pattern 1: Look for JSON structures that contain tool_calls (array)
    const jsonPattern = /"\$?tool_calls"\s*:\s*\[([\s\S]*?)\]/g;
    const jsonMatches = text.matchAll(jsonPattern);
    for (const match of jsonMatches) {
        try {
            // Reconstruct the tool_calls array
            const arrayStr = `[${match[1]}]`;
            const parsed = JSON.parse(arrayStr);
            if (Array.isArray(parsed)) {
                for (let i = 0; i < parsed.length; i++) {
                    const tc = parsed[i];
                    if (tc && typeof tc === 'object') {
                        const toolCall = normalizeToolCall(tc, i);
                        if (toolCall) {
                            toolCalls.push(toolCall);
                        }
                    }
                }
            }
        } catch {
            // Continue if parsing fails
        }
    }

    // Pattern 1b: Look for JSON structures that contain a singular tool_call object
    const singleJsonPattern = /"\$?tool_call"\s*:\s*(\{[\s\S]*?\})(?=\s*(?:,\s*"|\}\s*$))/g;
    const singleJsonMatches = text.matchAll(singleJsonPattern);
    for (const match of singleJsonMatches) {
        try {
            const objectStr = match[1];
            if (!objectStr) {
                continue;
            }
            const parsed = JSON.parse(objectStr);
            const toolCall = normalizeToolCall(parsed, toolCalls.length);
            if (toolCall) {
                toolCalls.push(toolCall);
            }
        } catch {
            // Continue if parsing fails
        }
    }

    // Pattern 2: Look for function_calls XML-style tags
    const xmlPattern = /<function_calls>([\s\S]*?)<\/function_calls>/g;
    const xmlMatches = text.matchAll(xmlPattern);
    for (const match of xmlMatches) {
        const content = match[1];
        if (!content) continue;
        // Extract invoke blocks
        const invokePattern = /<invoke[\s\S]*?>([\s\S]*?)<\/invoke>/g;
        const invokeMatches = content.matchAll(invokePattern);
        let invokeIndex = 0;
        for (const invokeMatch of invokeMatches) {
            const invokeContent = invokeMatch[1];
            if (!invokeContent) {
                invokeIndex++;
                continue;
            }
            // Try to parse as JSON
            try {
                const toolCall = JSON.parse(invokeContent);
                const normalized = normalizeToolCall(toolCall, invokeIndex);
                if (normalized) {
                    toolCalls.push(normalized);
                }
                invokeIndex++;
            } catch {
                // Try to extract tool name and args from text
                const toolNameMatch = invokeContent.match(/tool_name["\s]*[:=]["\s]*(['"]?)([^'"]+)\1/i);
                const argsMatch = invokeContent.match(/arguments["\s]*[:=]["\s]*['"]?({[\s\S]*?})['"]?/);
                if (toolNameMatch && argsMatch) {
                    try {
                        const name = toolNameMatch[2];
                        const argsStr = argsMatch[1];
                        if (name && argsStr) {
                            const args = JSON.parse(argsStr);
                            toolCalls.push({
                                id: `tool_call_${invokeIndex}`,
                                type: 'function',
                                function: {
                                    name,
                                    arguments: JSON.stringify(args)
                                }
                            });
                        }
                        invokeIndex++;
                    } catch {
                        // Continue
                    }
                }
            }
        }
    }
    // Pattern 3: Look for <tool_call> tags with <function=...> and <parameter=...> format
    const toolCallPattern = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    const toolCallMatches = text.matchAll(toolCallPattern);
    let toolCallIndex = 0;
    for (const match of toolCallMatches) {
        const content = match[1];
        if (!content) {
            toolCallIndex++;
            continue;
        }
        // Extract function name from <function=...> tag
        const funcMatch = content.match(/<function=([a-zA-Z_][a-zA-Z0-9_]*)>/);
        if (!funcMatch) {
            toolCallIndex++;
            continue;
        }
        const functionName = funcMatch[1];
        // Extract all parameters from <parameter=name>value</parameter> tags
        const paramPattern = /<parameter=([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/parameter>/g;
        const paramMatches = content.matchAll(paramPattern);
        const parameters: Record<string, any> = {};
        for (const paramMatch of paramMatches) {
            const paramName = paramMatch[1];
            const rawParamValue = paramMatch[2];
            if (!paramName || rawParamValue === undefined) {
                continue;
            }
            const paramValue = rawParamValue.trim();
            parameters[paramName] = paramValue;
        }
        if (functionName) {
            toolCalls.push({
                id: `tool_call_${toolCallIndex}`,
                type: 'function',
                function: {
                    name: functionName,
                    arguments: JSON.stringify(parameters)
                }
            });
        }
        toolCallIndex++;
    }
    // Pattern 4: Gemma style tool calls `<|tool_call|>call:function_name{args}<tool_call|>`
    const gemmaPattern = /<\|tool_call(?:\|)?>call:([a-zA-Z_][a-zA-Z0-9_]*)\s*(\{[\s\S]*?\})<tool_call\|>/g;
    const gemmaMatches = text.matchAll(gemmaPattern);
    let gemmaIndex = 0;
    for (const match of gemmaMatches) {
        const functionName = match[1];
        let argsStr = match[2];
        if (functionName && argsStr) {
            const parsedArgs = parseLooseArguments(argsStr);
            toolCalls.push({
                id: `tool_call_gemma_${gemmaIndex}`,
                type: 'function',
                function: {
                    name: functionName,
                    arguments: JSON.stringify(parsedArgs)
                }
            });
            gemmaIndex++;
        }
    }

    // Pattern 5: `<execute_tool> function_name{args}</execute_tool>`
    // Use balanced-brace extraction so CSS/HTML with inner braces doesn't truncate arguments.
    const executeToolPattern = /<execute_tool>([\s\S]*?)<\/execute_tool>/g;
    const executeMatches = text.matchAll(executeToolPattern);
    let executeIndex = 0;
    for (const match of executeMatches) {
        const rawInner = match[1];
        if (!rawInner) {
            executeIndex++;
            continue;
        }

        const normalizedInner = rawInner
            .replace(/<\|tool_call\|>/g, '')
            .replace(/<tool_call\|>/g, '')
            .trim();

        const functionMatch = normalizedInner.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
        if (!functionMatch || !functionMatch[1]) {
            executeIndex++;
            continue;
        }

        const functionName = functionMatch[1];
        const openBraceIndex = normalizedInner.indexOf('{', functionMatch[0].length);
        let argsStr = openBraceIndex >= 0 ? extractBalancedObject(normalizedInner, openBraceIndex) : null;

        if (functionName && argsStr) {
            const parsedArgs = parseLooseArguments(argsStr);
            toolCalls.push({
                id: `tool_call_exec_${executeIndex}`,
                type: 'function',
                function: {
                    name: functionName,
                    arguments: JSON.stringify(parsedArgs)
                }
            });
            executeIndex++;
        }
    }

    return toolCalls;
}

export class ToolCallStreamSanitizer {
    private buffer = '';

    addChunk(chunk: string): string {
        if (!chunk) {
            return '';
        }

        this.buffer += chunk;
        return this.drain(false);
    }

    flush(): string {
        return this.drain(true);
    }

    private drain(finalize: boolean): string {
        let remaining = this.buffer;
        let visible = '';

        while (remaining) {
            const startIndex = findNextToolCallStartIndex(remaining);
            if (startIndex < 0) {
                if (finalize) {
                    visible += remaining;
                    remaining = '';
                } else {
                    const pendingPrefixLength = getPendingStartPrefixLength(remaining);
                    const visibleLength = remaining.length - pendingPrefixLength;
                    if (visibleLength > 0) {
                        visible += remaining.slice(0, visibleLength);
                    }
                    remaining = remaining.slice(visibleLength);
                }
                break;
            }

            if (startIndex > 0) {
                visible += remaining.slice(0, startIndex);
                remaining = remaining.slice(startIndex);
            }

            const consumedLength = consumeToolCallBlockFromStart(remaining);
            if (consumedLength === null) {
                if (finalize) {
                    remaining = '';
                }
                break;
            }

            remaining = remaining.slice(consumedLength);
        }

        this.buffer = remaining;
        return visible;
    }
}
/**
 * Normalizes a parsed tool call object to our standard format
 */
function normalizeToolCall(obj: any, index: number): ParsedToolCall | null {
    if (!obj) return null;
    // Handle different tool call structures
    const id = obj.id || (obj.index !== undefined ? `tool_call_${obj.index}` : `tool_call_${index}`);
    let name = '';
    let args = '';
    // Extract function name and arguments
    if (obj.function) {
        name = obj.function.name || '';
        args = typeof obj.function.arguments === 'string' 
            ? obj.function.arguments 
            : JSON.stringify(obj.function.arguments || {});
    } else if (obj.name) {
        name = obj.name;
        args = typeof obj.arguments === 'string'
            ? obj.arguments
            : JSON.stringify(obj.arguments || {});
    } else if (obj.tool_name) {
        name = obj.tool_name;
        args = typeof obj.arguments === 'string'
            ? obj.arguments
            : JSON.stringify(obj.arguments || {});
    }
    if (name) {
        return {
            id,
            type: 'function',
            function: { name, arguments: args }
        };
    }
    return null;
}

/**
 * Incrementally parses streamed tokens and emits only newly discovered tool calls.
 */
export class ToolStreamManager {
    private buffer = '';
    private emittedCounts = new Map<string, number>();

    addChunk(chunk: string): ParsedToolCall[] {
        if (!chunk) {
            return [];
        }

        this.buffer += chunk;

        const parsed = extractToolCallsFromText(this.buffer);
        if (parsed.length === 0) {
            return [];
        }

        const encounteredCounts = new Map<string, number>();
        const newCalls: ParsedToolCall[] = [];

        for (const call of parsed) {
            const signature = `${call.function.name}\n${call.function.arguments}`;
            const encountered = (encounteredCounts.get(signature) ?? 0) + 1;
            encounteredCounts.set(signature, encountered);

            const alreadyEmitted = this.emittedCounts.get(signature) ?? 0;
            if (encountered > alreadyEmitted) {
                newCalls.push(call);
            }
        }

        for (const [signature, count] of encounteredCounts.entries()) {
            const alreadyEmitted = this.emittedCounts.get(signature) ?? 0;
            if (count > alreadyEmitted) {
                this.emittedCounts.set(signature, count);
            }
        }

        return newCalls;
    }

    reset(): void {
        this.buffer = '';
        this.emittedCounts.clear();
    }
}
