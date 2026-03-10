import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
// Import a highlight.js theme (GitHub Dark — works well on both light and dark UI)
import "highlight.js/styles/github-dark-dimmed.css";

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

export interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** If true, the assistant is still in a thinking state (timer runs live) */
  isThinking?: boolean;
  /** Textual content shown when the thinking block is expanded */
  thinkingContent?: string;
  /** Epoch ms when thinking started. Used to compute elapsed time. */
  thinkingStartedAt?: number;
  /** Final elapsed seconds, set once thinking is done */
  /** Final elapsed seconds, set once thinking is done */
  thinkingTime?: number;
  /** List of tool calls made during this message */
  toolCalls?: {
    id: string;
    name: string;
    args?: any;
    status: 'pending' | 'success' | 'error';
  }[];
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
  thinkingContent?: React.ReactNode;
  thinkingStartedAt?: number;
  thinkingTime?: number;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  isThinking,
  thinkingContent,
  thinkingStartedAt,
  thinkingTime,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(thinkingTime ?? 0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live timer while still thinking
  useEffect(() => {
    if (isThinking && thinkingStartedAt) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - thinkingStartedAt) / 1000));
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Snap to the final recorded time if available
      if (thinkingTime !== undefined) setElapsed(thinkingTime);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isThinking, thinkingStartedAt, thinkingTime]);

  let label = "Agent thought";
  if (isThinking) {
      label = `Agent thinking${elapsed > 0 ? ` for ${elapsed}s…` : '…'}`;
  } else if (elapsed > 0) {
      label = `Agent thought for ${elapsed}s`;
  }

  return (
    <div className="mb-3 mt-2">
      {/* Toggle row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1 rounded-lg transition-all duration-200 group",
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
      {expanded && (
        <div
          className={cn(
            "mt-1.5 ml-2 pl-3 border-l-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground",
            "transition-all duration-200 overflow-y-auto custom-scrollbar max-h-[160px]", // ~10 lines of text
            isThinking ? "border-primary/40" : "border-border",
          )}
        >
          {thinkingContent ? (
            <div className="prose prose-invert prose-sm max-w-none text-muted-foreground *:[font-size:10px] [&>p]:leading-relaxed">
              {thinkingContent}
            </div>
          ) : (
            <span className="italic opacity-60">
              {isThinking ? "Thinking…" : "No thinking content available."}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────
// ToolActionBlock sub-component
// ─────────────────────────────────────────────────────

import { Wrench, CheckCircle2, Loader2, AlertCircle } from "lucide-react";

interface ToolActionBlockProps {
  tool: {
    id: string;
    name: string;
    args?: any;
    status: 'pending' | 'success' | 'error';
  };
}

const ToolActionBlock: React.FC<ToolActionBlockProps> = ({ tool }) => {
  const [expanded, setExpanded] = useState(false);

  // Format arguments beautifully if they exist
  let argPreview = "";
  if (tool.args) {
    try {
      const keys = Object.keys(tool.args);
      if (keys.length > 0) {
          argPreview = " · " + keys.map(k => {
             const val = String(tool.args[k]);
             return `${k}: ${val.length > 15 ? val.substring(0, 15) + '...' : val}`;
          }).join(', ');
      }
    } catch (e) {}
  }

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all duration-200 group w-full",
          "border text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/60"
        )}
      >
        {tool.status === 'pending' && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
        {tool.status === 'success' && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
        {tool.status === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
        
        <span className="flex-1 text-left">
           Using <span className="font-semibold text-foreground/80">{tool.name}</span>
           <span className="opacity-70 font-mono text-[9px]">{argPreview}</span>
        </span>
        
        {expanded ? (
          <ChevronDown className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && tool.args && (
        <div className="mt-1.5 ml-2 pl-3 border-l-2 border-border text-[9px] font-mono text-muted-foreground overflow-x-auto bg-muted/20 py-1.5 rounded-r">
          <pre>{JSON.stringify(tool.args, null, 2)}</pre>
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
  think: ({ node: _n, children }: any) => {
    // We treat inline <think> tags as non-active (completed) thoughts so they don't pulse endlessly
    return <ThinkingBlock isThinking={false} thinkingContent={children} />;
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
  <div className="chat-markdown">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeHighlight]}
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

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          isUser ? "max-w-[70%]" : "w-full",
          "rounded-[8px] px-4 py-2.5 mt-2 transition-all duration-200",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-[2px] shadow-sm"
            : "bg-card text-foreground rounded-tl-[2px] border border-border",
        )}
      >

        {/* Tool Action Blocks */}
        {!isUser && message.toolCalls && message.toolCalls.map((tool, idx) => (
          <ToolActionBlock key={tool.id || idx} tool={tool} />
        ))}

        {/* Message content */}
        {message.content && (
          <>
            {isUser ? (
              // User messages: preserve line breaks, no markdown
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
            ) : (
              // Assistant messages: full markdown rendering
              <MarkdownContent content={message.content} />
            )}
          </>
        )}
      </div>
    </div>
  );
});
