import OpenAI from 'openai';
import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";

export class QwenProvider implements ILLMService {
    private openai: OpenAI;
    private model: string;
    private dbService: IDatabaseService;
    private storageService: IStorageService;

    constructor(apiKey: string, model: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.openai = new OpenAI({ 
            apiKey,
            baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        });
        this.model = model;
        this.dbService = dbService;
        this.storageService = storageService;
    }

    private buildMessages(messages: any[], systemInstruction?: string) {
        const instruction = systemInstruction || "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning.";
        
        const formatted = messages.map(m => {
            if (m.role === 'tool' || (m.role === 'user' && m.content && Array.isArray(m.content))) {
                return {
                    role: 'user',
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                };
            }
            return { role: m.role, content: m.content };
        });
        return [
            {
                role: 'system',
                content: instruction 
            },
            ...formatted
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

        if (message.tool_calls && message.tool_calls.length > 0) {
             return {
                 content: [],
                 tool_calls: message.tool_calls,
                 stop_reason: 'tool_calls'
             };
        }

        return {
            content: [{ type: 'text', text: message.content ?? '' }],
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

        const stream = await this.openai.chat.completions.create(params) as any;

        let fullText = '';
        let toolCallsCache: any[] = [];
        
        for await (const chunk of stream) {
            // Handle standard text content
            const token = chunk.choices[0]?.delta?.content ?? '';
            if (token) {
                onChunk(token);
                fullText += token;
            }
            
            // Handle tool calls streaming (Qwen/OpenAI format)
            const toolCallChunks = chunk.choices[0]?.delta?.tool_calls;
            if (toolCallChunks) {
                for (const tc of toolCallChunks) {
                    const idx = tc.index;
                    if (!toolCallsCache[idx]) {
                        toolCallsCache[idx] = {
                            id: tc.id,
                            type: tc.type || 'function',
                            function: { name: tc.function?.name || '', arguments: '' }
                        };
                    }
                    if (tc.function?.arguments) {
                        toolCallsCache[idx].function.arguments += tc.function.arguments;
                    }
                }
            }
        }
        
        // If we captured tool calls during the stream, emit them as a final special chunk
        if (toolCallsCache.length > 0) {
            const tcStr = JSON.stringify({ type: 'tool_calls', tool_calls: toolCallsCache });
            onChunk(`[TOOL_CALLS]${tcStr}[/TOOL_CALLS]`);
        }
        
        return fullText;
    }
}
