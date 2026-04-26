import type { ChatMessage, LLMEvent, LLMResult, ToolSpec } from '../agentTypes';

export interface ILLMService {
    stream(
        systemInstruction: string,
        messages: ChatMessage[],
        tools: ToolSpec[],
        onEvent: (event: LLMEvent) => void
    ): Promise<LLMResult>;
}
