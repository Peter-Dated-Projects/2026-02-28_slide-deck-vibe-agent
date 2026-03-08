import { llmService } from '../core/container';

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    return await llmService.chatWithAgent(conversationId, messages);
};

export const chatWithAgentStream = async (
    conversationId: string,
    messages: any[],
    onChunk: (token: string) => void
): Promise<string> => {
    if (!llmService.chatWithAgentStream) {
        // Fallback: non-streaming, emit full text as one chunk
        const result = await llmService.chatWithAgent(conversationId, messages);
        const text = result.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
        onChunk(text);
        return text;
    }
    return await llmService.chatWithAgentStream(conversationId, messages, onChunk);
};
