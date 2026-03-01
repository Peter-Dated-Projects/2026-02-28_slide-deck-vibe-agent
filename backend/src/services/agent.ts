import { llmService } from '../core/container';

// Tools schema is now encapsulated inside the providers, but if consumers need them:
// export const tools = (llmService as any).tools;

export const processToolCall = async (toolCall: any, conversationId: string) => {
    return await llmService.processToolCall(toolCall, conversationId);
};

export const chatWithAgent = async (conversationId: string, messages: any[]) => {
    return await llmService.chatWithAgent(conversationId, messages);
};
