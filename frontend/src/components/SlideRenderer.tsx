import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for Tailwind class merging
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export interface SlideData {
    id: string;
    title: string;
    content: string;
    layoutType: 'title' | 'bullet_points' | 'image_right' | 'quote' | 'big_number';
    minio_object_key?: string; // Optional if loading external component code directly
    theme_data?: any;
    // Generated raw HTML component if Vibe Agent bypassed schema and sent literal TSX/HTML
    rawHtml?: string; 
}

interface SlideRendererProps {
    slide: SlideData;
    theme?: any;
    isActive?: boolean;
}

export const SlideRenderer: React.FC<SlideRendererProps> = ({ slide, theme, isActive = true }) => {
    
    // Inject dynamic theme styles using CSS variables onto a wrapping ref
    const styleObj = {
        '--vibe-primary': theme?.colors?.primary || '#3b82f6',
        '--vibe-secondary': theme?.colors?.secondary || '#8b5cf6',
        '--vibe-bg': theme?.colors?.background || '#ffffff',
        '--vibe-text': theme?.colors?.text || '#1f2937',
        fontFamily: theme?.fontFamily || 'sans-serif'
    } as React.CSSProperties;

    // Default container styling blending dynamic theme colors with Tailwind classes
    const containerClasses = cn(
        "w-full h-full flex items-center justify-center p-12 lg:p-24 transition-all duration-500 rounded-3xl overflow-hidden shadow-2xl shrink-0 snap-center",
        isActive ? "opacity-100 scale-100" : "opacity-40 scale-95"
    );

    // If agent generated explicit RAW HTML/Component code via the `generate_slide_component` tool
    // In a real isolated environment, we'd use an iframe or a secure dynamic renderer like `react-live`
    // For MVP sake, dangerouslySetInnerHTML or if it's specific formats, parse it.
    if (slide.rawHtml) {
         return (
             <div 
                className={containerClasses} 
                style={{...styleObj, backgroundColor: 'var(--vibe-bg)', color: 'var(--vibe-text)'}}
                dangerouslySetInnerHTML={{ __html: slide.rawHtml }} 
             />
         );
    }

    // Fallback schema-driven layout renderer
    switch (slide.layoutType) {
        case 'title':
            return (
                <div className={containerClasses} style={{...styleObj, backgroundColor: 'var(--vibe-bg)'}}>
                     <div className="text-center space-y-8 max-w-4xl mx-auto">
                         <h1 className="text-6xl md:text-8xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[var(--vibe-primary)] to-[var(--vibe-secondary)]">
                             {slide.title}
                         </h1>
                         {slide.content && <p className="text-2xl md:text-3xl font-medium text-[var(--vibe-text)] opacity-80">{slide.content}</p>}
                     </div>
                </div>
            );
        case 'bullet_points':
        default:
             return (
                 <div className={containerClasses} style={{...styleObj, backgroundColor: 'var(--vibe-bg)'}}>
                    <div className="w-full max-w-5xl mx-auto space-y-12">
                         <h2 className="text-5xl font-bold text-[var(--vibe-primary)]">{slide.title}</h2>
                         <div className="text-xl md:text-2xl text-[var(--vibe-text)] leading-relaxed space-y-4 whitespace-pre-line prose prose-lg prose-[var(--vibe-text)]">
                             {/* Very basic splitting for bullets if it's a string, typically the agent would send an array instead */}
                             {slide.content.split('\n').map((line, i) => (
                                 <p key={i} className="flex gap-4 items-start">
                                     {line.trim().startsWith('-') || line.trim().startsWith('*') ? (
                                        <>
                                            <span className="text-[var(--vibe-secondary)] font-bold mt-1">•</span>
                                            <span>{line.replace(/^[-*]\s*/, '')}</span>
                                        </>
                                     ) : line}
                                 </p>
                             ))}
                         </div>
                    </div>
                </div>
             );
    }
};
