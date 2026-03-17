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

/**
 * Attempts to extract tool calls from arbitrary text.
 * Supports multiple patterns:
 * 1. Standard JSON tool_calls array: { "tool_calls": [...] }
 * 2. Tool call objects within text
 * 3. Function-style tool calls
 */
export function extractToolCallsFromText(text: string): ParsedToolCall[] {
    const toolCalls: ParsedToolCall[] = [];

    // Pattern 1: Look for JSON structures that contain tool_calls
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

    return toolCalls;
}

/**
 * Normalizes a parsed tool call object to our standard format
 */
function normalizeToolCall(obj: any, index: number): ParsedToolCall | null {
    if (!obj) return null;

    // Handle different tool call structures
    const id = obj.id || obj.index !== undefined ? `tool_call_${obj.index}` : `tool_call_${index}`;
    
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
