import type { ChatMessage, MessageBlock, ToolCall } from './agentTypes';

export interface StoredMessageRow {
    role: 'user' | 'assistant' | 'system' | 'tool';
    blocks: unknown;
    content: unknown;
    tool_calls: unknown;
    tool_results: unknown;
}

/**
 * Convert a stored message row into a clean ordered MessageBlock[].
 *
 * Prefers the `blocks` column (new format). Falls back to reconstructing from
 * the legacy `content` / `tool_calls` / `tool_results` triplet — ordering on
 * legacy rows is best-effort (text → tool_calls → tool_results) since the
 * original interleaving was not preserved.
 */
export function rowToBlocks(row: StoredMessageRow): MessageBlock[] {
    const fromColumn = parseBlocks(row.blocks);
    if (fromColumn.length > 0) return fromColumn;

    if (row.role === 'user') {
        const text = extractText(row.content);
        return text ? [{ type: 'text', text }] : [];
    }

    const out: MessageBlock[] = [];
    const text = extractText(row.content);
    if (text) out.push({ type: 'text', text });
    const toolCalls = parseLegacyToolCalls(row.tool_calls);
    for (const tc of toolCalls) {
        out.push({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.args });
    }
    const toolResults = parseLegacyToolResults(row.tool_results);
    for (const r of toolResults) {
        out.push({ type: 'tool_result', id: r.id, result: r.result });
    }
    return out;
}

/**
 * Convert a sequence of stored message rows into the LLM-shaped ChatMessage[].
 *
 * - `thinking` blocks are dropped here (the user sees them, the model never does).
 * - `text` blocks within an assistant turn are concatenated into `content`.
 * - `tool_call` blocks become the assistant message's `tool_calls`.
 * - `tool_result` blocks are emitted as synthetic `{ role: 'tool', ... }` messages
 *   that follow the assistant message, paired by id.
 */
export function rowsToHistory(rows: StoredMessageRow[]): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (const row of rows) {
        const blocks = rowToBlocks(row);
        if (row.role === 'user') {
            const text = blocks
                .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
            out.push({ role: 'user', content: text });
            continue;
        }
        if (row.role !== 'assistant') continue;

        const textParts: string[] = [];
        const toolCalls: ToolCall[] = [];
        const toolResultBlocks: { id: string; result: string }[] = [];
        for (const b of blocks) {
            if (b.type === 'text') textParts.push(b.text);
            else if (b.type === 'tool_call') toolCalls.push({ id: b.id, name: b.name, args: b.args });
            else if (b.type === 'tool_result') toolResultBlocks.push({ id: b.id, result: b.result });
            // thinking is intentionally dropped
        }
        out.push({
            role: 'assistant',
            content: textParts.join(''),
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        for (const tc of toolCalls) {
            const match = toolResultBlocks.find((r) => r.id === tc.id);
            out.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: match?.result ?? '',
            });
        }
    }
    return out;
}

function parseBlocks(raw: unknown): MessageBlock[] {
    if (!Array.isArray(raw)) return [];
    const out: MessageBlock[] = [];
    for (const b of raw) {
        if (!b || typeof b !== 'object') continue;
        const type = (b as any).type;
        if (type === 'text' && typeof (b as any).text === 'string') {
            out.push({ type: 'text', text: (b as any).text });
        } else if (type === 'thinking' && typeof (b as any).text === 'string') {
            out.push({ type: 'thinking', text: (b as any).text });
        } else if (type === 'tool_call' && typeof (b as any).name === 'string') {
            const args = (b as any).args;
            out.push({
                type: 'tool_call',
                id: String((b as any).id ?? ''),
                name: (b as any).name,
                args: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
            });
        } else if (type === 'tool_result') {
            out.push({
                type: 'tool_result',
                id: String((b as any).id ?? ''),
                result: typeof (b as any).result === 'string'
                    ? (b as any).result
                    : JSON.stringify((b as any).result ?? ''),
            });
        }
    }
    return out;
}

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!content || typeof content !== 'object') return '';
    if (Array.isArray(content)) {
        return content
            .map((b: any) => (typeof b?.text === 'string' ? b.text : ''))
            .filter(Boolean)
            .join('\n');
    }
    if (typeof (content as any).text === 'string') return (content as any).text;
    return '';
}

function parseLegacyToolCalls(raw: unknown): ToolCall[] {
    if (!Array.isArray(raw)) return [];
    const out: ToolCall[] = [];
    for (const tc of raw) {
        const name = (tc as any)?.function?.name ?? (tc as any)?.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const id = typeof (tc as any)?.id === 'string' && (tc as any).id ? (tc as any).id : `tool_call_${out.length}`;
        const rawArgs = (tc as any)?.function?.arguments ?? (tc as any)?.args ?? {};
        let args: Record<string, unknown> = {};
        if (typeof rawArgs === 'string') {
            try {
                const parsed = JSON.parse(rawArgs);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    args = parsed as Record<string, unknown>;
                }
            } catch {
                /* ignore */
            }
        } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
            args = rawArgs as Record<string, unknown>;
        }
        out.push({ id, name: name.trim(), args });
    }
    return out;
}

function parseLegacyToolResults(raw: unknown): { id: string; result: string }[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((r: any) => ({
            id: typeof r?.id === 'string' ? r.id : '',
            result: typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? ''),
        }))
        .filter((r) => r.id);
}
