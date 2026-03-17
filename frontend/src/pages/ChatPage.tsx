import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import api, { getAccessToken } from "../api";
import { SlideRenderer, type SlideData } from "../components/SlideRenderer";
import { ChatMessage, type ChatMessageData } from "../components/chat/ChatMessage";
import { TaskListBar, type AgentTask } from "../components/chat/TaskListBar";
import {
  Send,
  Loader2,
  Presentation,
  Trash2,
  CreditCard,
  X,
  Home,
  Pencil,
  Plus,
  ChevronLeft,
} from "lucide-react";
import { usePersistentWidth } from "../hooks/usePersistentWidth";
import {
  getConversationActivitySnapshot,
  subscribeConversationActivity,
  trackConversationRequest,
} from "../lib/conversationActivity";

// ─────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────

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
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getConversationRequestKey(conversationId?: string, projectId?: string | null) {
  return conversationId ?? `draft:${projectId ?? "global"}`;
}

function parseStreamSnapshot(snapshot: string) {
  const thinkStarts = snapshot.split("<think>").length - 1;
  const thinkEnds = snapshot.split("</think>").length - 1;
  let isThinking = thinkStarts > thinkEnds;

  if (!isThinking && thinkStarts === thinkEnds) {
    const stripped = snapshot.trim();
    const prefixes = ["<think", "<thin", "<thi", "<th", "<t", "<"];
    if (prefixes.includes(stripped) || !stripped) {
      if (snapshot.length < 8) {
        isThinking = true;
      }
    }
  }

  return { isThinking, thinkingContent: "", content: snapshot };
}

