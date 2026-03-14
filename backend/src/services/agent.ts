import { llmService } from '../core/container';
import * as path from 'path';
import { VibeManager } from '../core/vibeManager';
import { getTools, executeTool } from '../core/tools';

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    const templatePath = path.resolve(process.cwd(), '../frontend/public/default.html');
    const vibeManager = await VibeManager.create(templatePath);
    const { tools, systemInstruction } = await getTools(vibeManager);

    let currentMessages = [...messages];
    let turnCount = 0;
    const maxTurns = 5;

    while (turnCount < maxTurns) {
        turnCount++;
        const result = await llmService.chatWithAgent(conversationId, currentMessages, tools, systemInstruction);

        if (result.stop_reason === 'tool_calls' && result.tool_calls) {
            // Add assistant's tool calls to history
            currentMessages.push({
                role: 'assistant',
                content: '',
                tool_calls: result.tool_calls
            });

            // Execute all tools
            for (const tc of result.tool_calls) {
                const name = tc.function.name;
                let args;
                if (typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
                    args = tc.function.arguments;
                } else {
                    try {
                        args = JSON.parse(tc.function.arguments || '{}');
                    } catch (e) {
                        args = {};
                    }
                }
                const output = await executeTool(vibeManager, name, args);
                
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
};

export const chatWithAgentStream = async (
    conversationId: string,
    messages: any[],
    onChunk: (token: string) => void
): Promise<string> => {
    const templatePath = path.resolve(process.cwd(), '../frontend/public/default.html');
    const vibeManager = await VibeManager.create(templatePath);
    const { tools, systemInstruction } = await getTools(vibeManager);

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
    const maxTurns = 5;

    while (turnCount < maxTurns) {
        turnCount++;
        
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
                 localText += token;
                 onChunk(token);
            }
        };

        await llmService.chatWithAgentStream(conversationId, currentMessages, wrappedCallback, tools, systemInstruction);

        if (localToolCalls.length > 0) {
             currentMessages.push({
                 role: 'assistant',
                 content: '',
                 tool_calls: localToolCalls
             });

             for (const tc of localToolCalls) {
                 const name = tc.function.name;
                 let args;
                 if (typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
                     args = tc.function.arguments;
                 } else {
                     try {
                         args = JSON.parse(tc.function.arguments || '{}');
                     } catch (e) {
                         args = {};
                     }
                 }
                 const output = await executeTool(vibeManager, name, args);
                 
                 currentMessages.push({
                     role: 'tool',
                     tool_call_id: tc.id,
                     content: output
                 });
                 
                 // Optionally stream back the tool result so the UI knows it finished
                 onChunk(`\n[TOOL_RESULT]${JSON.stringify({ id: tc.id, result: output })}[/TOOL_RESULT]\n`);
             }
             // Loop again to give LLM the results
        } else {
             return localText;
        }
    }
    
    return "I've hit the maximum number of tool execution steps.";
};
