import { VibeManager } from './vibeManager';

export const agentToolSchemas = [
    {
        type: "function" as const,
        function: {
            name: "GetDeckStructure",
            description: "Gets the table of contents for the slide deck, returning an array of slide IDs and their titles. Call this first to orient yourself.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "ReadGlobalTheme",
            description: "Reads the current CSS block containing the global theme variables like --vibe-primary, fonts, etc.",
            parameters: {
                type: "object",
                properties: {},
                required: []
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "UpdateTheme",
            description: "Overwrites the CSS theme block. Ensure you pass valid CSS variables like --vibe-primary inside the root.",
            parameters: {
                type: "object",
                properties: {
                    newCss: { type: "string", description: "The new CSS string to insert." }
                },
                required: ["newCss"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "SearchSlides",
            description: "Searches all slides for a text query and returns matching slide IDs and snippets.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "The text to search for." }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "ReadSlide",
            description: "Reads the HTML content of a specific slide ID. Use GetDeckStructure first to find the ID.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "number", description: "The ID of the slide to read." }
                },
                required: ["id"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "UpdateSlide",
            description: "Overwrites the entire HTML of a specific slide ID.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "number", description: "The ID of the slide to overwrite." },
                    newHtml: { type: "string", description: "The complete new HTML for the slide." }
                },
                required: ["id", "newHtml"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "AddSlide",
            description: "Appends a new slide to the very end of the deck.",
            parameters: {
                type: "object",
                properties: {
                    newHtml: { type: "string", description: "The HTML content for the new slide." }
                },
                required: ["newHtml"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "DeleteSlide",
            description: "Removes a slide entirely from the deck.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "number", description: "The ID of the slide to delete." }
                },
                required: ["id"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "InsertSlideAt",
            description: "Inserts a new slide at a specific array index position (0-based) in the presentation order.",
            parameters: {
                type: "object",
                properties: {
                    position: { type: "number", description: "The array index (0-based) where the slide should be placed." },
                    newHtml: { type: "string", description: "The HTML content for the new slide." }
                },
                required: ["position", "newHtml"]
            }
        }
    },
    {
        type: "function" as const,
        function: {
            name: "ReorderSlide",
            description: "Moves an existing slide ID to a new array index position (0-based).",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "number", description: "The ID of the slide to move." },
                    newPosition: { type: "number", description: "The new array index (0-based) where the slide will be placed." }
                },
                required: ["id", "newPosition"]
            }
        }
    }
];

/**
 * Routes tool executions to the VibeManager instance.
 * @param toolName The name of the tool called.
 * @param args The arguments passed to the tool.
 * @param vibeManager The initialized VibeManager instance.
 * @returns Serialized JSON string of the result.
 */
export async function executeTool(toolName: string, args: any, vibeManager: VibeManager): Promise<string> {
    try {
        switch (toolName) {
            case 'GetDeckStructure':
                return JSON.stringify({ structure: vibeManager.getDeckStructure() });

            case 'ReadGlobalTheme':
                return JSON.stringify({ themeCss: vibeManager.readGlobalTheme() });

            case 'UpdateTheme':
                await vibeManager.setTheme(args.newCss);
                return JSON.stringify({ success: true, message: "Theme updated successfully." });

            case 'SearchSlides':
                return JSON.stringify({ results: vibeManager.searchSlides(args.query) });

            case 'ReadSlide':
                const slide = vibeManager.getSlide(args.id);
                if (slide === null) return JSON.stringify({ error: `Slide ID ${args.id} not found.` });
                return JSON.stringify({ slideHtml: slide });

            case 'UpdateSlide':
                if (vibeManager.getSlide(args.id) === null) {
                    return JSON.stringify({ error: `Slide ID ${args.id} not found.` });
                }
                await vibeManager.setSlide(args.id, args.newHtml);
                return JSON.stringify({ success: true, message: `Slide ${args.id} updated successfully.` });

            case 'AddSlide':
                await vibeManager.addSlide(args.newHtml);
                return JSON.stringify({ success: true, message: "Slide appended successfully." });

            case 'DeleteSlide':
                await vibeManager.deleteSlide(args.id);
                return JSON.stringify({ success: true, message: `Slide ${args.id} deleted successfully.` });

            case 'InsertSlideAt':
                await vibeManager.insertSlideAt(args.position, args.newHtml);
                return JSON.stringify({ success: true, message: `Slide inserted at position ${args.position}.` });

            case 'ReorderSlide':
                await vibeManager.reorderSlide(args.id, args.newPosition);
                return JSON.stringify({ success: true, message: `Slide ${args.id} moved to position ${args.newPosition}.` });

            default:
                return JSON.stringify({ error: `Tool ${toolName} not found or unsupported.` });
        }
    } catch (error: any) {
        return JSON.stringify({ error: `Error executing tool ${toolName}: ${error.message}` });
    }
}
