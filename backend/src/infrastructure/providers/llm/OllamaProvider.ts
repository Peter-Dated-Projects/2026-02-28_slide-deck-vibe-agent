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
        return [
            {
                role: 'system',
                content: instruction 
            },
            ...messages
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
            stream: false
        };
        
        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
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

        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
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
