import { llmService, dbService as db } from '../core/container';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { VibeManager } from '../core/vibeManager';
import { getTools, executeTool, type AgentRuntimeState } from '../core/tools';
import { loadDeckHtmlForProject, saveDeckHtmlForProject } from './projectDeck';

const createInitialWorkflowTasks = (): AgentRuntimeState['tasks'] => [
    { id: 'discovery-purpose', title: 'Collect slide deck purpose', done: false },
    { id: 'discovery-audience', title: 'Collect presenter audience', done: false },
    { id: 'discovery-theme', title: 'Collect preferred theme', done: false },
    { id: 'discovery-content', title: 'Collect source content for the deck', done: false },
    { id: 'planning-structure', title: 'Plan slide structure and subtopics from collected content', done: false },
    { id: 'planning-slide-tasks', title: 'Create per-slide tasks before editing', done: false }
];

const buildSystemInstructionWithTaskList = (baseInstruction: string, runtimeState: AgentRuntimeState) => {
    if (!runtimeState.tasks.length) {
        return `${baseInstruction}\n\nCurrent task checklist: (none yet)`;
    }

    const checklist = runtimeState.tasks
        .map((task: AgentRuntimeState['tasks'][number]) => `${task.done ? '[x]' : '[ ]'} ${task.id}: ${task.title}`)
        .join('\n');

    return `${baseInstruction}\n\nCurrent task checklist:\n${checklist}`;
};

const shortToolCompletionMessage = (toolName: string) => `Completed task: ${toolName}.`;

const createConversationVibeManager = async (conversationId: string) => {
    const res = await db.query('SELECT project_id FROM conversations WHERE id = $1', [conversationId]);
    const projectId = res.rows[0]?.project_id;
    if (!projectId) throw new Error("Project ID not found for conversation");

    const { html } = await loadDeckHtmlForProject(projectId);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-agent-'));
    const tempFilePath = path.join(tempDir, `${projectId}.html`);
    await fs.writeFile(tempFilePath, html, { encoding: 'utf-8' });
    const vibeManager = await VibeManager.create(tempFilePath);

    const persist = async () => {
        const updatedHtml = await fs.readFile(tempFilePath, { encoding: 'utf-8' });
        await saveDeckHtmlForProject(projectId, updatedHtml);
    };

    const cleanup = async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    };

    return { vibeManager, persist, cleanup };
};

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    const { vibeManager, persist, cleanup } = await createConversationVibeManager(conversationId);
    const { tools, systemInstruction } = await getTools(vibeManager);
    const runtimeState: AgentRuntimeState = { tasks: createInitialWorkflowTasks() };

    let currentMessages = [...messages];
    let turnCount = 0;
    const maxTurns = 50;

    try {
        while (turnCount < maxTurns) {
            turnCount++;
            const dynamicSystemInstruction = buildSystemInstructionWithTaskList(systemInstruction, runtimeState);
            const result = await llmService.chatWithAgent(conversationId, currentMessages, tools, dynamicSystemInstruction);

            if (result.stop_reason === 'tool_calls' && result.tool_calls) {
                // Add assistant's tool calls to history
                currentMessages.push({
                    role: 'assistant',
                    content: '',
                    tool_calls: result.tool_calls
                });

                // Execute all tools
                for (const tc of result.tool_calls) {
                    const name = tc.function.name;
                    let args;
                    if (typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
                        args = tc.function.arguments;
                    } else {
                        try {
                            args = JSON.parse(tc.function.arguments || '{}');
                        } catch (e) {
                            args = {};
                        }
                    }
                    const output = await executeTool(vibeManager, name, args, runtimeState);

                    try {
                        const parsed = JSON.parse(output);
                        if (parsed?.mutated) {
                            await persist();
                        }
                    } catch {
                        // keep going even if tool output is non-JSON
                    }

                    // Add tool result to history
                    currentMessages.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: output
                    });
                }
                // Loop back to LLM with the tool results
            } else {
                // Final response or stop
                return result;
            }
        }

        return { content: [{ type: 'text', text: "I've hit the maximum number of tool execution steps." }], stop_reason: 'max_turns' };
    } finally {
        await cleanup();
    }
};

export const chatWithAgentStream = async (
    conversationId: string,
    messages: any[],
    onChunk: (token: string) => void
): Promise<string> => {
    const { vibeManager, persist, cleanup } = await createConversationVibeManager(conversationId);
    const { tools, systemInstruction } = await getTools(vibeManager);
    const runtimeState: AgentRuntimeState = { tasks: createInitialWorkflowTasks() };

    try {
        if (!llmService.chatWithAgentStream) {
            // Fallback: non-streaming, emit full text as one chunk
            const result = await chatWithAgent(conversationId, messages);
            const text = result.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n');
            onChunk(text);
            return text;
        }

        let currentMessages = [...messages];
        let turnCount = 0;
        const maxTurns = 50;

        while (turnCount < maxTurns) {
            turnCount++;
        const dynamicSystemInstruction = buildSystemInstructionWithTaskList(systemInstruction, runtimeState);
        
        let localToolCalls: any[] = [];
        let localText = '';

        // Wrap the callback to intercept the tool_calls event
        const wrappedCallback = (token: string) => {
            if (token.startsWith('[TOOL_CALLS]') && token.endsWith('[/TOOL_CALLS]')) {
                 try {
                     const jsonStr = token.substring(12, token.length - 13);
                     const parsed = JSON.parse(jsonStr);
                     if (parsed.tool_calls) {
                         localToolCalls = parsed.tool_calls;
                     }
                 } catch (e) {
                     console.error("Error parsing streaming tool calls", e);
                 }
                 // pass to frontend so it can display them
                 onChunk(token);
            } else {
                  // Buffer text and only emit if this turn does not transition into tool calls.
                  localText += token;
            }
        };

           await llmService.chatWithAgentStream(conversationId, currentMessages, wrappedCallback, tools, dynamicSystemInstruction);

        if (localToolCalls.length > 0) {
             currentMessages.push({
                 role: 'assistant',
                 content: '',
                 tool_calls: localToolCalls
             });

             for (const tc of localToolCalls) {
                 const name = tc.function.name;
                 let args;
                 if (typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
                     args = tc.function.arguments;
                 } else {
                     try {
                         args = JSON.parse(tc.function.arguments || '{}');
                     } catch (e) {
                         args = {};
                     }
                 }
                 const output = await executeTool(vibeManager, name, args, runtimeState);
                 let shouldRefreshPresentation = false;

                 try {
                     const parsed = JSON.parse(output);
                     if (parsed?.mutated) {
                         await persist();
                         shouldRefreshPresentation = true;
                     }
                 } catch {
                     // keep going even if tool output is non-JSON
                 }
                 
                 currentMessages.push({
                     role: 'tool',
                     tool_call_id: tc.id,
                     content: output
                 });

                 onChunk(`${shortToolCompletionMessage(name)}\n`);
                 
                 // Optionally stream back the tool result so the UI knows it finished
                 onChunk(`\n[TOOL_RESULT]${JSON.stringify({ id: tc.id, result: output })}[/TOOL_RESULT]\n`);
                 if (shouldRefreshPresentation) {
                     // Signal the frontend to refetch the presentation endpoint (which hydrates from Redis cache first).
                     onChunk('[PRESENTATION_UPDATED]');
                 }
             }
             // Loop again to give LLM the results
        } else {
               if (localText) {
                  onChunk(localText);
               }
             return localText;
        }
        }
        
        return "I've hit the maximum number of tool execution steps.";
    } finally {
        await cleanup();
    }
};
