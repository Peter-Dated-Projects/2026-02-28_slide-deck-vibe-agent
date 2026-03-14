export interface ILLMService {
    chatWithAgent(
        conversationId: string, 
        messages: any[],
        tools?: any[],
        systemInstruction?: string
    ): Promise<any>;
    
    chatWithAgentStream?(
        conversationId: string,
        messages: any[],
        onChunk: (token: string) => void,
        tools?: any[],
        systemInstruction?: string
    ): Promise<string>;
}
