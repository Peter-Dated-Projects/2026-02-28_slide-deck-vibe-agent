import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import { SlideRenderer, type SlideData } from '../components/SlideRenderer';
import { ChatMessage, type ChatMessageData } from '../components/chat/ChatMessage';
import {
  Send, Loader2, LogOut, ChevronLeft, ChevronRight,
  Presentation, Trash2, CreditCard, X,
} from 'lucide-react';

// ─────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" /><path d="M19 17v4" /><path d="M3 5h4" /><path d="M17 19h4" />
    </svg>
  );
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─────────────────────────────────────────────────────
// ChatPage
// ─────────────────────────────────────────────────────

const ChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch presentation if conversationId exists
  useEffect(() => {
    if (conversationId) {
      fetchPresentation(conversationId);
    }
  }, [conversationId]);

  const fetchPresentation = async (id: string) => {
    try {
      const res = await api.get(`/presentation/${id}`);
      if (res.data.slides && res.data.slides.length > 0) {
        const formattedSlides: SlideData[] = res.data.slides.map((s: any, i: number) => ({
          id: s.minio_object_key || `slide-${i}`,
          title: `Slide ${i + 1}`,
          content: 'Loading slide content...',
          layoutType: 'title',
          minio_object_key: s.minio_object_key,
          theme_data: s.theme_data,
        }));
        setSlides(formattedSlides);

        formattedSlides.forEach(async (slide, idx) => {
          if (slide.minio_object_key) {
            try {
              const slideRes = await api.get(`/storage?key=${slide.minio_object_key}`);
              setSlides(prev => {
                const next = [...prev];
                next[idx] = { ...next[idx], rawHtml: slideRes.data };
                return next;
              });
            } catch (e) { console.error('Failed fetching slide html'); }
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch presentation:', error);
    }
  };

  // ─────────────────────────────────────────────────────
  // Send message handler with mock frontend simulation
  // ─────────────────────────────────────────────────────

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    setIsLoading(true);

    // 1. Add user message
    const userMsg: ChatMessageData = {
      id: generateId(),
      role: 'user',
      content: userText,
    };
    setMessages(prev => [...prev, userMsg]);

    // 2. Add a thinking assistant message immediately
    const assistantId = generateId();
    const thinkingStartedAt = Date.now();

    const thinkingMsg: ChatMessageData = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isThinking: true,
      thinkingStartedAt,
      thinkingContent: '',
    };
    setMessages(prev => [...prev, thinkingMsg]);

    try {
      const payload = {
        message: userText,
        ...(conversationId ? { conversationId } : {}),
      };

      const res = await api.post('/chat', payload);

      // Navigate to the new conversation URL if we just created one
      if (!conversationId && res.data.conversationId) {
        navigate(`/chat/${res.data.conversationId}`, { replace: true });
      }

      const textResponses = res.data.response
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');

      const thinkingElapsed = Math.floor((Date.now() - thinkingStartedAt) / 1000);

      // 3. Resolve thinking message → show response
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? {
              ...m,
              content: textResponses || 'Processed your request and generated/updated slides.',
              isThinking: false,
              thinkingTime: thinkingElapsed,
              thinkingContent: `Processed: "${userText}"`,
            }
          : m
      ));

      if (res.data.conversationId) {
        fetchPresentation(res.data.conversationId);
      }

    } catch (error: any) {
      console.error('Chat error:', error);
      const thinkingElapsed = Math.floor((Date.now() - thinkingStartedAt) / 1000);

      // Resolve thinking message → show error
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? {
              ...m,
              content: 'Sorry, I encountered an error processing your request.',
              isThinking: false,
              thinkingTime: thinkingElapsed,
            }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const nextSlide = () => setCurrentSlideIndex(prev => Math.min(prev + 1, slides.length - 1));
  const prevSlide = () => setCurrentSlideIndex(prev => Math.max(prev - 1, 0));

  const handleDeleteAccount = async () => {
    if (!window.confirm('Are you certain you want to delete your account? This action cannot be undone.')) return;
    setIsDeleting(true);
    try {
      await api.delete('/user/me');
      logout();
    } catch (err) {
      console.error('Failed to delete account', err);
      alert('Failed to delete account');
      setIsDeleting(false);
    }
  };

  // ─────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">

      {/*
        =========================================
        LEFT PANEL: CHAT INTERFACE
        =========================================
      */}
      <div className="w-1/3 min-w-[350px] max-w-lg border-r border-border flex flex-col bg-card/50 backdrop-blur-3xl z-10 relative shadow-card">

        {/* Header */}
        <div className="h-16 border-b border-border flex items-center justify-between px-6 shrink-0 bg-muted/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30">
              <Presentation className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-foreground tracking-wide">Vibe Agent</span>
          </div>

          <div className="relative flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-zinc-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5 flex items-center gap-2"
              title="Settings"
            >
              {user?.profile_picture ? (
                <img src={user.profile_picture} alt="Profile" className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] text-primary-foreground font-bold">
                  {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                </div>
              )}
            </button>
            <button
              onClick={logout}
              className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>

            {showSettings && renderSettingsModal()}
          </div>
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-1 scroll-smooth custom-scrollbar">
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-muted-foreground mt-12">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center border border-border">
                <SparklesIcon className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="max-w-[250px] leading-relaxed">
                Hi {user?.email}! I'm Vibe. <br /> Describe the presentation you want to build.
              </p>
            </div>
          )}

          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-card border-t border-border shrink-0">
          <form onSubmit={handleSend} className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="E.g., Create a 3 slide deck about space..."
              className="w-full bg-background border border-border rounded-xl pl-4 pr-12 py-3.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all placeholder:text-muted-foreground"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-2 p-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          <p className="text-[10px] text-center text-muted-foreground mt-3">Vibe can make mistakes. Check your slides.</p>
        </div>
      </div>

      {/*
        =========================================
        RIGHT PANEL: SLIDE RENDERER CANVAS
        =========================================
      */}
      <div className="flex-1 relative bg-muted flex flex-col items-center justify-center overflow-hidden">
        {/* Subtle Background Elements */}
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, #aaa 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        {slides.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground space-y-4">
            <Presentation className="w-16 h-16 opacity-30" />
            <p className="text-xl font-medium tracking-wide">Canvas is empty</p>
          </div>
        ) : (
          <>
            {/* Main Slide Carousel */}
            <div className="relative w-full h-full p-12 lg:p-24 flex items-center justify-center">
              <div className="w-full max-w-6xl aspect-video relative">
                {slides.map((slide, idx) => (
                  <div
                    key={slide.id || idx}
                    className={cn(
                      'absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]',
                      idx === currentSlideIndex
                        ? 'opacity-100 translate-x-0 z-10'
                        : idx < currentSlideIndex
                          ? 'opacity-0 -translate-x-full z-0'
                          : 'opacity-0 translate-x-full z-0'
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
            </div>

            {/* Navigation Controls */}
            <div className="absolute bottom-12 flex items-center gap-6 bg-card/80 backdrop-blur-xl border border-border px-6 py-3 rounded-full shadow-card z-20">
              <button
                onClick={prevSlide}
                disabled={currentSlideIndex === 0}
                className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex gap-2">
                {slides.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentSlideIndex(idx)}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      idx === currentSlideIndex ? 'w-6 bg-indigo-500' : 'w-1.5 bg-white/20 hover:bg-white/40'
                    )}
                  />
                ))}
              </div>

              <button
                onClick={nextSlide}
                disabled={currentSlideIndex === slides.length - 1}
                className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  );

  function renderSettingsModal() {
    if (!user) return null;
    return (
      <div className="absolute top-12 right-0 w-80 bg-card border border-border rounded-xl shadow-card p-6 z-50 animate-in fade-in slide-in-from-top-2">
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

        <div className="space-y-3 mb-6 bg-muted/20 rounded-lg p-3 border border-border">
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Age:</span>
            <span className="text-foreground">{user.age ? user.age : 'Not specified'}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Joined:</span>
            <span className="text-foreground">{new Date(user.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-muted-foreground">Current Theme:</span>
            <span className="text-foreground capitalize">{user.settings?.theme || 'Light'}</span>
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
    );
  }
};

export default ChatPage;
