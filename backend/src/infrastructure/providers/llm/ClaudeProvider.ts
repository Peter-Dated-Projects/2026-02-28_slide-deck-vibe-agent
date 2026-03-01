import Anthropic from '@anthropic-ai/sdk';
import type { ILLMService } from "../../../core/interfaces/ILLMService";
import type { IDatabaseService } from "../../../core/interfaces/IDatabaseService";
import type { IStorageService } from "../../../core/interfaces/IStorageService";

export class ClaudeProvider implements ILLMService {
    private anthropic: Anthropic;
    private dbService: IDatabaseService;
    private storageService: IStorageService;
    private tools: any[];

    constructor(apiKey: string, dbService: IDatabaseService, storageService: IStorageService) {
        this.anthropic = new Anthropic({ apiKey });
        this.dbService = dbService;
        this.storageService = storageService;

        this.tools = [
            {
                name: "generate_slide_component",
                description: "Generates a specific slide component (React/Tailwind) and saves it to the object storage for the presentation.",
                input_schema: {
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
            },
            {
                name: "finalize_presentation_theme",
                description: "Finalize the overall theme settings for the presentation. Returns confirmation.",
                input_schema: {
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
        ];
    }

    async processToolCall(toolCall: any, conversationId: string) {
        console.log(`Executing tool: ${toolCall.name}`);
        if (toolCall.name === 'generate_slide_component') {
            const { slideNumber, componentCode, fileName } = toolCall.input;
            const objectKey = `slides/${conversationId}/${fileName}`;
            
            await this.storageService.uploadFile(objectKey, componentCode, 'text/plain');
            
            // Record in db if it doesn't exist
            await this.dbService.query(
                'INSERT INTO slides (conversation_id, minio_object_key) VALUES ($1, $2)',
                [conversationId, objectKey]
            );

            return {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: `Successfully generated and saved ${fileName} to storage at ${objectKey}`
            };
        }

        if (toolCall.name === 'finalize_presentation_theme') {
            const themeData = toolCall.input;
            // Update all slides in this conversation with the theme data
            await this.dbService.query(`UPDATE slides SET theme_data = $1 WHERE conversation_id = $2`, [themeData, conversationId]);
            return {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: `Successfully saved theme data to database.`
            };
        }
        
        return {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: `Unknown tool ${toolCall.name}`,
            is_error: true
        };
    }

    async chatWithAgent(conversationId: string, messages: any[]) {
        const formattedMessages = messages.map(m => ({
            role: m.role === 'tool' ? 'user' : m.role, // Handle tool responses as user
            content: m.content
        }));

        const response = await this.anthropic.messages.create({
            model: 'claude-3-7-sonnet-20250219',
            max_tokens: 4096,
            temperature: 0.7,
            system: "You are Vibe Agent, an expert frontend engineer creating beautiful web-native presentations. You communicate directly with the user to understand their slide deck needs. When ready to build, you MUST use the generate_slide_component tool to create individual slides (React+Tailwind) and finalize_presentation_theme to set the design tokens. Keep slides modern, interactive, and visually stunning.",
            messages: formattedMessages,
            tools: this.tools as any
        });

        return response;
    }
}
