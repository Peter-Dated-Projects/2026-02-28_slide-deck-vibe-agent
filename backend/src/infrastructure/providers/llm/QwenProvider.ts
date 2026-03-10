import OpenAI from 'openai';
import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";
import { agentToolSchemas, executeTool } from '../../../core/agentTools';
import { VibeManager } from '../../../core/vibeManager';

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
                    role: 'user', // strictly for standard text if not native tool msg, but we should use literal
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
        ] as any[];
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        const slideQuery = await this.dbService.query('SELECT minio_object_key FROM slides WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1', [conversationId]);
        if (!slideQuery.rows.length) throw new Error('No slide deck found for this conversation');
        const s3Key = slideQuery.rows[0].minio_object_key;

        let currentMessages = this.buildMessages(messages);

        while (true) {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: currentMessages,
                max_tokens: 4096,
                temperature: 0.7,
                tools: agentToolSchemas as any
            });

            const message = response.choices[0]?.message;
            if (!message) throw new Error('Qwen returned no choices.');

            if (message.tool_calls && message.tool_calls.length > 0) {
                currentMessages.push(message);
                const vibeManager = await VibeManager.create(s3Key, this.storageService);
                
                for (const toolCall of message.tool_calls) {
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    const result = await executeTool(toolCall.function.name, args, vibeManager);
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result
                    });
                }
            } else {
                return {
                    content: [{ type: 'text', text: message.content ?? '' }],
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
        
        // Ensure standard OpenAI message roles
        let currentMessages = messages.map(m => m);
        
        currentMessages.unshift({
            role: 'system',
            content: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. Keep slides modern, interactive, and visually stunning. Use your tools to surgically edit the presentation as needed."
        });

        let fullText = '';
        
        while (true) {
            const stream = await this.openai.chat.completions.create({
                model: this.model,
                messages: currentMessages,
                max_tokens: 4096,
                temperature: 0.7,
                stream: true,
                stream_options: { include_usage: true },
                tools: agentToolSchemas as any
            });

            let toolCalls: any = {};
            let isToolCall = false;
            let hasStartedThinking = false;
            let hasEndedThinking = false;

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta as any;
                if (!delta) continue;
                
                if (delta.tool_calls) {
                    if (hasStartedThinking && !hasEndedThinking) {
                        hasEndedThinking = true;
                        onEvent('token', { token: '\n</think>\n\n' });
                        fullText += '\n</think>\n\n';
                    }
                    isToolCall = true;
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCalls[idx]) {
                            toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
                        }
                        if (tc.function?.arguments) {
                            toolCalls[idx].function.arguments += tc.function.arguments;
                        }
                    }
                }

                if (delta.reasoning_content) {
                    if (!hasStartedThinking) {
                        hasStartedThinking = true;
                        onEvent('token', { token: '<think>\n' });
                        fullText += '<think>\n';
                    }
                    onEvent('token', { token: delta.reasoning_content });
                    fullText += delta.reasoning_content;
                }

                if (delta.content) {
                    if (hasStartedThinking && !hasEndedThinking) {
                        hasEndedThinking = true;
                        onEvent('token', { token: '\n</think>\n\n' });
                        fullText += '\n</think>\n\n';
                    }
                    onEvent('token', { token: delta.content });
                    fullText += delta.content;
                }
            }

            if (hasStartedThinking && !hasEndedThinking) {
                hasEndedThinking = true;
                onEvent('token', { token: '\n</think>\n\n' });
                fullText += '\n</think>\n\n';
            }

            if (isToolCall) {
                const toolCallsArray = Object.values(toolCalls);
                currentMessages.push({
                    role: 'assistant',
                    content: '',
                    tool_calls: toolCallsArray
                });
                
                const vibeManager = await VibeManager.create(s3Key, this.storageService);
                
                for (const tc of toolCallsArray as any[]) {
                    let args = {};
                    try { args = JSON.parse(tc.function.arguments); } catch {}
                    
                    onEvent('tool_call', { name: tc.function.name, args });
                    const result = await executeTool(tc.function.name, args, vibeManager);
                    onEvent('tool_result', { name: tc.function.name, result });
                    
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
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
