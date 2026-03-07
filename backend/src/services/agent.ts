import { llmService } from '../core/container';

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    return await llmService.chatWithAgent(conversationId, messages);
};
