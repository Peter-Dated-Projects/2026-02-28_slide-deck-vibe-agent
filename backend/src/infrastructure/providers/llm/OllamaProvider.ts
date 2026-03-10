import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";
import { agentToolSchemas, executeTool } from '../../../core/agentTools';
import { VibeManager } from '../../../core/vibeManager';

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
                content: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning. Use your tools to surgically edit the presentation as needed."
            },
            ...formatted
        ];
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        const slideQuery = await this.dbService.query('SELECT minio_object_key FROM slides WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [conversationId]);
        if (!slideQuery.rows.length) throw new Error('No slide deck found for this conversation');
        const s3Key = slideQuery.rows[0].minio_object_key;

        let currentMessages = this.buildMessages(messages);

        while (true) {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: currentMessages,
                    stream: false,
                    tools: agentToolSchemas
                })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Ollama API error: ${response.statusText} - ${text}`);
            }

            const data: any = await response.json();
            const message = data.message;

            if (message?.tool_calls && message.tool_calls.length > 0) {
                currentMessages.push(message);
                const vibeManager = await VibeManager.create(s3Key, this.storageService);
                
                for (const tc of message.tool_calls) {
                    const args = tc.function.arguments || {};
                    const result = await executeTool(tc.function.name, args, vibeManager);
                    currentMessages.push({
                        role: 'tool',
                        content: result
                    });
                }
            } else {
                return {
                    content: [{ type: 'text', text: message?.content || '' }],
                    stop_reason: 'end_turn'
                };
            }
        }
    }

    async chatWithAgentStream(
        conversationId: string,
        messages: any[],
        onEvent: (event: string, data: any) => void
    ): Promise<string> {
        const slideQuery = await this.dbService.query('SELECT minio_object_key FROM slides WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [conversationId]);
        if (!slideQuery.rows.length) throw new Error('No slide deck found for this conversation');
        const s3Key = slideQuery.rows[0].minio_object_key;

        let currentMessages = this.buildMessages(messages);
        let fullText = '';

        while (true) {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages: currentMessages,
                    stream: true,
                    tools: agentToolSchemas
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama API error: ${response.statusText}`);
            }

            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let isToolCall = false;
            let lastMessage: any = null;
            let hasStartedThinking = false;
            let hasEndedThinking = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const lines = decoder.decode(value, { stream: true }).split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json: any = JSON.parse(line);
                        
                        if (json.message) {
                            lastMessage = json.message;
                            if (json.message.tool_calls) {
                                isToolCall = true;
                                if (hasStartedThinking && !hasEndedThinking) {
                                    hasEndedThinking = true;
                                    onEvent('token', { token: '\n</think>\n\n' });
                                    fullText += '\n</think>\n\n';
                                }
                            }
                            
                            if (json.message.thinking) {
                                if (!hasStartedThinking) {
                                    hasStartedThinking = true;
                                    onEvent('token', { token: '<think>\n' });
                                    fullText += '<think>\n';
                                }
                                onEvent('token', { token: json.message.thinking });
                                fullText += json.message.thinking;
                            }

                            const token = json.message.content || '';
                            if (token && !isToolCall) {
                                if (hasStartedThinking && !hasEndedThinking) {
                                    hasEndedThinking = true;
                                    onEvent('token', { token: '\n</think>\n\n' });
                                    fullText += '\n</think>\n\n';
                                }
                                onEvent('token', { token });
                                fullText += token;
                            }
                        }

                        if (json.done) {
                            if (hasStartedThinking && !hasEndedThinking) {
                                hasEndedThinking = true;
                                onEvent('token', { token: '\n</think>\n\n' });
                                fullText += '\n</think>\n\n';
                            }
                            break;
                        }
                    } catch {}
                }
            }

            if (isToolCall && lastMessage?.tool_calls) {
                currentMessages.push(lastMessage);
                
                const vibeManager = await VibeManager.create(s3Key, this.storageService);
                
                for (const tc of lastMessage.tool_calls) {
                    const args = tc.function.arguments || {};
                    onEvent('tool_call', { name: tc.function.name, args });
                    const result = await executeTool(tc.function.name, args, vibeManager);
                    onEvent('tool_result', { name: tc.function.name, result });
                    
                    currentMessages.push({
                        role: 'tool',
                        content: result
                    });
                }
            } else {
                break;
            }
        }

        return fullText;
    }
}
