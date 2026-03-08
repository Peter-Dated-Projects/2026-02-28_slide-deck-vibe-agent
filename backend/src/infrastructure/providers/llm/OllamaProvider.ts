import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";

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

    private buildMessages(messages: any[]) {
        return [
            {
                role: 'system',
                content: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning."
            },
            ...messages
        ];
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: this.buildMessages(messages),
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data: any = await response.json();
        
        return {
            content: [{ type: 'text', text: data.message?.content }],
            stop_reason: 'end_turn'
        };
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void
    ): Promise<string> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                messages: this.buildMessages(messages),
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Ollama streams NDJSON — each chunk may contain multiple lines
            const lines = decoder.decode(value, { stream: true }).split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json: any = JSON.parse(line);
                    const token: string = json.message?.content ?? '';
                    if (token) {
                        onChunk(token);
                        fullText += token;
                    }
                    if (json.done) return fullText;
                } catch {
                    // Incomplete JSON chunk — skip
                }
            }
        }

        return fullText;
    }
}
