/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary 
 * information of Freedom, LLC ("Confidential Information"). You shall not 
 * disclose such Confidential Information and shall use it only in accordance 
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const THINK_TAG_PATTERN = /<\/?think>/gi;

export const stripThinkingFromText = (value: string): string => {
    if (!value) {
        return '';
    }
    return value
        .replace(THINK_BLOCK_PATTERN, '')
        .replace(THINK_TAG_PATTERN, '')
        .trim();
};

export const normalizeMessageContentForModel = (content: unknown): string => {
    if (typeof content === 'string') {
        return stripThinkingFromText(content);
    }

    if (Array.isArray(content)) {
        return content
            .map((block: any) => {
                if (!block || typeof block !== 'object') {
                    return '';
                }
                if (block.type === 'think') {
                    return '';
                }
                if (block.type === 'tool_call' || block.type === 'tool_result') {
                    return '';
                }

                const value = typeof block.text === 'string'
                    ? block.text
                    : typeof block.content === 'string'
                        ? block.content
                        : '';
                return stripThinkingFromText(value);
            })
            .filter((part: string) => part.length > 0)
            .join('\n');
    }

    if (content && typeof content === 'object') {
        const maybeText = (content as { text?: unknown; content?: unknown }).text
            ?? (content as { content?: unknown }).content;
        if (typeof maybeText === 'string') {
            return stripThinkingFromText(maybeText);
        }
    }

    return '';
};

export const sanitizeMessagesForModel = (messages: any[]): any[] => {
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages.map((message: any) => {
        const sanitized: any = {
            role: message?.role,
            content: normalizeMessageContentForModel(message?.content),
        };

        if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
            sanitized.tool_calls = message.tool_calls;
        }

        if (typeof message?.tool_call_id === 'string' && message.tool_call_id.trim()) {
            sanitized.tool_call_id = message.tool_call_id;
        }

        return sanitized;
    });
};