import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api';
import { SlideRenderer, type SlideData } from '../components/SlideRenderer';
import { Send, Loader2, LogOut, ChevronLeft, ChevronRight, Presentation, Settings, Trash2, CreditCard, X } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  const [messages, setMessages] = useState<Message[]>([]);
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
          // Typically here we would fetch the raw MinIO strings
          // For MVP, if theme_data exists or if there's raw HTML stored we map it.
          // Due to cross-origin limitations, we might need the backend to proxy the MinIO file contents.
          
          // Let's assume the backend /presentation/ returns the slides meta
          // We will map them. For a true implementation we would fetch the raw HTML from MinIO.
          const formattedSlides: SlideData[] = res.data.slides.map((s: any, i: number) => ({
             id: s.minio_object_key || `slide-${i}`,
             title: `Slide ${i + 1}`,
             content: 'Loading slide content...',
             layoutType: 'title', // Fallback
             minio_object_key: s.minio_object_key,
             theme_data: s.theme_data
          }));
          
          setSlides(formattedSlides);

          // Eager load MinIO contents
          formattedSlides.forEach(async (slide, idx) => {
              if (slide.minio_object_key) {
                   try {
                       // We need a backend endpoint for this in reality, or presigned URLs.
                       // For the sake of this demo UI, let's assume we have a proxy on the backend 
                       // `GET /api/storage?key=...` or similar. Let's mock it for the MVP UI view
                       const slideRes = await api.get(`/storage?key=${slide.minio_object_key}`);
                       setSlides(prev => {
                           const next = [...prev];
                           next[idx] = { ...next[idx], rawHtml: slideRes.data };
                           return next;
                       });
                   } catch (e) { console.error('Failed fetching slide html');}
              }
          });
      }
    } catch (error) {
      console.error('Failed to fetch presentation:', error);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const payload = {
          message: userMessage,
          ...(conversationId ? { conversationId } : {})
      };

      const res = await api.post('/chat', payload);
      
      // Navigate to the new conversation URL if we just created it
      if (!conversationId && res.data.conversationId) {
          navigate(`/chat/${res.data.conversationId}`, { replace: true });
      }

      // Anthropic returns an array of content blocks, we filter for text responses 
      // as tools are handled by the backend Agent loop.
      const textResponses = res.data.response
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

      setMessages(prev => [...prev, { role: 'assistant', content: textResponses || 'Processed your request and generated/updated slides.' }]);

      // Refetch presentation to see new slides
      if (res.data.conversationId) {
          fetchPresentation(res.data.conversationId);
      }

    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error processing your request.' }]);
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

  return (
    <div className="h-screen w-screen flex bg-zinc-950 text-slate-200 overflow-hidden font-sans">
      
      {/* 
        =========================================
        LEFT PANEL: CHAT INTERFACE
        =========================================
      */}
      <div className="w-1/3 min-w-[350px] max-w-lg border-r border-white/10 flex flex-col bg-zinc-900/50 backdrop-blur-3xl z-10 relative shadow-2xl">
        
        {/* Header */}
        <div className="h-16 border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-white/5">
            <div className="flex items-center gap-3">
               <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-400/30">
                  <Presentation className="w-4 h-4 text-indigo-400" />
               </div>
               <span className="font-semibold text-white tracking-wide">Vibe Agent</span>
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
                    <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">
                        {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                    </div>
                  )}
                </button>
                <button 
                    onClick={logout}
                    className="text-zinc-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
                    title="Logout"
                >
                    <LogOut className="w-4 h-4" />
                </button>

                {showSettings && renderSettingsModal()}
            </div>
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth custom-scrollbar">
            {messages.length === 0 && !isLoading && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-zinc-500 mt-12">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                        <SparklesIcon className="w-8 h-8 text-zinc-400" />
                    </div>
                    <p className="max-w-[250px] leading-relaxed">
                        Hi {user?.email}! I'm Vibe. <br/> Describe the presentation you want to build.
                    </p>
                </div>
            )}
            
            {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={cn(
                        "max-w-[85%] rounded-2xl px-5 py-3.5 mt-2",
                        m.role === 'user' 
                            ? "bg-indigo-500 text-white rounded-tr-sm shadow-indigo-500/20 shadow-lg" 
                            : "bg-white/10 text-slate-200 rounded-tl-sm border border-white/5"
                    )}>
                        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    </div>
                </div>
            ))}
            
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-white/5 rounded-2xl rounded-tl-sm px-5 py-4 border border-white/5 flex items-center gap-3">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        <span className="text-sm text-zinc-400 animate-pulse">Designing slides...</span>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-zinc-900 border-t border-white/5 shrink-0">
            <form onSubmit={handleSend} className="relative flex items-center">
                <input 
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="E.g., Create a 3 slide deck about space..."
                    className="w-full bg-black/50 border border-white/10 rounded-xl pl-4 pr-12 py-3.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-zinc-600"
                    disabled={isLoading}
                />
                <button 
                    type="submit" 
                    disabled={isLoading || !input.trim()}
                    className="absolute right-2 p-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
            <p className="text-[10px] text-center text-zinc-600 mt-3">Vibe can make mistakes. Check your slides.</p>
        </div>
      </div>

      {/* 
        =========================================
        RIGHT PANEL: SLIDE RENDERER CANVAS
        =========================================
      */}
      <div className="flex-1 relative bg-black flex flex-col items-center justify-center overflow-hidden">
         {/* Subtle Background Elements */}
         <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at center, #333 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
         
         {slides.length === 0 ? (
             <div className="flex flex-col items-center justify-center text-zinc-700 space-y-4">
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
                                    "absolute inset-0 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]",
                                    idx === currentSlideIndex 
                                        ? "opacity-100 translate-x-0 z-10" 
                                        : idx < currentSlideIndex 
                                            ? "opacity-0 -translate-x-full z-0" 
                                            : "opacity-0 translate-x-full z-0"
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
                 <div className="absolute bottom-12 flex items-center gap-6 bg-zinc-900/80 backdrop-blur-xl border border-white/10 px-6 py-3 rounded-full shadow-2xl z-20">
                     <button 
                        onClick={prevSlide} 
                        disabled={currentSlideIndex === 0}
                        className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                     >
                         <ChevronLeft className="w-5 h-5" />
                     </button>
                     
                     <div className="flex gap-2">
                        {slides.map((_, idx) => (
                             <button
                                 key={idx}
                                 onClick={() => setCurrentSlideIndex(idx)}
                                 className={cn(
                                     "h-1.5 rounded-full transition-all duration-300",
                                     idx === currentSlideIndex ? "w-6 bg-indigo-500" : "w-1.5 bg-white/20 hover:bg-white/40"
                                 )}
                             />
                        ))}
                     </div>

                     <button 
                        onClick={nextSlide} 
                        disabled={currentSlideIndex === slides.length - 1}
                        className="p-2 text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
      <div className="absolute top-12 right-0 w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl p-6 z-50 animate-in fade-in slide-in-from-top-2">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-white">Profile Settings</h3>
          <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex items-center gap-4 mb-6">
          {user.profile_picture ? (
            <img src={user.profile_picture} alt="Profile" className="w-12 h-12 rounded-full border border-white/10" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-indigo-500 flex items-center justify-center text-lg text-white font-bold shadow-lg shadow-indigo-500/20">
              {user.name?.charAt(0) || user.email?.charAt(0)}
            </div>
          )}
          <div>
            <div className="text-[15px] font-medium text-white">{user.name}</div>
            <div className="text-[13px] text-zinc-400">{user.email}</div>
          </div>
        </div>

        <div className="space-y-3 mb-6 bg-white/5 rounded-lg p-3 border border-white/5">
            <div className="flex justify-between text-[13px]">
              <span className="text-zinc-400">Age:</span>
              <span className="text-zinc-200">{user.age ? user.age : 'Not specified'}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-zinc-400">Joined:</span>
              <span className="text-zinc-200">{new Date(user.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-zinc-400">Current Theme:</span>
              <span className="text-zinc-200 capitalize">{user.settings?.theme || 'Light'}</span>
            </div>
        </div>

        <div className="space-y-2">
          <button className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white py-2.5 rounded-lg transition-colors text-sm font-medium border border-white/5">
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

// Utilities
function cn(...classes: (string | undefined | null | false)[]) {
    return classes.filter(Boolean).join(' ');
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

export default ChatPage;
