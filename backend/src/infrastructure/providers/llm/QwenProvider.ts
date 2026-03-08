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

    private buildMessages(messages: any[]) {
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
                content: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning."
            },
            ...formatted
        ] as any[];
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        const response = await this.openai.chat.completions.create({
            model: this.model,
            messages: this.buildMessages(messages),
            max_tokens: 4096,
            temperature: 0.7,
        });

        const message = response.choices[0]?.message;
        if (!message) {
            throw new Error('Qwen returned no choices in response.');
        }

        return {
            content: [{ type: 'text', text: message.content ?? '' }],
            stop_reason: 'end_turn'
        };
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void
    ): Promise<string> {
        const stream = await this.openai.chat.completions.create({
            model: this.model,
            messages: this.buildMessages(messages),
            max_tokens: 4096,
            temperature: 0.7,
            stream: true,
        });

        let fullText = '';
        for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content ?? '';
            if (token) {
                onChunk(token);
                fullText += token;
            }
        }
        return fullText;
    }
}
