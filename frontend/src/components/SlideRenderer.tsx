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

import React, { useRef, useEffect, useState } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
// Utility for Tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
// Internal slide resolution (all content is authored at 1920×1080)
const SLIDE_W = 1920;
const SLIDE_H = 1080;
export interface SlideData {
  id: string;
  title: string;
  content: string;
  layoutType: "title" | "bullet_points" | "image_right" | "quote" | "big_number";
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
    "--vibe-primary": theme?.colors?.primary || "#3b82f6",
    "--vibe-secondary": theme?.colors?.secondary || "#8b5cf6",
    "--vibe-bg": theme?.colors?.background || "#ffffff",
    "--vibe-text": theme?.colors?.text || "#1f2937",
    fontFamily: theme?.fontFamily || "sans-serif",
  } as React.CSSProperties;
  // Default container styling
  const containerClasses = cn(
    "w-full h-full flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 snap-center",
    isActive ? "opacity-100 scale-100" : "opacity-40 scale-95",
  );
  // If agent generated explicit RAW HTML, render it scaled to fill the container
  // maintaining a fixed 1920×1080 internal resolution.
  if (slide.rawHtml) {
    return (
      <ScaledSlide
        html={slide.rawHtml}
        styleObj={{ ...styleObj, backgroundColor: "var(--vibe-bg)", color: "var(--vibe-text)" }}
        containerClasses={containerClasses}
      />
    );
  }
  // Fallback schema-driven layout renderer
  switch (slide.layoutType) {
    case "title":
      return (
        <div
          className={containerClasses}
          style={{ ...styleObj, backgroundColor: "var(--vibe-bg)" }}
        >
          <div className="text-center space-y-8 max-w-4xl mx-auto p-12">
            <h1 className="text-6xl md:text-8xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[var(--vibe-primary)] to-[var(--vibe-secondary)]">
              {slide.title}
            </h1>
            {slide.content && (
              <p className="text-2xl md:text-3xl font-medium text-[var(--vibe-text)] opacity-80">
                {slide.content}
              </p>
            )}
          </div>
        </div>
      );
    case "bullet_points":
    default:
      return (
        <div
          className={containerClasses}
          style={{ ...styleObj, backgroundColor: "var(--vibe-bg)" }}
        >
          <div className="w-full max-w-5xl mx-auto space-y-12 p-12">
            <h2 className="text-5xl font-bold text-[var(--vibe-primary)]">{slide.title}</h2>
            <div className="text-xl md:text-2xl text-[var(--vibe-text)] leading-relaxed space-y-4 whitespace-pre-line">
              {slide.content.split("\n").map((line, i) => (
                <p key={i} className="flex gap-4 items-start">
                  {line.trim().startsWith("-") || line.trim().startsWith("*") ? (
                    <>
                      <span className="text-[var(--vibe-secondary)] font-bold mt-1">•</span>
                      <span>{line.replace(/^[-*]\s*/, "")}</span>
                    </>
                  ) : (
                    line
                  )}
                </p>
              ))}
            </div>
          </div>
        </div>
      );
  }
};
// ─────────────────────────────────────────────────────
// ScaledSlide: renders rawHtml in a sandboxed iframe at
// 1920×1080, CSS-scaled to fill its container.
// iframes give full CSS/JS isolation — the slide's styles
// never bleed into or out of the React app.
// ─────────────────────────────────────────────────────
interface ScaledSlideProps {
  html: string;
  styleObj: React.CSSProperties;
  containerClasses: string;
}
const ScaledSlide: React.FC<ScaledSlideProps> = ({ html, containerClasses }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0); // 0 = hidden until first measurement
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () => {
      setScale(Math.min(el.clientWidth / SLIDE_W, el.clientHeight / SLIDE_H));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // CSS transform doesn't change layout — the element still occupies its
  // pre-scale dimensions. Negative margins compensate so the layout
  // footprint matches the visual (scaled) size, allowing flex centering to work.
  const mh = (SLIDE_W * (scale - 1)) / 2; // negative when scale < 1
  const mv = (SLIDE_H * (scale - 1)) / 2;
  return (
    <div ref={wrapperRef} className={containerClasses} style={{ borderRadius: 5 }}>
      <iframe
        srcDoc={html}
        // allow-scripts lets the slide HTML run its own JS; no allow-same-origin
        // keeps it sandboxed from the parent page's cookies/localStorage.
        sandbox="allow-scripts"
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          border: "none",
          borderRadius: 5,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          marginLeft: mh,
          marginRight: mh,
          marginTop: mv,
          marginBottom: mv,
          flexShrink: 0,
          display: "block",
          visibility: scale === 0 ? "hidden" : "visible",
        }}
      />
    </div>
  );
};