function parseJsonSafely(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeTaskArray(rawTasks: unknown): AgentTask[] {
  if (!Array.isArray(rawTasks)) {
    return [];
  }

  const normalized: AgentTask[] = [];
  const seen = new Set<string>();

  for (const rawTask of rawTasks) {
    if (!rawTask || typeof rawTask !== "object") {
      continue;
    }

    const task = rawTask as Record<string, unknown>;
    const id = String(task.id ?? "").trim();
    const title = String(task.title ?? "").trim();

    if (!id || !title || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalized.push({
      id,
      title,
      done: Boolean(task.done),
    });
  }

  return normalized;
}

function extractAgentTasks(messages: ChatMessageData[]): AgentTask[] {
  let latestSnapshot: AgentTask[] = [];
  let fallbackFromArguments: AgentTask[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const toolResult of message.toolResults ?? []) {
      const parsedResultEnvelope = parseJsonSafely(toolResult?.result);
      if (!parsedResultEnvelope || typeof parsedResultEnvelope !== "object") {
        continue;
      }

      const parsedResult = parsedResultEnvelope as Record<string, unknown>;
      const tasksFromResult = normalizeTaskArray(parsedResult.tasks);
      if (tasksFromResult.length > 0) {
        latestSnapshot = tasksFromResult;
      }
    }

    for (const toolCall of message.toolCalls ?? []) {
      const functionName = toolCall?.function?.name;
      if (functionName !== "set_task_list") {
        continue;
      }

      const parsedArgs = parseJsonSafely(toolCall?.function?.arguments);
      if (!parsedArgs || typeof parsedArgs !== "object") {
        continue;
      }

      const parsedObject = parsedArgs as Record<string, unknown>;
      const tasksFromArguments = normalizeTaskArray(parsedObject.tasks);
      if (tasksFromArguments.length > 0) {
        fallbackFromArguments = tasksFromArguments;
      }
    }
  }

  return latestSnapshot.length > 0 ? latestSnapshot : fallbackFromArguments;
}

interface ConversationHistoryEntry {
  id: string;
  projectId: string | null;
  title: string;
  projectName?: string;
  createdAt: string;
  updatedAt: string;
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function sortConversationHistory(entries: ConversationHistoryEntry[]) {
  return [...entries].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function upsertConversationHistory(
  entries: ConversationHistoryEntry[],
  nextEntry: ConversationHistoryEntry,
) {
  const normalizedEntry = {
    ...nextEntry,
    title: nextEntry.title.trim() || "Untitled",
  };

  return sortConversationHistory([
    normalizedEntry,
    ...entries.filter((entry) => entry.id !== normalizedEntry.id),
  ]);
}

function formatLastEdited(dateString: string) {
  const timestamp = new Date(dateString).getTime();

  if (Number.isNaN(timestamp)) {
    return "recently edited";
  }

  const diffMs = timestamp - Date.now();
  const diffSeconds = Math.round(diffMs / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);

  if (absoluteSeconds < 45) {
    return "just now";
  }

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, secondsPerUnit] of units) {
    if (absoluteSeconds >= secondsPerUnit) {
      return relativeTimeFormatter
        .format(Math.round(diffSeconds / secondsPerUnit), unit)
        .toLowerCase();
    }
  }

  return relativeTimeFormatter.format(diffSeconds, "second").toLowerCase();
}

// ─────────────────────────────────────────────────────
// ChatPage
// ─────────────────────────────────────────────────────

const ChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId");
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sidebarWidth, setSidebarWidth] = usePersistentWidth({
    storageKey: "vibe-agent.chat-sidebar-width",
    defaultWidth: 380,
    minWidth: 350,
    maxWidth: 550,
  });
  const [isResizingState, setIsResizingState] = useState(false);
  const [deckTitle, setDeckTitle] = useState("New Chat");
  const [conversationTitle, setConversationTitle] = useState("New Chat");
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationHistoryEntry[]>([]);
  const [isConversationHistoryLoading, setIsConversationHistoryLoading] = useState(true);
  const [isConversationHistoryOpen, setIsConversationHistoryOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const userScrolledUp = useRef(false);
  const liveConversationMessagesRef = useRef<Record<string, ChatMessageData[]>>({});
  const conversationActivity = useSyncExternalStore(
    subscribeConversationActivity,
    getConversationActivitySnapshot,
    getConversationActivitySnapshot,
  );
  const currentConversationKey = getConversationRequestKey(conversationId, projectId);
  const currentConversationKeyRef = useRef(currentConversationKey);
  const hasTriggeredExitPreviewRef = useRef(false);
  useEffect(() => {
    currentConversationKeyRef.current = currentConversationKey;
  }, [currentConversationKey]);
  const isCurrentConversationBusy = Boolean(conversationActivity[currentConversationKey]);
  const agentTasks = useMemo(() => extractAgentTasks(messages), [messages]);

  const adjustTextareaHeight = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = "auto";

    const styles = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const maxHeight = lineHeight * 3 + paddingTop + paddingBottom;
    const nextHeight = Math.min(element.scrollHeight, maxHeight);

    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  const loadConversationHistory = useCallback(async () => {
    setIsConversationHistoryLoading(true);
    try {
      const response = await api.get("/conversations", {
        params: projectId ? { projectId } : undefined,
      });
      const nextHistory: ConversationHistoryEntry[] = (response.data.conversations ?? []).map(
        (entry: any) => ({
          id: entry.id,
          projectId: entry.projectId ?? null,
          title: entry.title ?? "Untitled",
          projectName: entry.projectName,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }),
      );

      setConversationHistory(sortConversationHistory(nextHistory));

      if (projectId) {
        const currentProjectName = nextHistory.find(
          (entry) => entry.projectId === projectId,
        )?.projectName;
        if (currentProjectName?.trim()) {
          setDeckTitle(currentProjectName);
        }
      }

      if (conversationId) {
        const currentConversation = nextHistory.find((entry) => entry.id === conversationId);
        if (currentConversation?.title?.trim()) {
          setConversationTitle(currentConversation.title);
        }
      }
    } catch (error) {
      console.error("Failed to load conversations:", error);
    } finally {
      setIsConversationHistoryLoading(false);
    }
  }, [conversationId, projectId]);

  const visibleConversationHistory = useMemo(() => {
    if (!projectId) {
      return conversationHistory;
    }

    return conversationHistory.filter((entry) => entry.projectId === projectId);
  }, [conversationHistory, projectId]);

  useEffect(() => {
    void loadConversationHistory();
  }, [loadConversationHistory]);

  useEffect(() => {
    if (!conversationId) {
      setConversationTitle("New Chat");
    }
  }, [conversationId]);

  useEffect(() => {
    hasTriggeredExitPreviewRef.current = false;

    if (!projectId) {
      return;
    }

    const triggerPreviewGeneration = () => {
      if (hasTriggeredExitPreviewRef.current) {
        return;
      }

      hasTriggeredExitPreviewRef.current = true;
      const token = getAccessToken();
      if (!token) {
        return;
      }

      fetch(`${import.meta.env.VITE_API_URL}/projects/${projectId}/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
        keepalive: true,
        body: JSON.stringify({ reason: "page-exit" }),
      }).catch((error) => {
        console.error("Failed to generate project preview on exit:", error);
      });
    };

    const handleBeforeUnload = () => {
      triggerPreviewGeneration();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      triggerPreviewGeneration();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [projectId]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = sidebarWidth;
    setIsResizingState(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - startX.current;
      const newWidth = Math.min(550, Math.max(350, startWidth.current + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      setIsResizingState(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const scrollToBottom = useCallback(() => {
    if (userScrolledUp.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Detect manual upward scroll — stop auto-scrolling while user is reading
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUp.current = distFromBottom > 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ─────────────────────────────────────────────────────
  // Load message history when conversation already exists
  // ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId) return;

    const liveMessages = liveConversationMessagesRef.current[conversationId];
    if (liveMessages && getConversationActivitySnapshot()[conversationId]) {
      setMessages(liveMessages);
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    Promise.all([
      api.get(`/conversations/${conversationId}/messages`),
      projectId ? fetchPresentation(projectId) : Promise.resolve(),
    ])
      .then(([msgRes]) => {
        const hydratedMessages: ChatMessageData[] = (msgRes.data.messages ?? []).map(
          (m: {
            id: string;
            role: "user" | "assistant";
            content: string;
            thinkTimers?: { startTime: number; endTime?: number }[];
            toolCalls?: any[];
            toolResults?: any[];
          }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            thinkTimers: m.thinkTimers,
            toolCalls: m.toolCalls,
            toolResults: m.toolResults,
          }),
        );
        setMessages(hydratedMessages);
        liveConversationMessagesRef.current[conversationId] = hydratedMessages;
        if (msgRes.data.title) {
          setConversationTitle(msgRes.data.title);
        }
        if (msgRes.data.projectName) {
          setDeckTitle(msgRes.data.projectName);
        } else if (msgRes.data.title) {
          setDeckTitle(msgRes.data.title);
        }
        // Always start at the bottom when opening a conversation
        userScrolledUp.current = false;
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "instant" }), 50);
      })
      .catch((err) => {
        console.error("Failed to load conversation history:", err);
      })
      .finally(() => {
        setHistoryLoading(false);
      });
  }, [conversationId, projectId]);

  // ─────────────────────────────────────────────────────
  // Debounced title save
  // ─────────────────────────────────────────────────────
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
          if (!projectId) {
            setConversationHistory((prev) =>
              upsertConversationHistory(prev, {
                id: conversationId!,
                projectId: projectId ?? null,
                title: deckTitle.trim(),
                projectName: prev.find((entry) => entry.id === conversationId)?.projectName,
                createdAt:
                  prev.find((entry) => entry.id === conversationId)?.createdAt ??
                  new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }),
            );
          }
        })
        .catch((err) => console.error("Failed to save title:", err));
    }, 600);
    return () => clearTimeout(timer);
  }, [conversationId, deckTitle, projectId]);

  // ─────────────────────────────────────────────────────
  // Slide fetching
  // ─────────────────────────────────────────────────────
  const fetchPresentation = async (id: string) => {
    try {
      const res = await api.get(`/presentation/${id}`);
      if (res.data.slides && res.data.slides.length > 0) {
        const formattedSlides: SlideData[] = res.data.slides.map((s: any, i: number) => ({
          id: s.minio_object_key || `slide-${i}`,
          title: `Slide ${i + 1}`,
          content: "Loading slide content...",
          layoutType: "title",
          minio_object_key: s.minio_object_key,
          theme_data: s.theme_data,
        }));
        const presentationHtml = typeof res.data.html === "string" ? res.data.html : "";
        setSlides(formattedSlides.map((slide) => ({ ...slide, rawHtml: presentationHtml })));
      }
    } catch (error) {
      console.error("Failed to fetch presentation:", error);
    }
  };

  // ─────────────────────────────────────────────────────
  // Auto-grow textarea height
  // ─────────────────────────────────────────────────────
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    adjustTextareaHeight(e.target);
  };

  // ─────────────────────────────────────────────────────
  // Keyboard handler: Enter sends, Shift+Enter newline
  // ─────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isCurrentConversationBusy && input.trim()) {
        submitMessage();
      }
    }
  };

  // ─────────────────────────────────────────────────────
  // Send message
  // ─────────────────────────────────────────────────────
  const submitMessage = async () => {
    const userText = input.trim();
    if (!userText || isCurrentConversationBusy) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }
    userScrolledUp.current = false; // snap back to bottom for new message

    let requestConversationKey = currentConversationKey;
    let stopTrackingConversation: (() => void) | null = null;

    const setMessagesForConversationKey = (
      key: string,
      updater: ChatMessageData[] | ((previous: ChatMessageData[]) => ChatMessageData[]),
    ) => {
      const previous =
        liveConversationMessagesRef.current[key] ??
        (currentConversationKeyRef.current === key ? messages : []);
      const next = typeof updater === "function" ? updater(previous) : updater;
      liveConversationMessagesRef.current[key] = next;

      if (currentConversationKeyRef.current === key) {
        setMessages(next);
      }

      return next;
    };

    const switchConversationTracking = (nextKey: string) => {
      if (requestConversationKey === nextKey && stopTrackingConversation) {
        return;
      }

      stopTrackingConversation?.();
      requestConversationKey = nextKey;
      stopTrackingConversation = trackConversationRequest(nextKey);
    };

    switchConversationTracking(requestConversationKey);

    // 1. Append user message immediately
    const userMsg: ChatMessageData = {
      id: generateId(),
      role: "user",
      content: userText,
    };
    setMessagesForConversationKey(requestConversationKey, (prev) => [...prev, userMsg]);

    // 2. Insert thinking placeholder
    const assistantId = generateId();
    const thinkingStartedAt = Date.now();
    setMessagesForConversationKey(requestConversationKey, (prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: [], // Feed an empty array so ChatMessage natively hits the `blocks.length === 0` branch and renders an immediate thinking block.
        isThinking: true,
        thinkingStartedAt,
        thinkingContent: "",
      },
    ]);

    let doneConvId = conversationId ?? null;
    let resolvedConversationId = conversationId ?? null;

    const startConversationTracking = (
      nextConversationId: string,
      nextProjectId?: string | null,
      nextTitle?: string,
    ) => {
      const shouldUpdateHistory = !nextConversationId.startsWith("draft:");

      if (stopTrackingConversation && resolvedConversationId === nextConversationId) {
        if (shouldUpdateHistory) {
          setConversationHistory((prev) =>
            upsertConversationHistory(prev, {
              id: nextConversationId,
              projectId: nextProjectId ?? projectId ?? null,
              title:
                nextTitle?.trim() ||
                prev.find((entry) => entry.id === nextConversationId)?.title ||
                "New Chat",
              projectName: prev.find((entry) => entry.id === nextConversationId)?.projectName,
              createdAt:
                prev.find((entry) => entry.id === nextConversationId)?.createdAt ??
                new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
          );
        }
        return;
      }

      resolvedConversationId = nextConversationId;
      const previousConversationKey = requestConversationKey;
      switchConversationTracking(nextConversationId);

      if (previousConversationKey !== nextConversationId) {
        const pendingMessages = liveConversationMessagesRef.current[previousConversationKey];
        if (pendingMessages) {
          liveConversationMessagesRef.current[nextConversationId] = pendingMessages;
          delete liveConversationMessagesRef.current[previousConversationKey];
        }
      }

      if (shouldUpdateHistory) {
        setConversationHistory((prev) =>
          upsertConversationHistory(prev, {
            id: nextConversationId,
            projectId: nextProjectId ?? projectId ?? null,
            title:
              nextTitle?.trim() ||
              prev.find((entry) => entry.id === nextConversationId)?.title ||
              "New Chat",
            projectName: prev.find((entry) => entry.id === nextConversationId)?.projectName,
            createdAt:
              prev.find((entry) => entry.id === nextConversationId)?.createdAt ??
              new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );
      }
    };

    try {
      startConversationTracking(currentConversationKey, projectId, deckTitle);

      const payload: Record<string, string> = { message: userText };
      if (conversationId) payload.conversationId = conversationId;
      if (projectId) payload.projectId = projectId;

      const token = getAccessToken();
      const response = await fetch(`${import.meta.env.VITE_API_URL}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Stream request failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentBlocks: any[] = [];
      let accumulatedText = "";
      let pendingTokens = false;
      let thinkTimers: { startTime: number; endTime?: number }[] = [
        { startTime: thinkingStartedAt },
      ];

      let toolCallsCache: any[] = [];
      let toolResultsCache: any[] = [];
      const requestPresentationRefresh = () => {
        if (projectId) {
          fetchPresentation(projectId);
        }
      };

      const attemptUpdateState = () => {
        // Deep copy the blocks because they might still mutate
        const snapshotBlocks = JSON.parse(JSON.stringify(contentBlocks));
        const snapshotTimers = JSON.parse(JSON.stringify(thinkTimers));

        const isThinkingActive =
          contentBlocks.length > 0 &&
          contentBlocks[contentBlocks.length - 1].type === "think" &&
          !contentBlocks[contentBlocks.length - 1].endTime;

        setMessagesForConversationKey(requestConversationKey, (prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: snapshotBlocks.length > 0 ? snapshotBlocks : [],
                  isThinking: isThinkingActive,
                  thinkTimers: snapshotTimers,
                  toolCalls: toolCallsCache.length > 0 ? [...toolCallsCache] : m.toolCalls,
                  toolResults: toolResultsCache.length > 0 ? [...toolResultsCache] : m.toolResults,
                }
              : m,
          ),
        );
      };

      // Flush pending tokens to React state at most every 50ms
      const flushInterval = setInterval(() => {
        if (!pendingTokens) return;
        pendingTokens = false;
        attemptUpdateState();
      }, 50);

      try {
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const eventMatch = part.match(/^event: (\w+)/);
            const dataMatch = part.match(/^data: (.+)$/m);
            if (!dataMatch) continue;

            const eventName = eventMatch?.[1] ?? "message";
            const data = JSON.parse(dataMatch[1]);

            if (eventName === "token") {
              const tokenStr = data.token;
              pendingTokens = true;

              if (tokenStr.startsWith("[TOOL_CALLS]") && tokenStr.endsWith("[/TOOL_CALLS]")) {
                try {
                  const jsonStr = tokenStr.substring(12, tokenStr.length - 13);
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.tool_calls) {
                    toolCallsCache.push(...parsed.tool_calls);
                    parsed.tool_calls.forEach((tc: any) =>
                      contentBlocks.push({ type: "tool_call", tool_call: tc }),
                    );
                  }
                } catch (e) {}
              } else if (
                tokenStr.trim().startsWith("[TOOL_RESULT]") &&
                tokenStr.trim().endsWith("[/TOOL_RESULT]")
              ) {
                try {
                  const cleanToken = tokenStr.trim();
                  const jsonStr = cleanToken.substring(13, cleanToken.length - 14);
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.id) {
                    toolResultsCache.push(parsed);
                    contentBlocks.push({
                      type: "tool_result",
                      id: parsed.id,
                      result: parsed.result,
                    });
                  }
                } catch (e) {}
              } else if (tokenStr === "[PRESENTATION_UPDATED]") {
                requestPresentationRefresh();
              } else {
                accumulatedText += tokenStr;

                const numThinkTags = accumulatedText.split("<think>").length - 1;
                while (thinkTimers.length < Math.max(1, numThinkTags)) {
                  thinkTimers.push({ startTime: Date.now() });
                }

                const newTextThinkBlocks: any[] = [];
                let remaining = accumulatedText;
                let thinkIdx = 0;

                while (remaining) {
                  const startIdx = remaining.indexOf("<think>");
                  if (startIdx === -1) {
                    if (remaining.trim())
                      newTextThinkBlocks.push({ type: "text", text: remaining });
                    break;
                  }
                  if (startIdx > 0) {
                    const textBefore = remaining.slice(0, startIdx);
                    if (textBefore.trim())
                      newTextThinkBlocks.push({ type: "text", text: textBefore });
                  }

                  const endIdx = remaining.indexOf("</think>", startIdx);
                  if (endIdx === -1) {
                    const timer = thinkTimers[thinkIdx];
                    newTextThinkBlocks.push({
                      type: "think",
                      text: remaining.slice(startIdx + 7).trim(),
                      startTime: timer?.startTime,
                      endTime: timer?.endTime,
                    });
                    break;
                  } else {
                    const timer = thinkTimers[thinkIdx];
                    if (timer && !timer.endTime) {
                      timer.endTime = Date.now();
                    }
                    newTextThinkBlocks.push({
                      type: "think",
                      text: remaining.slice(startIdx + 7, endIdx).trim(),
                      startTime: timer?.startTime,
                      endTime: timer?.endTime,
                    });
                    remaining = remaining.slice(endIdx + 8);
                    thinkIdx++;
                  }
                }

                let textThinkCursor = 0;
                const reconstructedBlocks: any[] = [];
                for (let b of contentBlocks) {
                  if (b.type === "tool_call" || b.type === "tool_result") {
                    reconstructedBlocks.push(b);
                  } else {
                    if (textThinkCursor < newTextThinkBlocks.length) {
                      reconstructedBlocks.push(newTextThinkBlocks[textThinkCursor]);
                      textThinkCursor++;
                    }
                  }
                }
                while (textThinkCursor < newTextThinkBlocks.length) {
                  reconstructedBlocks.push(newTextThinkBlocks[textThinkCursor]);
                  textThinkCursor++;
                }
                contentBlocks = reconstructedBlocks;
              }
            } else if (eventName === "conversation") {
              doneConvId = data.conversationId ?? doneConvId;
              if (data.conversationId) {
                startConversationTracking(
                  data.conversationId,
                  data.projectId ?? projectId ?? null,
                  data.title ?? "New Chat",
                );

                if (data.title?.trim()) {
                  setConversationTitle(data.title);
                }

                if (data.projectName?.trim()) {
                  setDeckTitle(data.projectName);
                }
              }
            } else if (eventName === "done") {
              doneConvId = data.conversationId;
              break outer;
            } else if (eventName === "error") {
              throw new Error(data.message ?? "Stream error");
            }
          }
        }
      } finally {
        clearInterval(flushInterval);
        attemptUpdateState();
      }

      // Navigate to conversation URL on first message
      if (!conversationId && doneConvId) {
        navigate(`/chat/${doneConvId}${projectId ? `?projectId=${projectId}` : ""}`, {
          replace: true,
        });
      }

      // Refetch slides
      if (projectId) fetchPresentation(projectId);
    } catch (error: any) {
      console.error("Chat error:", error);
      const thinkingElapsed = Math.floor((Date.now() - thinkingStartedAt) / 1000);
      setMessagesForConversationKey(requestConversationKey, (prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: "Sorry, I encountered an error processing your request. Please try again.",
                isThinking: false,
                thinkingTime: thinkingElapsed,
              }
            : m,
        ),
      );
    } finally {
      if (stopTrackingConversation) {
        stopTrackingConversation();
      }
      await loadConversationHistory();
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMessage();
  };

  const handleDeleteAccount = async () => {
    if (
      !window.confirm(
        "Are you certain you want to delete your account? This action cannot be undone.",
      )
    )
      return;
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

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  const isEmpty = messages.length === 0 && !isCurrentConversationBusy && !historyLoading;
  const activeChatLabel = conversationTitle.trim() || "New Chat";

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">
      {/* Full-screen overlay during resize to capture events over iframes */}
      {isResizingState && <div className="fixed inset-0 z-[9999] cursor-col-resize" />}
      {/*
        =========================================
        LEFT PANEL: CHAT INTERFACE
        =========================================
      */}
      <div
        className="shrink-0 border-r border-border flex flex-col bg-card"
        style={{ width: sidebarWidth }}
      >
        {/* Header */}
        <div className="h-16 border-b border-border flex items-center gap-2 px-4 shrink-0 bg-muted/50">
          {/* Logo icon — clickable, returns to dashboard */}
          <button
            onClick={() => navigate("/")}
            className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 hover:opacity-75 transition-opacity cursor-pointer"
            title="Back to Dashboard"
          >
            <Home className="w-4 h-4 text-primary" />
          </button>

          {/* Editable deck title */}
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
                "w-full bg-transparent text-sm font-semibold text-foreground tracking-wide",
                "px-1.5 py-0.5 rounded-md outline-none truncate transition-all",
                isTitleFocused ? "ring-1 ring-primary/50 bg-muted/60" : "hover:bg-muted/40",
              )}
              title={deckTitle}
              maxLength={120}
            />
            {!isTitleFocused && (
              <Pencil className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity absolute right-1.5 pointer-events-none" />
            )}
          </div>

          {/* New Chat button */}
          <button
            onClick={() => {
              setMessages([]);
              setConversationTitle("New Chat");
              setIsConversationHistoryOpen(false);
              navigate(projectId ? `/chat?projectId=${projectId}` : `/chat`, { replace: true });
            }}
            className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted cursor-pointer"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="h-11 border-b border-border flex items-center gap-2 px-3 shrink-0 bg-card">
          <button
            onClick={() => setIsConversationHistoryOpen((prev) => !prev)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={isConversationHistoryOpen ? "Hide chats" : "Show chats"}
          >
            <ChevronLeft
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isConversationHistoryOpen && "-rotate-90",
              )}
            />
          </button>
          <span className="truncate text-sm font-medium text-muted-foreground">
            {activeChatLabel}
          </span>
        </div>

        {isConversationHistoryOpen && (
          <div className="border-b border-border bg-muted/20 px-3 py-2">
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1 custom-scrollbar">
              {isConversationHistoryLoading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading chats…</span>
                </div>
              ) : visibleConversationHistory.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">No saved chats yet.</div>
              ) : (
                visibleConversationHistory.map((entry) => {
                  const isActiveConversation = entry.id === conversationId;
                  const status = conversationActivity[entry.id] ? "busy" : "idle";

                  return (
                    <button
                      key={entry.id}
                      onClick={() => {
                        setIsConversationHistoryOpen(false);
                        navigate(
                          entry.projectId
                            ? `/chat/${entry.id}?projectId=${entry.projectId}`
                            : `/chat/${entry.id}`,
                        );
                      }}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        isActiveConversation
                          ? "border-primary/30 bg-primary/10"
                          : "border-transparent bg-card hover:border-border hover:bg-card/80",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {entry.title.trim() || "Untitled Project"}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            status === "busy"
                              ? "bg-amber-500/15 text-amber-700"
                              : "bg-emerald-500/12 text-emerald-700",
                          )}
                        >
                          {status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] lowercase tracking-wide text-muted-foreground">
                        {formatLastEdited(entry.updatedAt)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Message History */}
        <div
          ref={messagesContainerRef}
          className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1 scroll-smooth custom-scrollbar"
        >
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

          <div ref={messagesEndRef} />
          <div aria-hidden="true" className="h-[30%] min-h-20" />
        </div>

        {/* Input Area */}
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
              className={cn(
                "flex-1 bg-background border border-border rounded-xl pl-3.5 pr-3.5 py-2 text-xs text-foreground resize-none overflow-y-auto",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all placeholder:text-muted-foreground",
                "leading-relaxed",
              )}
            />
            <button
              type="submit"
              disabled={isCurrentConversationBusy || !input.trim()}
              className="p-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 self-end"
            >
              {isCurrentConversationBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </form>
          <p className="text-[9px] text-center text-muted-foreground mt-2">
            Vibe can make mistakes. Check your slides.
          </p>
        </div>
      </div>

      {/* ── Resize Handle ── */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="w-1.5 shrink-0 cursor-col-resize bg-transparent hover:bg-primary/40 active:bg-primary/60 transition-colors relative group"
        title="Drag to resize"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-border group-hover:bg-primary/50 transition-colors" />
      </div>

      {/*
        =========================================
        RIGHT PANEL: SLIDE RENDERER CANVAS
        =========================================
      */}
      <div className="flex-1 relative bg-muted overflow-hidden flex flex-col">
        {/* ── Canvas Top Bar: reserved space for profile ── */}
        <div className="h-14 shrink-0 flex items-center justify-end px-4 z-30 relative bg-card/60 backdrop-blur-sm shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-full hover:bg-white/10 cursor-pointer"
              title="Profile & Settings"
            >
              {user?.profile_picture ? (
                <img
                  src={user.profile_picture}
                  alt="Profile"
                  className="w-8 h-8 rounded-full ring-2 ring-border"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-bold ring-2 ring-border">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                </div>
              )}
            </button>
            {showSettings && renderSettingsModal()}
          </div>
        </div>

        {/* ── Dot-grid background (below top bar) ── */}
        <div
          className="absolute inset-x-2 bottom-2 top-16 opacity-20 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle at center, #aaa 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {slides.length === 0 ? (
          <div className="absolute inset-x-2 bottom-2 top-16 flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <Presentation className="w-16 h-16 opacity-30" />
            <p className="text-xl font-medium tracking-wide">Canvas is empty</p>
          </div>
        ) : (
          <>
            {/* Slides fill the canvas below the top bar */}
            <div className="absolute inset-x-2 bottom-2 top-16">
              {slides.map((slide, idx) => (
                <div
                  key={slide.id || idx}
                  className={cn(
                    "absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    idx === currentSlideIndex
                      ? "opacity-100 translate-x-0 z-10"
                      : idx < currentSlideIndex
                        ? "opacity-0 -translate-x-full z-0"
                        : "opacity-0 translate-x-full z-0",
                  )}
                >
                  <SlideRenderer
                    slide={slide}
                    theme={slide.theme_data || slides[0]?.theme_data}
                    isActive={idx === currentSlideIndex}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );

  function renderSettingsModal() {
    if (!user) return null;
    return (
      <div className="absolute top-10 right-0 w-80 bg-card border border-border rounded-xl shadow-card p-6 z-50 animate-in fade-in slide-in-from-top-2">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-foreground">Profile Settings</h3>
          <button
            onClick={() => setShowSettings(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          {user.profile_picture ? (
            <img
              src={user.profile_picture}
              alt="Profile"
              className="w-12 h-12 rounded-full border border-border"
            />
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

        <div className="space-y-3 mb-6 bg-muted/20 rounded-lg p-3 border border-border">
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Age:</span>
            <span className="text-foreground">{user.age ? user.age : "Not specified"}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Joined:</span>
            <span className="text-foreground">
              {new Date(user.created_at).toLocaleDateString()}
            </span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Current Theme:</span>
            <span className="text-foreground capitalize">{user.settings?.theme || "Light"}</span>
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
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete Account
          </button>
        </div>
      </div>
    );
  }
};

export default ChatPage;
