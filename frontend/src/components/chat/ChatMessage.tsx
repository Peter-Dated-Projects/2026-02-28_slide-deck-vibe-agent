/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary
 * information of Freedom, LLC ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in accordance
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, Brain, Copy, Check, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { parseGemmaContentBlocks } from "../../lib/gemmaOutputParser";
// Import a highlight.js theme (GitHub Dark — works well on both light and dark UI)
import "highlight.js/styles/github-dark-dimmed.css";
// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────
export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string | any[];
  /** If true, the assistant is still in a thinking state (timer runs live) */
  isThinking?: boolean;
  /** Textual content shown when the thinking block is expanded */
  thinkingContent?: string;
  /** Epoch ms when thinking started. Used to compute elapsed time. */
  thinkingStartedAt?: number;
  /** Final elapsed seconds, set once thinking is done */
  thinkingTime?: number;
  /** Timers for individual think blocks */
  thinkTimers?: { startTime: number; endTime?: number }[];
  /** Array of tool calls made by the agent */
  toolCalls?: any[];
  /** Array of tool results corresponding to tool calls */
  toolResults?: any[];
}
// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}
// ─────────────────────────────────────────────────────
// ThinkingBlock sub-component
// ─────────────────────────────────────────────────────
interface ThinkingBlockProps {
  isThinking: boolean;
  thinkingContent?: string;
  thinkingStartedAt?: number;
  thinkingTime?: number; // legacy Support
  startTime?: number;
  endTime?: number;
}
const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  isThinking,
  thinkingContent,
  thinkingStartedAt,
  thinkingTime,
  startTime,
  endTime,
}) => {
  const [expanded, setExpanded] = useState(false);
  const calculateElapsed = useCallback(() => {
    // New behavior:
    if (startTime) {
      if (endTime) return Math.floor((endTime - startTime) / 1000);
      if (isThinking) return Math.floor((Date.now() - startTime) / 1000);
      return Math.floor((Date.now() - startTime) / 1000); // Fallback if isThinking is false but no endTime
    }
    // Legacy behavior:
    if (thinkingTime !== undefined) return thinkingTime;
    if (thinkingStartedAt) {
      if (isThinking) return Math.floor((Date.now() - thinkingStartedAt) / 1000);
      return 0; // Just in case
    }
    return 0;
  }, [startTime, endTime, isThinking, thinkingTime, thinkingStartedAt]);
  const [elapsed, setElapsed] = useState(calculateElapsed());
  useEffect(() => {
    if (isThinking && (startTime || thinkingStartedAt) && !endTime && thinkingTime === undefined) {
      const id = setInterval(() => {
        setElapsed(calculateElapsed());
      }, 500);
      return () => clearInterval(id);
    } else {
      setElapsed(calculateElapsed());
    }
  }, [isThinking, startTime, endTime, thinkingStartedAt, thinkingTime, calculateElapsed]);
  const label = isThinking
    ? `Agent thinking for ${elapsed}s…`
    : elapsed > 0
      ? `Agent thought for ${elapsed}s`
      : `Agent thought`;
  return (
    <div className="mb-1 w-full">
      {/* Toggle row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 group w-full",
          "border text-muted-foreground hover:text-foreground",
          isThinking
            ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
            : "border-border bg-muted/30 hover:bg-muted/60",
        )}
      >
        {/* Pulsing brain icon while active */}
        <Brain
          className={cn(
            "w-3 h-3 flex-shrink-0",
            isThinking ? "text-primary animate-pulse" : "text-muted-foreground",
          )}
        />
        <span className="flex-1 text-left">{label}</span>
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>
      {/* Expanded thinking content */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className={cn("min-h-0 overflow-hidden")}>
          <div
            className={cn(
              "mt-1.5 ml-2 pl-3 border-l-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground",
              "transition-all duration-200 overflow-y-auto custom-scrollbar max-h-[160px]", // ~10 lines of text
              isThinking ? "border-primary/40" : "border-border",
            )}
          >
            {thinkingContent ? (
              <span>{thinkingContent}</span>
            ) : (
              <span className="italic opacity-60">
                {isThinking ? "Thinking…" : "No thinking content available."}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
// ─────────────────────────────────────────────────────
// ExecuteToolBlock sub-component (Gemma 4 Generative UI)
// ─────────────────────────────────────────────────────
interface ExecuteToolBlockProps {
  toolName?: string;
  toolArgs?: Record<string, string>;
  content: string;
  parsed?: boolean;
  isOpen?: boolean;
}
const ExecuteToolBlock: React.FC<ExecuteToolBlockProps> = ({
  toolName,
  toolArgs,
  content,
  parsed,
  isOpen,
}) => {
  const [expanded, setExpanded] = useState(false);
  // Human-friendly label
  const labelMap: Record<string, string> = {
    write_design: "Writing design spec",
    read_design: "Reading design spec",
    write_slide: "Updating slide",
    read_slide: "Reading slide",
    write_theme: "Updating theme",
    read_theme: "Reading theme",
    write_css: "Updating CSS",
    read_css: "Reading CSS",
  };
  const resolvedToolName = toolName || "unknown";
  const friendlyLabel = labelMap[resolvedToolName] || `Running ${resolvedToolName}`;
  const showExecuting = Boolean(isOpen);
  return (
    <div className="mb-1 w-full">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 group w-full",
          "border border-indigo-500/40 bg-violet-500/10 hover:bg-violet-500/15 text-muted-foreground hover:text-foreground",
        )}
      >
        <div
          className={cn(
            "w-3 h-3 flex-shrink-0 flex items-center justify-center rounded bg-indigo-500/20 text-indigo-400",
            showExecuting && "animate-pulse",
          )}
        >
          <Wrench className="w-2 h-2" />
        </div>
        <span className="flex-1 text-left break-words [overflow-wrap:anywhere]">
          {showExecuting ? `${friendlyLabel} (executing)` : friendlyLabel}
        </span>
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-2 pl-3 border-l-2 border-indigo-500/40 text-[10px] leading-relaxed text-muted-foreground space-y-1">
          {parsed !== false && toolArgs && Object.keys(toolArgs).length > 0 ? (
            Object.entries(toolArgs).map(([key, value]) => (
              <div
                key={key}
                className="bg-background/50 rounded p-2 font-mono text-[9px] overflow-x-auto"
              >
                <span className="text-indigo-400 font-semibold">{key}:</span>{" "}
                <span className="text-foreground break-words [overflow-wrap:anywhere]">
                  {typeof value === "string" && value.length > 200
                    ? value.slice(0, 200) + "…"
                    : String(value)}
                </span>
              </div>
            ))
          ) : (
            <pre className="bg-background/50 rounded p-2 font-mono text-[10px] text-foreground overflow-x-auto whitespace-pre-wrap">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
// ─────────────────────────────────────────────────────
// ToolBlock sub-component
// ─────────────────────────────────────────────────────
interface ToolBlockProps {
  toolCalls: any[];
  toolResults?: any[];
}
const ToolBlock: React.FC<ToolBlockProps> = ({ toolCalls, toolResults }) => {
  const [expanded, setExpanded] = useState(false);
  const formatValue = (value: unknown) => {
    if (value === undefined || value === null) return "(none)";
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return value;
      }
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };
  if (!toolCalls || toolCalls.length === 0) return null;
  const firstToolName = toolCalls[0]?.function?.name || "tool";
  const allSameTool = toolCalls.every(
    (toolCall) => (toolCall?.function?.name || "tool") === firstToolName,
  );
  const title =
    toolCalls.length === 1
      ? `Agent ran: ${firstToolName}`
      : allSameTool
        ? `Agent ran: "${firstToolName}" ${toolCalls.length} times`
        : `Agent ran: ${toolCalls.length} tools`;
  return (
    <div className="mb-1 w-full">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 group w-full",
          "border border-blue-400/30 bg-blue-400/5 hover:bg-blue-400/10 text-muted-foreground hover:text-foreground",
        )}
      >
        <div className="w-3 h-3 flex-shrink-0 flex items-center justify-center rounded bg-blue-400/20 text-blue-400">
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
        </div>
        <span className="flex-1 text-left break-words [overflow-wrap:anywhere]">{title}</span>
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-2 pl-3 border-l-2 border-blue-400/40 text-[10px] leading-relaxed text-muted-foreground transition-all duration-200 space-y-2">
          {toolCalls.map((tc, idx) => {
            const res = toolResults?.find((r) => r.id === tc.id);
            const result = formatValue(res?.result);
            return (
              <div
                key={idx}
                className="bg-background/50 rounded p-2 font-mono text-[9px] overflow-x-auto"
              >
                <div>
                  <span className="text-blue-400 font-semibold">{tc.function.name}</span>
                </div>
                {res && (
                  <div className="mt-1 flex flex-col pt-1 border-t border-border">
                    <span className="text-muted-foreground mb-1 uppercase text-[8px] tracking-wider">
                      Result
                    </span>
                    <pre className="text-[10px] text-foreground font-mono">{result}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
// ─────────────────────────────────────────────────────
// MarkdownContent — renders assistant markdown safely
// Compatible with react-markdown v9
// ─────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const mdComponents = {
  // Code: inline (no className) vs fenced block (has language-* className)
  code({ className, children }: any) {
    if (!className) {
      return (
        <code className="px-1 py-0.5 rounded text-[11px] bg-muted/70 text-foreground font-mono">
          {children}
        </code>
      );
    }
    return <code className={cn("text-[11px] font-mono", className)}>{children}</code>;
  },
  // pre: omit `node` so it doesn't leak into the DOM
  pre({ node: _n, children }: any) {
    return (
      <pre className="overflow-x-auto rounded-lg my-2 p-3 text-[11px] leading-relaxed bg-[#22272e]">
        {children}
      </pre>
    );
  },
  h1: ({ node: _n, children }: any) => (
    <h1 className="text-base font-bold mt-3 mb-1 text-foreground">{children}</h1>
  ),
  h2: ({ node: _n, children }: any) => (
    <h2 className="text-[13px] font-semibold mt-2.5 mb-1 text-foreground">{children}</h2>
  ),
  h3: ({ node: _n, children }: any) => (
    <h3 className="text-[12px] font-semibold mt-2 mb-0.5 text-foreground">{children}</h3>
  ),
  h4: ({ node: _n, children }: any) => (
    <h4 className="text-[11px] font-semibold mt-1.5 mb-0.5 text-foreground">{children}</h4>
  ),
  p: ({ node: _n, children }: any) => (
    <p className="text-[12px] leading-relaxed mb-1.5 last:mb-0">{children}</p>
  ),
  ul: ({ node: _n, children }: any) => (
    <ul className="list-disc list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ul>
  ),
  ol: ({ node: _n, children }: any) => (
    <ol className="list-decimal list-outside pl-4 my-1.5 space-y-0.5 text-[12px]">{children}</ol>
  ),
  li: ({ node: _n, children }: any) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ node: _n, children }: any) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 italic text-muted-foreground text-[12px]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  strong: ({ node: _n, children }: any) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ node: _n, children }: any) => <em className="italic">{children}</em>,
  a: ({ node: _n, href, children }: any) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  table: ({ node: _n, children }: any) => (
    <div className="overflow-x-auto my-2 w-full">
      <table className="text-[11px] border-collapse w-full">{children}</table>
    </div>
  ),
  thead: ({ node: _n, children }: any) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ node: _n, children }: any) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ node: _n, children }: any) => (
    <td className="border border-border px-2 py-1 text-muted-foreground">{children}</td>
  ),
};
/* eslint-enable @typescript-eslint/no-explicit-any */
const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <div className="chat-markdown break-words [overflow-wrap:anywhere]">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={mdComponents}
    >
      {content}
    </ReactMarkdown>
  </div>
);
// ─────────────────────────────────────────────────────
// ChatMessage component
// ─────────────────────────────────────────────────────
interface ChatMessageProps {
  message: ChatMessageData;
}
export const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === "user";
  const hasThinking = message.thinkingStartedAt !== undefined || message.thinkingTime !== undefined;
  // Context menu state (assistant only)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (isUser) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [isUser],
  );
  const handleCopy = useCallback(() => {
    const textToCopy =
      typeof message.content === "string"
        ? message.content
        : message.content.map((b) => b.text || b.content || JSON.stringify(b)).join("\n");
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
    setMenu(null);
  }, [message.content]);
  // Dismiss on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
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
      {/* Context menu portal */}
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
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
            )}
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
          !isUser && "cursor-context-menu",
        )}
      >
        {/* Legacy Tool block — only for older assistant messages where content is a string */}
        {!isUser &&
          typeof message.content === "string" &&
          message.toolCalls &&
          message.toolCalls.length > 0 && (
            <ToolBlock toolCalls={message.toolCalls} toolResults={message.toolResults} />
          )}
        {/* Message content */}
        {message.content && (
          <>
            {isUser ? (
              // User messages: preserve line breaks, no markdown
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {message.content}
              </p>
            ) : (
              // Assistant messages: parse and handle think blocks + markdown
              <div className="space-y-3 w-full">
                {(() => {
                  let blocks: any[] = [];
                  if (typeof message.content === "string") {
                    blocks = parseGemmaContentBlocks(message.content);
                  } else if (Array.isArray(message.content)) {
                    blocks = message.content;
                  }
                  // Empty stream edge case support
                  if (blocks.length === 0) {
                    const elements = [];
                    elements.push(
                      <ThinkingBlock
                        key="initial"
                        isThinking={message.isThinking !== false}
                        startTime={message.thinkTimers?.[0]?.startTime || message.thinkingStartedAt}
                        endTime={
                          message.isThinking === false
                            ? message.thinkTimers?.[0]?.startTime || message.thinkingStartedAt
                            : undefined
                        }
                      />,
                    );
                    return elements;
                  }
                  let thinkIdx = 0;
                  const renderedElements: React.ReactNode[] = [];
                  for (let i = 0; i < blocks.length; i++) {
                    const block = blocks[i];
                    if (block.type === "think") {
                      // If the block itself has timers from the new DB schema, use them directly
                      let timerStartTime =
                        block.startTime || message.thinkTimers?.[thinkIdx]?.startTime;
                      let timerEndTime = block.endTime || message.thinkTimers?.[thinkIdx]?.endTime;
                      if (i === 0 && message.thinkingStartedAt) {
                        timerStartTime = message.thinkingStartedAt;
                      }
                      const isLastThinkBlock = i === blocks.length - 1;
                      const currentlyThinking =
                        isLastThinkBlock && message.isThinking && !timerEndTime;
                      renderedElements.push(
                        <ThinkingBlock
                          key={`think-${i}`}
                          isThinking={!!currentlyThinking}
                          thinkingContent={block.content || block.text} // Support 'text' key from new schema
                          startTime={timerStartTime}
                          endTime={timerEndTime}
                          thinkingStartedAt={message.thinkingStartedAt}
                          thinkingTime={currentlyThinking ? undefined : message.thinkingTime}
                        />,
                      );
                      thinkIdx++;
                    } else if (block.type === "tool_call" || block.type === "tool_result") {
                      // Coalesce adjacent tool_calls/tool_results, but only merge
                      // consecutive tool calls that use the same tool name.
                      const segmentToolCalls: any[] = [];
                      const segmentToolResults: any[] = [];
                      let j = i;
                      while (
                        j < blocks.length &&
                        (blocks[j].type === "tool_call" || blocks[j].type === "tool_result")
                      ) {
                        if (blocks[j].type === "tool_call") {
                          segmentToolCalls.push(blocks[j].tool_call);
                        } else {
                          segmentToolResults.push({ id: blocks[j].id, result: blocks[j].result });
                        }
                        j++;
                      }
                      const groupedBySequentialTool: { toolCalls: any[]; toolResults: any[] }[] =
                        [];
                      let currentGroupName: string | null = null;
                      for (const toolCall of segmentToolCalls) {
                        const toolName = toolCall?.function?.name ?? "tool";
                        if (currentGroupName === toolName && groupedBySequentialTool.length > 0) {
                          groupedBySequentialTool[
                            groupedBySequentialTool.length - 1
                          ].toolCalls.push(toolCall);
                        } else {
                          groupedBySequentialTool.push({ toolCalls: [toolCall], toolResults: [] });
                          currentGroupName = toolName;
                        }
                      }
                      if (groupedBySequentialTool.length > 0) {
                        for (
                          let groupIdx = 0;
                          groupIdx < groupedBySequentialTool.length;
                          groupIdx++
                        ) {
                          const group = groupedBySequentialTool[groupIdx];
                          const groupCallIds = new Set(
                            group.toolCalls.map((toolCall) => toolCall?.id).filter(Boolean),
                          );
                          group.toolResults = segmentToolResults.filter((toolResult) =>
                            groupCallIds.has(toolResult.id),
                          );
                          renderedElements.push(
                            <ToolBlock
                              key={`toolgroup-${i}-${groupIdx}`}
                              toolCalls={group.toolCalls}
                              toolResults={
                                group.toolResults.length > 0 ? group.toolResults : undefined
                              }
                            />,
                          );
                        }
                      }
                      // Skip the loop forward by the coalesced amount
                      i = j - 1;
                    } else if (block.type === "execute_tool") {
                      renderedElements.push(
                        <ExecuteToolBlock
                          key={`exec-${i}`}
                          toolName={block.toolName}
                          toolArgs={block.toolArgs}
                          content={block.content || ""}
                          parsed={block.parsed}
                          isOpen={block.isOpen}
                        />,
                      );
                    } else {
                      renderedElements.push(
                        <MarkdownContent
                          key={`text-${i}`}
                          content={block.content || block.text || ""}
                        />,
                      );
                    }
                  }
                  return renderedElements;
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
