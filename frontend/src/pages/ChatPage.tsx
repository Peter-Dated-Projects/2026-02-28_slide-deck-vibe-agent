import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
    ChevronLeft,
    CreditCard,
    FileText,
    Home,
    Loader2,
    Pencil,
    Plus,
    Presentation,
    Save,
    Send,
    Trash2,
    X,
} from "lucide-react";
import Editor from "@monaco-editor/react";

import { useAuth } from "../contexts/AuthContext";
import api, { getAccessToken } from "../api";
import { CrdtCanvas } from "../components/CrdtCanvas";
import { ChatMessage } from "../components/chat/ChatMessage";
import { TaskListBar, type AgentTask } from "../components/chat/TaskListBar";
import { usePersistentWidth } from "../hooks/usePersistentWidth";
import {
    useChatStream,
    type ChatMessage as ChatMessageData,
    type ConversationMeta,
} from "../hooks/useChatStream";

function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(" ");
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
    );
}

interface ConversationHistoryEntry {
    id: string;
    projectId: string | null;
    title: string;
    projectName?: string;
    createdAt: string;
    updatedAt: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatLastEdited(dateString: string): string {
    const t = new Date(dateString).getTime();
    if (Number.isNaN(t)) return "recently edited";
    const diffSec = Math.round((t - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 45) return "just now";
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ["year", 31536000],
        ["month", 2592000],
        ["week", 604800],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
    ];
    for (const [unit, seconds] of units) {
        if (abs >= seconds) {
            return relativeTimeFormatter.format(Math.round(diffSec / seconds), unit).toLowerCase();
        }
    }
    return relativeTimeFormatter.format(diffSec, "second").toLowerCase();
}

function sortHistory(entries: ConversationHistoryEntry[]): ConversationHistoryEntry[] {
    return [...entries].sort(
        (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

function extractTasks(messages: ChatMessageData[]): AgentTask[] {
    let latest: AgentTask[] = [];
    for (const m of messages) {
        if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
        for (const block of m.content) {
            if (block.type !== "tool_result") continue;
            try {
                const parsed = JSON.parse(block.result);
                if (parsed && Array.isArray(parsed.tasks)) {
                    const next: AgentTask[] = [];
                    const seen = new Set<string>();
                    for (const raw of parsed.tasks) {
                        const id = String(raw?.id ?? "").trim();
                        const title = String(raw?.title ?? "").trim();
                        if (!id || !title || seen.has(id)) continue;
                        seen.add(id);
                        next.push({ id, title, done: Boolean(raw?.done) });
                    }
                    if (next.length > 0) latest = next;
                }
            } catch {
                // ignore
            }
        }
    }
    return latest;
}

const ChatPage: React.FC = () => {
    const { conversationId } = useParams<{ conversationId?: string }>();
    const [searchParams] = useSearchParams();
    const projectId = searchParams.get("projectId");
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const [input, setInput] = useState("");
    const [historyLoading, setHistoryLoading] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deckTitle, setDeckTitle] = useState("New Chat");
    const [conversationTitle, setConversationTitle] = useState("New Chat");
    const [isTitleFocused, setIsTitleFocused] = useState(false);
    const [history, setHistory] = useState<ConversationHistoryEntry[]>([]);
    const [historyLoadingList, setHistoryLoadingList] = useState(true);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [rightPanelTab, setRightPanelTab] = useState<"preview" | "design">("preview");
    const [designContent, setDesignContent] = useState<string>("");
    const [isSavingDesign, setIsSavingDesign] = useState(false);

    const [sidebarWidth, setSidebarWidth] = usePersistentWidth({
        storageKey: "vibe-agent.chat-sidebar-width",
        defaultWidth: 380,
        minWidth: 350,
        maxWidth: 550,
    });
    const [isResizing, setIsResizing] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const userScrolledUp = useRef(false);

    const handleConversationMeta = useCallback(
        (meta: ConversationMeta) => {
            if (meta.title?.trim()) setConversationTitle(meta.title);
            if (meta.projectName?.trim()) setDeckTitle(meta.projectName);
        },
        []
    );

    const { messages, send, isStreaming, isCompressing, reset } = useChatStream({
        apiUrl: import.meta.env.VITE_API_URL,
        onConversation: handleConversationMeta,
    });

    const agentTasks = useMemo(() => extractTasks(messages), [messages]);
    const isEmpty = messages.length === 0 && !isStreaming && !historyLoading;
    const activeChatLabel = conversationTitle.trim() || "New Chat";
    const visibleHistory = useMemo(
        () => (projectId ? history.filter((h) => h.projectId === projectId) : history),
        [history, projectId]
    );

    // ── Conversation history list ───────────────────────────────────────────
    const loadHistory = useCallback(async () => {
        setHistoryLoadingList(true);
        try {
            const res = await api.get("/conversations", { params: projectId ? { projectId } : undefined });
            const next: ConversationHistoryEntry[] = (res.data.conversations ?? []).map((e: any) => ({
                id: e.id,
                projectId: e.projectId ?? null,
                title: e.title ?? "Untitled",
                projectName: e.projectName,
                createdAt: e.createdAt,
                updatedAt: e.updatedAt,
            }));
            setHistory(sortHistory(next));
            if (projectId) {
                const projectName = next.find((e) => e.projectId === projectId)?.projectName;
                if (projectName?.trim()) setDeckTitle(projectName);
            }
            if (conversationId) {
                const current = next.find((e) => e.id === conversationId);
                if (current?.title?.trim()) setConversationTitle(current.title);
            }
        } catch (err) {
            console.error("Failed to load conversations:", err);
        } finally {
            setHistoryLoadingList(false);
        }
    }, [conversationId, projectId]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    useEffect(() => {
        if (!conversationId) setConversationTitle("New Chat");
    }, [conversationId]);

    // ── Load message history when opening an existing conversation ──────────
    useEffect(() => {
        if (!conversationId) {
            reset([]);
            return;
        }
        setHistoryLoading(true);
        if (projectId) void fetchDesign(projectId);
        api.get(`/conversations/${conversationId}/messages`)
            .then((res) => {
                const hydrated: ChatMessageData[] = (res.data.messages ?? []).map((m: any) => ({
                    id: m.id,
                    role: m.role,
                    content: hydrateStoredContent(m),
                }));
                reset(hydrated);
                if (res.data.title) setConversationTitle(res.data.title);
                if (res.data.projectName) setDeckTitle(res.data.projectName);
                userScrolledUp.current = false;
                setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior }), 50);
            })
            .catch((err) => console.error("Failed to load conversation history:", err))
            .finally(() => setHistoryLoading(false));
    }, [conversationId, projectId, reset]);

    // ── Auto scroll to bottom ───────────────────────────────────────────────
    useEffect(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        const onScroll = () => {
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            userScrolledUp.current = dist > 80;
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (userScrolledUp.current) return;
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Title save (debounced) ──────────────────────────────────────────────
    useEffect(() => {
        if (!deckTitle.trim()) return;
        const timer = setTimeout(() => {
            const request = projectId
                ? api.patch(`/projects/${projectId}/name`, { name: deckTitle.trim() })
                : conversationId
                  ? api.patch(`/conversations/${conversationId}/title`, { title: deckTitle.trim() })
                  : null;
            if (!request) return;
            request
                .then(() => {
                    if (!projectId && conversationId) {
                        setHistory((prev) => {
                            const existing = prev.find((e) => e.id === conversationId);
                            const next: ConversationHistoryEntry = {
                                id: conversationId,
                                projectId: null,
                                title: deckTitle.trim(),
                                projectName: existing?.projectName,
                                createdAt: existing?.createdAt ?? new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                            };
                            return sortHistory([next, ...prev.filter((e) => e.id !== conversationId)]);
                        });
                    }
                })
                .catch((err) => console.error("Failed to save title:", err));
        }, 600);
        return () => clearTimeout(timer);
    }, [conversationId, deckTitle, projectId]);

    // ── Design doc ──────────────────────────────────────────────────────────
    const fetchDesign = async (id: string) => {
        try {
            const res = await api.get(`/projects/${id}/design`);
            setDesignContent(res.data.design || "");
        } catch (err) {
            console.error("Failed to fetch design:", err);
        }
    };

    const handleSaveDesign = async () => {
        if (!projectId) return;
        setIsSavingDesign(true);
        try {
            await api.put(`/projects/${projectId}/design`, { design: designContent });
        } catch (err) {
            console.error("Failed to save design:", err);
        } finally {
            setIsSavingDesign(false);
        }
    };

    // ── Resizable sidebar ───────────────────────────────────────────────────
    const handleResizeMouseDown = (e: React.MouseEvent) => {
        const startX = e.clientX;
        const startWidth = sidebarWidth;
        setIsResizing(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const onMouseMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            setSidebarWidth(Math.min(550, Math.max(350, startWidth + delta)));
        };
        const onMouseUp = () => {
            setIsResizing(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    // ── Send ─────────────────────────────────────────────────────────────────
    const submit = async () => {
        const text = input.trim();
        if (!text || isStreaming) return;
        setInput("");
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.overflowY = "hidden";
        }
        userScrolledUp.current = false;
        const result = await send(text, {
            conversationId: conversationId ?? undefined,
            projectId: projectId ?? undefined,
        });
        if (!conversationId && result.conversationId) {
            navigate(`/chat/${result.conversationId}${projectId ? `?projectId=${projectId}` : ""}`, {
                replace: true,
            });
        }
        await loadHistory();
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void submit();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!isStreaming && input.trim()) void submit();
        }
    };

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        const styles = window.getComputedStyle(el);
        const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
        const padTop = Number.parseFloat(styles.paddingTop) || 0;
        const padBottom = Number.parseFloat(styles.paddingBottom) || 0;
        const max = lineHeight * 3 + padTop + padBottom;
        el.style.height = `${Math.min(el.scrollHeight, max)}px`;
        el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    };

    const handleDeleteAccount = async () => {
        if (!window.confirm("Are you certain you want to delete your account? This action cannot be undone.")) return;
        setIsDeleting(true);
        try {
            await api.delete("/user/me");
            logout();
        } catch (err) {
            console.error("Failed to delete account", err);
            alert("Failed to delete account");
            setIsDeleting(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">
            {isResizing && <div className="fixed inset-0 z-[9999] cursor-col-resize" />}

            {/* LEFT — Chat */}
            <div className="relative shrink-0 border-r border-border flex flex-col bg-card" style={{ width: sidebarWidth }}>
                <div className="h-16 border-b border-border flex items-center gap-2 px-4 shrink-0 bg-muted/50">
                    <button
                        onClick={() => navigate("/")}
                        className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 hover:opacity-75 transition-opacity cursor-pointer"
                        title="Back to Dashboard"
                    >
                        <Home className="w-4 h-4 text-primary" />
                    </button>
                    <div className="relative flex-1 min-w-0 flex items-center group">
                        <input
                            type="text"
                            value={deckTitle}
                            onChange={(e) => setDeckTitle(e.target.value)}
                            onFocus={() => setIsTitleFocused(true)}
                            onBlur={() => setIsTitleFocused(false)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            className={cn(
                                "w-full bg-transparent text-sm font-semibold text-foreground tracking-wide px-1.5 py-0.5 rounded-md outline-none truncate transition-all",
                                isTitleFocused ? "ring-1 ring-primary/50 bg-muted/60" : "hover:bg-muted/40"
                            )}
                            title={deckTitle}
                            maxLength={120}
                        />
                        {!isTitleFocused && (
                            <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity absolute right-1.5 pointer-events-none" />
                        )}
                    </div>
                    <button
                        onClick={() => {
                            reset([]);
                            setConversationTitle("New Chat");
                            setHistoryOpen(false);
                            navigate(projectId ? `/chat?projectId=${projectId}` : `/chat`, { replace: true });
                        }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted cursor-pointer"
                        title="New Chat"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setHistoryOpen((v) => !v)}
                        aria-expanded={historyOpen}
                        className="w-full h-9 border-b border-border flex items-center gap-1.5 px-2 bg-card text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                    >
                        <span className="flex h-6 w-6 items-center justify-center rounded-sm">
                            <ChevronLeft className={cn("h-3.5 w-3.5 transition-transform duration-200", historyOpen && "-rotate-90")} />
                        </span>
                        <span className="truncate text-xs font-semibold">{activeChatLabel}</span>
                    </button>
                    {historyOpen && (
                        <div className="absolute left-0 right-0 top-full z-30 border-b border-border bg-white shadow-sm">
                            <div className="max-h-56 overflow-y-auto custom-scrollbar">
                                {historyLoadingList ? (
                                    <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        <span>Loading chats…</span>
                                    </div>
                                ) : visibleHistory.length === 0 ? (
                                    <div className="px-2 py-3 text-xs text-muted-foreground">No saved chats yet.</div>
                                ) : (
                                    visibleHistory.map((entry) => {
                                        const active = entry.id === conversationId;
                                        return (
                                            <button
                                                key={entry.id}
                                                onClick={() => {
                                                    setHistoryOpen(false);
                                                    navigate(
                                                        entry.projectId
                                                            ? `/chat/${entry.id}?projectId=${entry.projectId}`
                                                            : `/chat/${entry.id}`
                                                    );
                                                }}
                                                className={cn(
                                                    "w-full border px-1.5 py-1 text-left transition-colors",
                                                    active
                                                        ? "border-primary/30 bg-primary/10"
                                                        : "border-transparent bg-card hover:border-border hover:bg-card/80"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-1.5">
                                                    <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                                                        {entry.title.trim() || "Untitled Project"}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 text-[9px] lowercase tracking-wide text-muted-foreground">
                                                    {formatLastEdited(entry.updatedAt)}
                                                </p>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 scroll-smooth custom-scrollbar">
                    {historyLoading && (
                        <div className="h-full flex items-center justify-center text-muted-foreground">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            <span className="text-sm">Loading conversation…</span>
                        </div>
                    )}
                    {isEmpty && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-muted-foreground mt-12">
                            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center border border-border">
                                <SparklesIcon className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <p className="max-w-[250px] leading-relaxed text-xs">
                                Hi {user?.email}! I'm Vibe. <br /> Describe the presentation you want to build.
                            </p>
                        </div>
                    )}
                    {!historyLoading && messages.map((m) => <ChatMessage key={m.id} message={m} />)}
                    {isCompressing && (
                        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground bg-muted/30 rounded-lg animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Compressing memory…</span>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                    <div aria-hidden="true" className="h-[30%] min-h-20" />
                </div>

                <div className="relative p-2 bg-card border-t border-border shrink-0">
                    <div className="absolute left-0 right-0 bottom-full z-30">
                        <TaskListBar tasks={agentTasks} />
                    </div>
                    <form onSubmit={handleFormSubmit} className="relative flex items-end gap-2">
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            value={input}
                            onChange={handleTextareaChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Describe what to build…"
                            className="flex-1 bg-background border border-border rounded-xl pl-3.5 pr-3.5 py-2 text-xs text-foreground resize-none overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all placeholder:text-muted-foreground leading-relaxed"
                        />
                        <button
                            type="submit"
                            disabled={isStreaming || !input.trim()}
                            className="p-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 self-end"
                        >
                            {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                    </form>
                    <p className="text-[9px] text-center text-muted-foreground mt-2">
                        Vibe can make mistakes. Check your slides.
                    </p>
                </div>
            </div>

            {/* Resize Handle */}
            <div
                onMouseDown={handleResizeMouseDown}
                className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors relative group"
                title="Drag to resize"
            >
                <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-border group-hover:bg-primary/50 transition-colors" />
            </div>

            {/* RIGHT — Canvas */}
            <div className="flex-1 relative bg-muted overflow-hidden flex flex-col">
                <div className="h-14 shrink-0 flex items-center justify-end px-4 z-30 relative bg-card/60 backdrop-blur-sm shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
                    <div className="relative">
                        <button
                            onClick={() => setShowSettings((v) => !v)}
                            className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/10 cursor-pointer"
                            title="Profile & Settings"
                        >
                            {user?.profile_picture ? (
                                <img src={user.profile_picture} alt="Profile" className="w-8 h-8 rounded-full ring-2 ring-border" />
                            ) : (
                                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold ring-2 ring-border">
                                    {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                                </div>
                            )}
                        </button>
                        {showSettings && user && (
                            <div className="absolute top-10 right-0 w-80 bg-card border border-border rounded-xl shadow-card p-6 z-50 animate-in fade-in slide-in-from-top-2">
                                <div className="flex justify-between items-start mb-4">
                                    <h3 className="text-lg font-semibold text-foreground">Profile Settings</h3>
                                    <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                <div className="flex items-center gap-4 mb-6">
                                    {user.profile_picture ? (
                                        <img src={user.profile_picture} alt="Profile" className="w-12 h-12 rounded-full border border-border" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-lg text-primary-foreground font-bold shadow-sm">
                                            {user.name?.charAt(0) || user.email?.charAt(0)}
                                        </div>
                                    )}
                                    <div>
                                        <div className="text-[15px] font-medium text-foreground">{user.name}</div>
                                        <div className="text-[13px] text-muted-foreground">{user.email}</div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <button className="w-full flex items-center justify-center gap-2 bg-muted hover:bg-muted/80 text-foreground py-2.5 rounded-lg transition-colors text-sm font-medium border border-border">
                                        <CreditCard className="w-4 h-4" />
                                        Billing Information
                                    </button>
                                    <button
                                        onClick={handleDeleteAccount}
                                        disabled={isDeleting}
                                        className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 py-2.5 rounded-lg transition-colors text-sm font-medium border border-red-500/20 disabled:opacity-50"
                                    >
                                        {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                        Delete Account
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="h-10 shrink-0 border-b border-border bg-card/80 px-2 flex items-center gap-1">
                    {(["preview", "design"] as const).map((tab) => {
                        const Icon = tab === "preview" ? Presentation : FileText;
                        const label = tab === "preview" ? "Preview" : "Design";
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setRightPanelTab(tab)}
                                className={cn(
                                    "h-7 px-3 rounded-md text-xs font-medium transition-colors border",
                                    rightPanelTab === tab
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-background/70 text-muted-foreground border-border hover:text-foreground hover:bg-muted/40"
                                )}
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    <Icon className="w-3.5 h-3.5" />
                                    {label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className={cn("absolute inset-x-0 bottom-0 top-24", rightPanelTab === "preview" ? "opacity-100" : "opacity-0 pointer-events-none")}>
                    <div
                        className="absolute inset-x-2 bottom-2 top-0 opacity-20 pointer-events-none"
                        style={{
                            backgroundImage: "radial-gradient(circle at center, #aaa 1px, transparent 1px)",
                            backgroundSize: "24px 24px",
                        }}
                    />
                    <div className="absolute inset-x-2 bottom-2 top-0">
                        {projectId ? (
                            <CrdtCanvas projectId={projectId} />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                                <Presentation className="w-16 h-16 opacity-30" />
                                <p className="text-xl font-medium tracking-wide">Canvas is empty</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className={cn("absolute inset-x-2 bottom-2 top-24 rounded-lg border border-border bg-[#1e1e1e] text-zinc-100 overflow-hidden flex flex-col", rightPanelTab === "design" ? "opacity-100 z-10" : "opacity-0 pointer-events-none z-0")}>
                    <div className="h-9 shrink-0 border-b border-zinc-800/80 px-3 flex items-center justify-between bg-[#252526]">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-400">DESIGN.md</span>
                        <button
                            onClick={handleSaveDesign}
                            disabled={isSavingDesign}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                            {isSavingDesign ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save
                        </button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
                        <Editor
                            height="100%"
                            defaultLanguage="markdown"
                            value={designContent}
                            onChange={(value) => setDesignContent(value || "")}
                            theme="vs-dark"
                            options={{
                                minimap: { enabled: false },
                                lineNumbers: "on",
                                fontSize: 13,
                                lineHeight: 22,
                                wordWrap: "on",
                                scrollBeyondLastLine: false,
                                renderLineHighlight: "line",
                                automaticLayout: true,
                                tabSize: 2,
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Convert a stored DB message row into the assistant block array used by the UI.
 * The new backend stores a single `text` block plus separate `tool_calls`/`tool_results`
 * arrays; we recombine them into the typed AssistantBlock[] shape.
 */
function hydrateStoredContent(row: any): any {
    if (row.role === "user") {
        return typeof row.content === "string" ? row.content : row.content?.text ?? "";
    }
    const blocks: any[] = [];
    if (Array.isArray(row.content)) {
        for (const b of row.content) {
            if (b?.type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: b.text });
        }
    } else if (typeof row.content === "string" && row.content) {
        blocks.push({ type: "text", text: row.content });
    }
    if (Array.isArray(row.toolCalls)) {
        for (const tc of row.toolCalls) {
            const name = tc?.function?.name ?? tc?.name;
            if (typeof name !== "string") continue;
            const rawArgs = tc?.function?.arguments ?? tc?.args ?? {};
            let args: Record<string, unknown> = {};
            if (typeof rawArgs === "string") {
                try {
                    const parsed = JSON.parse(rawArgs);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        args = parsed as Record<string, unknown>;
                    }
                } catch {
                    /* ignore */
                }
            } else if (rawArgs && typeof rawArgs === "object") {
                args = rawArgs as Record<string, unknown>;
            }
            blocks.push({ type: "tool_call", call: { id: String(tc?.id ?? ""), name, args } });
        }
    }
    if (Array.isArray(row.toolResults)) {
        for (const r of row.toolResults) {
            blocks.push({
                type: "tool_result",
                id: String(r?.id ?? ""),
                result: typeof r?.result === "string" ? r.result : JSON.stringify(r?.result ?? ""),
            });
        }
    }
    return blocks;
}

export default ChatPage;
