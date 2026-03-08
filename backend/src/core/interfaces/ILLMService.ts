export interface ILLMService {
    chatWithAgent(conversationId: string, messages: any[]): Promise<any>;
    chatWithAgentStream?(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void
    ): Promise<string>;
}
