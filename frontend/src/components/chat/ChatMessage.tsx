import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Brain, Copy, Check, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark-dimmed.css";
import type { AssistantBlock, ChatMessage as ChatMessageDataNew } from "../../hooks/useChatStream";

export type ChatMessageData = ChatMessageDataNew;

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(" ");
}

const TOOL_LABELS: Record<string, string> = {
    create_tasks: "Planning tasks",
    update_task_status: "Updating task",
    design: "Editing design spec",
    read_presentation: "Reading presentation",
    create_slide: "Creating slide",
    delete_slide: "Deleting slide",
    reorder_slides: "Reordering slides",
    duplicate_slide: "Duplicating slide",
    add_element: "Adding element",
    update_element: "Updating element",
    delete_element: "Deleting element",
    update_theme: "Updating theme",
};

interface ThinkingBlockViewProps {
    text: string;
    startTime: number;
    endTime?: number;
}

const ThinkingBlockView: React.FC<ThinkingBlockViewProps> = ({ text, startTime, endTime }) => {
    const [expanded, setExpanded] = useState(false);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (endTime) return;
        const id = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(id);
    }, [endTime]);
    const elapsed = Math.max(0, Math.floor(((endTime ?? now) - startTime) / 1000));
    const live = !endTime;
    const label = live ? `Agent thinking for ${elapsed}s…` : `Agent thought for ${elapsed}s`;
    return (
        <div className="mb-1 w-full">
            <button
                onClick={() => setExpanded((v) => !v)}
                className={cn(
                    "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 w-full border text-muted-foreground hover:text-foreground",
                    live ? "border-primary/30 bg-primary/5 hover:bg-primary/10" : "border-border bg-muted/30 hover:bg-muted/60"
                )}
            >
                <Brain className={cn("w-3 h-3 flex-shrink-0", live ? "text-primary animate-pulse" : "text-muted-foreground")} />
                <span className="flex-1 text-left">{label}</span>
                {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            </button>
            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <div className="min-h-0 overflow-hidden">
                    <div
                        className={cn(
                            "mt-1.5 ml-2 pl-3 border-l-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground overflow-y-auto custom-scrollbar max-h-[160px]",
                            live ? "border-primary/40" : "border-border"
                        )}
                    >
                        {text || <span className="italic opacity-60">{live ? "Thinking…" : "No thinking content."}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ToolBlockViewProps {
    call: { id: string; name: string; args: Record<string, unknown> };
    result?: string;
}

const ToolBlockView: React.FC<ToolBlockViewProps> = ({ call, result }) => {
    const [expanded, setExpanded] = useState(false);
    const friendly = TOOL_LABELS[call.name] ?? `Running ${call.name}`;
    const pending = result === undefined;
    return (
        <div className="mb-1 w-full">
            <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 w-full border border-indigo-500/40 bg-violet-500/10 hover:bg-violet-500/15 text-muted-foreground hover:text-foreground"
            >
                <div
                    className={cn(
                        "w-3 h-3 flex-shrink-0 flex items-center justify-center rounded bg-indigo-500/20 text-indigo-400",
                        pending && "animate-pulse"
                    )}
                >
                    <Wrench className="w-2 h-2" />
                </div>
                <span className="flex-1 text-left break-words [overflow-wrap:anywhere]">
                    {pending ? `${friendly} (executing)` : friendly}
                </span>
                {expanded ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
            </button>
            {expanded && (
                <div className="mt-1.5 ml-2 pl-3 border-l-2 border-indigo-500/40 text-[10px] leading-relaxed text-muted-foreground space-y-1">
                    <pre className="bg-background/50 rounded p-2 font-mono text-[9px] overflow-x-auto whitespace-pre-wrap">
{JSON.stringify(call.args, null, 2)}
                    </pre>
                    {result !== undefined && (
                        <div className="bg-background/50 rounded p-2 font-mono text-[9px] overflow-x-auto">
                            <span className="text-muted-foreground uppercase text-[8px] tracking-wider">Result</span>
                            <pre className="mt-1 text-foreground whitespace-pre-wrap">{prettyResult(result)}</pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function prettyResult(result: string): string {
    try {
        return JSON.stringify(JSON.parse(result), null, 2);
    } catch {
        return result;
    }
}

const mdComponents: any = {
    code({ className, children }: any) {
        if (!className) {
            return (
                <code className="px-1 py-0.5 rounded text-[11px] bg-muted/70 text-foreground font-mono">{children}</code>
            );
        }
        return <code className={cn("text-[11px] font-mono", className)}>{children}</code>;
    },
    pre({ children }: any) {
        return (
            <pre className="overflow-x-auto rounded-lg my-2 p-3 text-[11px] leading-relaxed bg-[#22272e]">{children}</pre>
        );
    },
    h1: ({ children }: any) => <h1 className="text-base font-bold mt-3 mb-1 text-foreground">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-[13px] font-semibold mt-2.5 mb-1 text-foreground">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-[12px] font-semibold mt-2 mb-0.5 text-foreground">{children}</h3>,
    p: ({ children }: any) => <p className="text-[12px] leading-relaxed mb-1.5 last:mb-0">{children}</p>,
    ul: ({ children }: any) => <ul className="list-disc list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ol>,
    li: ({ children }: any) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }: any) => (
        <blockquote className="border-l-2 border-primary/40 pl-3 my-2 italic text-muted-foreground text-[12px]">{children}</blockquote>
    ),
    hr: () => <hr className="border-border my-3" />,
    strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }: any) => <em className="italic">{children}</em>,
    a: ({ href, children }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
            {children}
        </a>
    ),
};

const Markdown: React.FC<{ content: string }> = ({ content }) => (
    <div className="chat-markdown break-words [overflow-wrap:anywhere]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>
            {content}
        </ReactMarkdown>
    </div>
);

interface ChatMessageProps {
    message: ChatMessageData;
}

export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
    const isUser = message.role === "user";
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const handleContextMenu = useCallback(
        (e: React.MouseEvent) => {
            if (isUser) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
        },
        [isUser]
    );
    const handleCopy = useCallback(() => {
        const text = textOfMessage(message);
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
        setMenu(null);
    }, [message]);

    useEffect(() => {
        if (!menu) return;
        const onPointerDown = (e: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMenu(null);
        };
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [menu]);

    return (
        <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
            {menu && (
                <div
                    ref={menuRef}
                    style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 9999 }}
                    className="min-w-[130px] rounded-lg border border-border bg-popover shadow-lg py-1 text-[12px]"
                >
                    <button
                        onClick={handleCopy}
                        className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted/60 transition-colors text-foreground"
                    >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
            )}
            <div
                onContextMenu={handleContextMenu}
                className={cn(
                    isUser ? "max-w-[70%]" : "w-full",
                    "rounded-[8px] px-4 py-2.5 mt-2 transition-all duration-200 break-words [overflow-wrap:anywhere]",
                    isUser
                        ? "bg-primary text-primary-foreground rounded-tr-[2px] shadow-sm"
                        : "bg-card text-foreground rounded-tl-[2px] border border-border",
                    !isUser && "cursor-context-menu"
                )}
            >
                {isUser ? (
                    <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {typeof message.content === "string" ? message.content : ""}
                    </p>
                ) : (
                    <AssistantBody message={message} />
                )}
            </div>
        </div>
    );
});

const AssistantBody: React.FC<{ message: ChatMessageData }> = ({ message }) => {
    const blocks = normalizeAssistantBlocks(message);
    const resultsById = collectResults(blocks);
    if (blocks.length === 0 && message.isStreaming) {
        return (
            <div className="space-y-3 w-full">
                <ThinkingBlockView text="" startTime={Date.now()} />
            </div>
        );
    }
    return (
        <div className="space-y-3 w-full">
            {blocks.map((block, i) => {
                if (block.type === "text") return <Markdown key={`t-${i}`} content={block.text} />;
                if (block.type === "thinking") {
                    return (
                        <ThinkingBlockView
                            key={`th-${i}`}
                            text={block.text}
                            startTime={block.startTime}
                            endTime={block.endTime}
                        />
                    );
                }
                if (block.type === "tool_call") {
                    return (
                        <ToolBlockView key={`tc-${i}-${block.call.id}`} call={block.call} result={resultsById.get(block.call.id)} />
                    );
                }
                return null; // tool_result rendered alongside its tool_call
            })}
        </div>
    );
};

function normalizeAssistantBlocks(message: ChatMessageData): AssistantBlock[] {
    const c = message.content;
    if (typeof c === "string") {
        return c ? [{ type: "text", text: c }] : [];
    }
    return Array.isArray(c) ? c : [];
}

function collectResults(blocks: AssistantBlock[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const b of blocks) {
        if (b.type === "tool_result") m.set(b.id, b.result);
    }
    return m;
}

function textOfMessage(message: ChatMessageData): string {
    if (typeof message.content === "string") return message.content;
    return message.content
        .map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? `[thought] ${b.text}` : ""))
        .filter(Boolean)
        .join("\n");
}
