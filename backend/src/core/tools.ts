import OpenAI from 'openai';
import { VibeManager } from './vibeManager';
import * as crypto from 'crypto';

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
                description: `Extract only the inner HTML content for a specific slide index. This returns content inside <section class=\"slide\"> and does not include the section wrapper itself. There are currently ${slideCount} slides available (1-indexed).`,
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
                description: 'Extract the deck-wide CSS variables block containing theme information shared across the entire slide deck.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_slide',
                description: `Overwrite only the inner HTML content of a specific slide index. This modifies only the content inside <section class=\"slide\"> and does not replace the section wrapper itself. You MUST provide the content hash obtained from a recent read_slide call to successfully update the slide.`,
                parameters: {
                    type: 'object',
                    properties: {
                        index: {
                            type: 'number',
                            description: `The 1-based index of the slide to write (1-${slideCount})`
                        },
                        newHtml: {
                            type: 'string',
                            description: `The new HTML content for the slide`
                        },
                        hash: {
                            type: 'string',
                            description: `The content hash of the slide obtained from a recent read_slide call`
                        }
                    },
                    required: ['index', 'newHtml', 'hash']
                }
            }
        }
    ];

    const systemInstruction = `You have access to ${slideCount} slides in the current presentation. The read_slide and write_slide tools only return/modify the content inside each <section class="slide"> (the section wrapper itself is preserved). The read_theme tool returns deck-wide theme CSS shared across the entire slide deck. Use read_slide and read_theme to inspect before modifications. To modify a slide, you MUST first read it using read_slide to obtain its content hash, then pass that hash to write_slide.`;

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
            const hash = crypto.createHash('sha256').update(slideHtml).digest('hex');
            return JSON.stringify({ html: slideHtml, hash });
        }
        
        if (name === 'write_slide') {
            const index = Number(args.index);
            if (isNaN(index)) return JSON.stringify({ error: 'Invalid slide index type' });
            if (!args.newHtml) return JSON.stringify({ error: 'Missing newHtml' });
            if (!args.hash) return JSON.stringify({ error: 'Missing hash. You must read the slide first to get the content hash.' });
            
            const currentHtml = vibeManager.getSlide(index);
            if (!currentHtml) {
                return JSON.stringify({ error: `Slide ${index} not found` });
            }
            
            const currentHash = crypto.createHash('sha256').update(currentHtml).digest('hex');
            if (currentHash !== args.hash) {
                return JSON.stringify({ error: 'Hash mismatch. The slide has been modified since you last read it, or you provided an incorrect hash. Please call read_slide again to get the latest hash.' });
            }
            
            await vibeManager.setSlide(index, args.newHtml);
            return JSON.stringify({ success: true, message: `Successfully updated slide ${index}` });
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
