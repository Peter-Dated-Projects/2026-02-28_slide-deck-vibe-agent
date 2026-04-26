export interface AgentTaskItem {
    id: string;
    title: string;
    done: boolean;
}

export interface AgentRuntimeState {
    tasks: AgentTaskItem[];
}

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

export type LLMEvent =
    | { type: 'text_delta'; text: string }
    | { type: 'thinking_delta'; text: string }
    | { type: 'tool_call'; call: ToolCall };

export type StopReason = 'end' | 'tool_calls' | 'length' | 'error';

export interface LLMResult {
    stop_reason: StopReason;
    text: string;
    tool_calls: ToolCall[];
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
