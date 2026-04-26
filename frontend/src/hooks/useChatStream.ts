import { useCallback, useRef, useState } from "react";
import { getAccessToken } from "../api";

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

export type AssistantBlock =
    | { type: "text"; text: string }
    | { type: "thinking"; text: string; startTime: number; endTime?: number }
    | { type: "tool_call"; call: ToolCall }
    | { type: "tool_result"; id: string; result: string };

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string | AssistantBlock[];
    isStreaming?: boolean;
}

export interface ConversationMeta {
    conversationId: string;
    projectId: string | null;
    title: string;
    projectName: string;
}

export interface SendOptions {
    conversationId?: string;
    projectId?: string | null;
}

export interface UseChatStreamArgs {
    apiUrl: string;
    initialMessages?: ChatMessage[];
    onConversation?: (meta: ConversationMeta) => void;
    onPresentationUpdated?: () => void;
    onError?: (message: string) => void;
}

export function useChatStream(args: UseChatStreamArgs) {
    const { apiUrl, initialMessages = [], onConversation, onPresentationUpdated, onError } = args;
    const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isCompressing, setIsCompressing] = useState(false);
    const cancelRef = useRef<AbortController | null>(null);

    const reset = useCallback((next: ChatMessage[]) => {
        setMessages(next);
    }, []);

    const send = useCallback(
        async (text: string, opts: SendOptions): Promise<{ conversationId: string | null }> => {
            const userText = text.trim();
            if (!userText) return { conversationId: opts.conversationId ?? null };

            const userMsg: ChatMessage = {
                id: `u-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                role: "user",
                content: userText,
            };
            const assistantId = `a-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const assistantMsg: ChatMessage = {
                id: assistantId,
                role: "assistant",
                content: [],
                isStreaming: true,
            };
            setMessages((prev) => [...prev, userMsg, assistantMsg]);

            const updateAssistant = (mut: (blocks: AssistantBlock[]) => AssistantBlock[]) => {
                setMessages((prev) =>
                    prev.map((m) => {
                        if (m.id !== assistantId) return m;
                        const blocks = Array.isArray(m.content) ? (m.content as AssistantBlock[]) : [];
                        return { ...m, content: mut(blocks) };
                    })
                );
            };

            const appendTextDelta = (deltaText: string) => {
                updateAssistant((blocks) => {
                    const last = blocks[blocks.length - 1];
                    if (last && last.type === "text") {
                        return [...blocks.slice(0, -1), { ...last, text: last.text + deltaText }];
                    }
                    return [...blocks, { type: "text", text: deltaText }];
                });
            };

            const appendThinkingDelta = (deltaText: string) => {
                updateAssistant((blocks) => {
                    const last = blocks[blocks.length - 1];
                    if (last && last.type === "thinking" && !last.endTime) {
                        return [...blocks.slice(0, -1), { ...last, text: last.text + deltaText }];
                    }
                    return [...blocks, { type: "thinking", text: deltaText, startTime: Date.now() }];
                });
            };

            const closeOpenThinking = () => {
                updateAssistant((blocks) => {
                    const last = blocks[blocks.length - 1];
                    if (last && last.type === "thinking" && !last.endTime) {
                        return [...blocks.slice(0, -1), { ...last, endTime: Date.now() }];
                    }
                    return blocks;
                });
            };

            const appendToolCall = (call: ToolCall) => {
                closeOpenThinking();
                updateAssistant((blocks) => [...blocks, { type: "tool_call", call }]);
            };

            const appendToolResult = (id: string, result: string) => {
                updateAssistant((blocks) => [...blocks, { type: "tool_result", id, result }]);
            };

            const finalize = () => {
                closeOpenThinking();
                setMessages((prev) =>
                    prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
                );
            };

            const controller = new AbortController();
            cancelRef.current = controller;
            setIsStreaming(true);
            setIsCompressing(false);
            let resolvedConvId: string | null = opts.conversationId ?? null;

            try {
                const payload: Record<string, string> = { message: userText };
                if (opts.conversationId) payload.conversationId = opts.conversationId;
                if (opts.projectId) payload.projectId = opts.projectId;

                const token = getAccessToken();
                const response = await fetch(`${apiUrl}/chat/stream`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    credentials: "include",
                    signal: controller.signal,
                    body: JSON.stringify(payload),
                });
                if (!response.ok || !response.body) {
                    throw new Error(`Stream request failed: ${response.status}`);
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() ?? "";
                    for (const frame of frames) {
                        const eventMatch = frame.match(/^event: (\S+)/m);
                        const dataMatch = frame.match(/^data: (.+)$/m);
                        if (!dataMatch) continue;
                        const eventName = eventMatch?.[1] ?? "message";
                        let data: any;
                        try {
                            data = JSON.parse(dataMatch[1]!);
                        } catch {
                            continue;
                        }
                        switch (eventName) {
                            case "conversation":
                                resolvedConvId = data.conversationId ?? resolvedConvId;
                                onConversation?.(data);
                                break;
                            case "text_delta":
                                if (typeof data.text === "string") appendTextDelta(data.text);
                                break;
                            case "thinking_delta":
                                if (typeof data.text === "string") appendThinkingDelta(data.text);
                                break;
                            case "tool_call":
                                appendToolCall({
                                    id: String(data.id ?? ""),
                                    name: String(data.name ?? ""),
                                    args: (data.args ?? {}) as Record<string, unknown>,
                                });
                                break;
                            case "tool_result":
                                appendToolResult(String(data.id ?? ""), String(data.result ?? ""));
                                break;
                            case "presentation_updated":
                                onPresentationUpdated?.();
                                break;
                            case "compression_started":
                                setIsCompressing(true);
                                break;
                            case "compression_done":
                                setIsCompressing(false);
                                break;
                            case "error":
                                onError?.(data.message ?? "Stream error");
                                break;
                            case "done":
                                resolvedConvId = data.conversationId ?? resolvedConvId;
                                break;
                        }
                    }
                }
            } catch (err: any) {
                if (err?.name !== "AbortError") {
                    console.error("[useChatStream] error", err);
                    onError?.(err?.message ?? "Stream error");
                }
            } finally {
                finalize();
                cancelRef.current = null;
                setIsStreaming(false);
                setIsCompressing(false);
            }
            return { conversationId: resolvedConvId };
        },
        [apiUrl, onConversation, onPresentationUpdated, onError]
    );

    const cancel = useCallback(() => {
        cancelRef.current?.abort();
    }, []);

    return { messages, send, cancel, reset, isStreaming, isCompressing };
}
