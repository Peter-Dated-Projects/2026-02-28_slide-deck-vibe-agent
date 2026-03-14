import OpenAI from 'openai';
import { VibeManager } from './vibeManager';

/**
 * Returns the tool definitions along with the current slide count instruction
 */
export const getTools = async (vibeManager: VibeManager): Promise<{ tools: OpenAI.Chat.ChatCompletionTool[], systemInstruction: string }> => {
    const slideCount = vibeManager.getSlideCount();
    
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
            type: 'function',
            function: {
                name: 'read_slide',
                description: `Extract HTML for a specific slide index. There are currently ${slideCount} slides available (1-indexed).`,
                parameters: {
                    type: 'object',
                    properties: {
                        index: {
                            type: 'number',
                            description: `The 1-based index of the slide to read (1-${slideCount})`
                        }
                    },
                    required: ['index']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_theme',
                description: 'Extract the CSS variables block containing the theme information.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        }
    ];

    const systemInstruction = `You have access to ${slideCount} slides in the current presentation. Use the read_slide and read_theme tools to inspect the presentation when the user asks questions about it or before making modifications.`;

    return { tools, systemInstruction };
};

/**
 * Executes a tool call and returns the result string
 */
export const executeTool = async (vibeManager: VibeManager, name: string, args: any): Promise<string> => {
    try {
        if (name === 'read_slide') {
            const index = Number(args.index);
            if (isNaN(index)) return JSON.stringify({ error: 'Invalid slide index type' });
            
            const slideHtml = vibeManager.getSlide(index);
            if (!slideHtml) {
                return JSON.stringify({ error: `Slide ${index} not found` });
            }
            return slideHtml;
        }
        
        if (name === 'read_theme') {
            const themeCss = vibeManager.getTheme();
            return themeCss || JSON.stringify({ error: 'No theme block found' });
        }
        
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    } catch (e: any) {
        return JSON.stringify({ error: e.message });
    }
};
