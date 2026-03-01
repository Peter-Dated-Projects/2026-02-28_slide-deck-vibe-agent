import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";

export class OllamaProvider implements ILLMService {
    private baseUrl: string;
    private dbService: IDatabaseService;
    private storageService: IStorageService;
    private tools: any[];

    constructor(baseUrl: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.baseUrl = baseUrl;
        this.dbService = dbService;
        this.storageService = storageService;

        // Same tools structured for Ollama / OpenAI
        this.tools = [
            {
                type: 'function',
                function: {
                    name: "generate_slide_component",
                    description: "Generates a specific slide component (React/Tailwind) and saves it to the object storage for the presentation.",
                    parameters: {
                        type: "object",
                        properties: {
                            slideNumber: {
                                type: "integer",
                                description: "The slide number (1-indexed)"
                            },
                            componentCode: {
                                type: "string",
                                description: "The raw React component code using Tailwind CSS for styling"
                            },
                            fileName: {
                                type: "string",
                                description: "Suggested file name, e.g., Slide1.tsx"
                            }
                        },
                        required: ["slideNumber", "componentCode", "fileName"]
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: "finalize_presentation_theme",
                    description: "Finalize the overall theme settings for the presentation. Returns confirmation.",
                    parameters: {
                        type: "object",
                        properties: {
                            colors: {
                                type: "object",
                                properties: {
                                    primary: { type: "string" },
                                    secondary: { type: "string" },
                                    background: { type: "string" },
                                    text: { type: "string" }
                                },
                                required: ["primary", "secondary", "background", "text"]
                            },
                            fontFamily: { type: "string" }
                        },
                        required: ["colors", "fontFamily"]
                    }
                }
            }
        ];
    }

    async processToolCall(toolCall: any, conversationId: string) {
        console.log(`Executing tool: ${toolCall.name} (Ollama)`);
        
        let toolName = toolCall.name || (toolCall.function && toolCall.function.name);
        let input = toolCall.input || (toolCall.function && JSON.parse(toolCall.function.arguments));

        if (toolName === 'generate_slide_component') {
            const { slideNumber, componentCode, fileName } = input;
            const objectKey = `slides/${conversationId}/${fileName}`;
            
            await this.storageService.uploadFile(objectKey, componentCode, 'text/plain');
            
            await this.dbService.query(
                'INSERT INTO slides (conversation_id, minio_object_key) VALUES ($1, $2)',
                [conversationId, objectKey]
            );

            return {
                type: 'tool_result',
                tool_use_id: toolCall.id || 'ollama_' + Math.random(),
                content: `Successfully generated and saved ${fileName} to storage at ${objectKey}`
            };
        }

        if (toolName === 'finalize_presentation_theme') {
            const themeData = input;
            await this.dbService.query(`UPDATE slides SET theme_data = $1 WHERE conversation_id = $2`, [themeData, conversationId]);
            return {
                type: 'tool_result',
                tool_use_id: toolCall.id || 'ollama_' + Math.random(),
                content: `Successfully saved theme data to database.`
            };
        }
        
        return {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: `Unknown tool ${toolName}`,
            is_error: true
        };
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        // Direct call to Ollama's chat API
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.2', // using a known tool calling model
                messages: [
                    {
                        role: 'system',
                        content: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. When ready to build, you MUST use the generate_slide_component tool to create individual slides (React+Tailwind) and finalize_presentation_theme to set the design tokens. Keep slides modern, interactive, and visually stunning."
                    },
                    ...messages
                ],
                tools: this.tools,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data: any = await response.json();
        
        // Return a shape that the controller/router can parse if needed or just return raw
        // Adapting specifically to Anthropic schema so `agent.ts` callers don't need a huge rewrite
        return {
            content: data.message?.tool_calls ? [] : [{ type: 'text', text: data.message?.content }],
            stop_reason: data.message?.tool_calls?.length > 0 ? 'tool_use' : 'end_turn',
            // Mock Anthropic's tool_calls response 
            ...(data.message?.tool_calls?.length > 0 ? {
                content: data.message.tool_calls.map((t: any, idx: number) => ({
                    type: 'tool_use',
                    id: t.function.name + '_' + idx,
                    name: t.function.name,
                    input: t.function.arguments
                }))
            } : {})
        };
    }
}
