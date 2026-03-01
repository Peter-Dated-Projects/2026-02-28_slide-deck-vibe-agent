export interface ILLMService {
    processToolCall(toolCall: any, conversationId: string): Promise<any>;
    chatWithAgent(conversationId: string, messages: any[]): Promise<any>;
}
