import { llmService, dbService as db } from '../core/container';

/**
 * Heuristic to estimate token count.
 * For local models, character count / 4 is a common approximation.
 */
function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

/**
 * Strips trailing markdown horizontal rules (`---`) that the LLM may include.
 */
function stripTrailingSeparators(text: string): string {
    return text.replace(/\n---\s*$/g, '').trim();
}

/**
 * Parses the markdown output from the LLM to extract the Edit log and Conversation summary.
 */
function parseCompressionOutput(output: string): { editLog: string, summary: string } {
    let editLog = '';
    let summary = '';

    const editLogMatch = output.match(/## Edit log\s*([\s\S]*?)(?=## Conversation summary|$)/i);
    if (editLogMatch && editLogMatch[1]) {
        editLog = stripTrailingSeparators(editLogMatch[1]);
    }

    const summaryMatch = output.match(/## Conversation summary\s*([\s\S]*?)$/i);
    if (summaryMatch && summaryMatch[1]) {
        summary = stripTrailingSeparators(summaryMatch[1]);
    }

    return { editLog, summary };
}

/** Estimated token overhead for the system prompt + tool definitions that are always present. */
const SYSTEM_PROMPT_OVERHEAD_TOKENS = 1000;

export class ContextManager {
    private static readonly RECENCY_WINDOW = 5; // Keep last 5 raw turns

    /**
     * Returns the token budget threshold (80% of context window).
     * Context window size is configurable via CONTEXT_WINDOW_SIZE env var (defaults to 8192).
     */
    private static get TOKEN_BUDGET_THRESHOLD(): number {
        const windowSize = parseInt(process.env.CONTEXT_WINDOW_SIZE || '8192', 10);
        return Math.floor(windowSize * 0.8);
    }

    /**
     * Checks if the current conversation is over the context budget.
     */
    static checkBudget(systemPrompt: string, editLog: string, summary: string, rawMessages: any[]): boolean {
        let totalTokens = SYSTEM_PROMPT_OVERHEAD_TOKENS;
        totalTokens += estimateTokens(systemPrompt);
        totalTokens += estimateTokens(editLog);
        totalTokens += estimateTokens(summary);

        for (const msg of rawMessages) {
            totalTokens += estimateTokens(msg.content);
            if (msg.tool_calls) {
                totalTokens += estimateTokens(JSON.stringify(msg.tool_calls));
            }
            if (msg.tool_results) {
                totalTokens += estimateTokens(JSON.stringify(msg.tool_results));
            }
        }

        return totalTokens >= this.TOKEN_BUDGET_THRESHOLD;
    }

    /**
     * Combines the system prompt, edit log, summary, and recent uncompressed turns into a single array for the LLM.
     */
    static assembleContext(systemInstruction: string, editLog: string, summary: string, rawMessages: any[]): { systemInstruction: string, messages: any[] } {
        let assembledInstruction = systemInstruction;

        if (editLog || summary) {
            assembledInstruction += '\n\n--- Memory ---';
            if (editLog) {
                assembledInstruction += `\n\n## Past Edits\n${editLog}`;
            }
            if (summary) {
                assembledInstruction += `\n\n## Conversation Summary\n${summary}`;
            }
        }

        return {
            systemInstruction: assembledInstruction,
            messages: rawMessages
        };
    }

    /**
     * Runs a compression pass on old uncompressed messages.
     * Takes the oldest turns (excluding the recency window), the previous edit log, and the previous summary.
     */
    static async runCompressionPass(conversationId: string, onEvent: (event: string, data: string) => void): Promise<void> {
        console.log(`[ContextManager] Running compression pass for conversation ${conversationId}...`);
        onEvent('token_text', JSON.stringify({ token: '[COMPRESSING_MEMORY]' }));

        try {
            // Fetch conversation metadata
            const convRes = await db.query('SELECT edit_log, summary FROM conversations WHERE id = $1', [conversationId]);
            if (convRes.rows.length === 0) return;
            const previousEditLog = convRes.rows[0].edit_log || '';
            const previousSummary = convRes.rows[0].summary || '';

            // Fetch uncompressed messages
            const msgRes = await db.query(
                'SELECT id, role, content FROM messages WHERE conversation_id = $1 AND is_compressed = FALSE ORDER BY created_at ASC',
                [conversationId]
            );

            const allUncompressed = msgRes.rows;
            if (allUncompressed.length <= this.RECENCY_WINDOW) {
                console.log(`[ContextManager] Not enough messages to compress (found ${allUncompressed.length}). Skipping.`);
                // Let the finally block emit [COMPRESSION_DONE]
                return;
            }

            // Identify messages to compress (oldest ones, excluding the recency window)
            const messagesToCompress = allUncompressed.slice(0, allUncompressed.length - this.RECENCY_WINDOW);
            const messageIdsToCompress = messagesToCompress.map(m => m.id);

            // Format conversation segment for the LLM
            const segmentText = messagesToCompress.map(m => {
                const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `[${m.role.toUpperCase()}]: ${text}`;
            }).join('\n\n');

            let summarizationPrompt = `You are a context compression assistant for a presentation editing application.

You will be given a segment of conversation history between a user and an AI presentation editor. Your job is to compress this into two structured sections that preserve all editable, decision-relevant information while discarding filler.

Respond with ONLY the following two sections — no preamble, no commentary:

---

## Edit log
A concise bulleted list of every concrete edit, decision, or user preference established in this conversation segment. Each bullet must capture: what was changed, on which slide (if known), and the outcome. Include rejected or undone edits as "[reverted]". Maximum 10 bullets. Example format:
- Slide 3 title changed from "Q3 Results" to "Q3 Performance Overview"
- User prefers sans-serif fonts throughout
- Slide 5 chart type changed to bar chart [reverted — user switched back to line]
- New slide inserted after slide 4: "Market Risks"

## Conversation summary
2-4 bullet points capturing the overall arc of this conversation segment: what the user is trying to accomplish, any constraints or preferences they've expressed, and where things stand at the end of this segment. Write as if briefing a new assistant picking up mid-session.

---

Rules:
`;

            if (previousEditLog || previousSummary) {
                summarizationPrompt += `- You are also given a previous edit log and summary. Merge them with any new edits/events from this segment. Deduplicate, and if an entry contradicts a prior one, keep only the most recent.\n`;
            }

            summarizationPrompt += `- Never invent edits that were not explicitly made
- Preserve exact slide numbers, titles, and field names where mentioned
- If the user expressed uncertainty or gave contradictory instructions, note it
- Do not include greetings, confirmations, or small talk

---
`;

            if (previousEditLog) {
                summarizationPrompt += `\nPREVIOUS EDIT LOG:\n${previousEditLog}\n`;
            }
            if (previousSummary) {
                summarizationPrompt += `\nPREVIOUS SUMMARY:\n${previousSummary}\n`;
            }

            summarizationPrompt += `\nCONVERSATION SEGMENT TO COMPRESS:\n${segmentText}`;

            // Use a synthetic conversationId to isolate the compression call
            // from any conversation-scoped caching or state tracking.
            const compressionConvId = `${conversationId}_compression`;
            const result = await llmService.chatWithAgent(compressionConvId, [{ role: 'user', content: summarizationPrompt }]);
            
            let assistantResponse = '';
            if (result.content && result.content.length > 0) {
                 assistantResponse = result.content.map((b: any) => b.text || b.content || "").join("\n");
            }

            const { editLog, summary } = parseCompressionOutput(assistantResponse);

            if (editLog || summary) {
                // Update conversation with new compressed memory
                await db.query(
                    'UPDATE conversations SET edit_log = $1, summary = $2, updated_at = NOW() WHERE id = $3',
                    [editLog, summary, conversationId]
                );

                // Mark messages as compressed
                if (messageIdsToCompress.length > 0) {
                    await db.query(
                        'UPDATE messages SET is_compressed = TRUE WHERE id = ANY($1::uuid[])',
                        [messageIdsToCompress]
                    );
                }
                console.log(`[ContextManager] Compressed ${messageIdsToCompress.length} messages.`);
            } else {
                 console.warn(`[ContextManager] Failed to extract editLog or summary from LLM response: ${assistantResponse}`);
            }

        } catch (e) {
            console.error('[ContextManager] Error during compression pass:', e);
        } finally {
            onEvent('token_text', JSON.stringify({ token: '[COMPRESSION_DONE]' }));
        }
    }
}
