export interface ILLMService {
    chatWithAgent(conversationId: string, messages: any[]): Promise<any>;
}
