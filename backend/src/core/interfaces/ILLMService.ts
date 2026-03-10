export interface ILLMService {
    chatWithAgent(conversationId: string, messages: any[]): Promise<any>;
    chatWithAgentStream?(
        conversationId: string,
        messages: any[],
        onEvent: (event: string, data: any) => void
    ): Promise<string>;
}
