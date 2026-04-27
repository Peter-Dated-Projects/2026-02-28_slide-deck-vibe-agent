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

import React, { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import api, { getAccessToken } from '../api';

type ElementType = 'text' | 'image' | 'shape';
type TextLevel = 'h1' | 'h2' | 'h3' | 'body';
type ShapeKind = 'rectangle' | 'circle';

interface ElementShape {
  type: ElementType;
  slide_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  content: Record<string, unknown>;
  styleOverrides?: Record<string, string>;
}

interface ThemeShape {
  id: string;
  variables: Record<string, string>;
}

type WsStatus = 'connected' | 'connecting' | 'disconnected';

const SLIDE_W = 1920;
const SLIDE_H = 1080;

const LEVEL_FONT_SIZE: Record<TextLevel, number> = {
  h1: 64,
  h2: 48,
  h3: 32,
  body: 24,
};

const SYSTEM_FONTS = [
  'Arial',
  'Arial Black',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
];

const GOOGLE_FONTS = [
  'Inter',
  'Lato',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Noto Sans',
  'Open Sans',
  'Oswald',
  'Pacifico',
  'Playfair Display',
  'Raleway',
  'Roboto',
  'Roboto Mono',
  'Roboto Slab',
  'Source Sans 3',
];

// Build one Google Fonts CSS2 URL loading 400/700 + italic variants for each family.
const GOOGLE_FONTS_URL = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS
  .map((f) => `family=${f.replace(/ /g, '+')}:ital,wght@0,400;0,700;1,400;1,700`)
  .join('&')}&display=swap`;

// Inject the <link> once per app load.
if (typeof document !== 'undefined' && !document.getElementById('crdt-google-fonts')) {
  const link = document.createElement('link');
  link.id = 'crdt-google-fonts';
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS_URL;
  document.head.appendChild(link);
}

function readAllElements(doc: Y.Doc): Map<string, ElementShape> {
  const result = new Map<string, ElementShape>();
  const yElements = doc.getMap<Y.Map<unknown>>('elements');
  for (const [id, yEl] of yElements) {
    result.set(id, {
      type: (yEl.get('type') as ElementType) ?? 'text',
      slide_id: (yEl.get('slide_id') as string) ?? '',
      x: (yEl.get('x') as number) ?? 0,
      y: (yEl.get('y') as number) ?? 0,
      w: (yEl.get('w') as number) ?? 0,
      h: (yEl.get('h') as number) ?? 0,
      z: (yEl.get('z') as number) ?? 0,
      content: (yEl.get('content') as Record<string, unknown>) ?? {},
      styleOverrides: yEl.get('styleOverrides') as Record<string, string> | undefined,
    });
  }
  return result;
}

function readThemeFromDoc(doc: Y.Doc): ThemeShape {
  const theme = doc.getMap('theme');
  const variablesMap = theme.get('variables') as Y.Map<string> | undefined;
  return {
    id: (theme.get('id') as string) ?? 'default',
    variables: variablesMap ? Object.fromEntries(variablesMap.entries()) : {},
  };
}

function getTextLevel(content: Record<string, unknown>): TextLevel {
  const v = content.level;
  return v === 'h1' || v === 'h2' || v === 'h3' || v === 'body' ? v : 'body';
}

function getShapeKind(content: Record<string, unknown>): ShapeKind {
  const v = content.shape;
  return v === 'circle' ? 'circle' : 'rectangle';
}

interface CrdtCanvasProps {
  projectId: string;
  className?: string;
}

export function CrdtCanvas({ projectId, className }: CrdtCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [scale, setScale] = useState(0);
  const [elements, setElements] = useState<Map<string, ElementShape>>(new Map());
  const [slideOrder, setSlideOrder] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeShape>({ id: 'default', variables: {} });
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadIdRef = useRef<string | null>(null);

  useEffect(() => {
    const doc = new Y.Doc({ gc: true });
    docRef.current = doc;

    const persistence = new IndexeddbPersistence(`crdt-${projectId}`, doc);

    const token = getAccessToken() ?? '';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsBase = `${wsProtocol}//${window.location.host}`;

    const provider = new WebsocketProvider(
      wsBase,
      `ws/presentation/${projectId}`,
      doc,
      { params: { token }, connect: true },
    );

    provider.on('status', ({ status }: { status: string }) => {
      setWsStatus(
        status === 'connected' ? 'connected'
          : status === 'disconnected' ? 'disconnected'
            : 'connecting',
      );
    });

    const syncDoc = () => {
      setElements(readAllElements(doc));
      setSlideOrder(doc.getArray<string>('slides').toArray());
      setTheme(readThemeFromDoc(doc));
    };

    doc.getMap('elements').observeDeep(syncDoc);
    doc.getArray('slides').observe(syncDoc);
    doc.getMap('theme').observeDeep(syncDoc);
    persistence.on('synced', syncDoc);

    return () => {
      doc.getMap('elements').unobserveDeep(syncDoc);
      doc.getArray('slides').unobserve(syncDoc);
      doc.getMap('theme').unobserveDeep(syncDoc);
      provider.destroy();
      persistence.destroy();
      doc.destroy();
      docRef.current = null;
    };
  }, [projectId]);

  const patchElementContent = (id: string, patch: Record<string, unknown>) => {
    const doc = docRef.current;
    if (!doc) return;
    doc.transact(() => {
      const yEl = doc.getMap<Y.Map<unknown>>('elements').get(id);
      if (!yEl) return;
      const cur = (yEl.get('content') as Record<string, unknown>) ?? {};
      yEl.set('content', { ...cur, ...patch });
    });
  };

  const deleteElement = (id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('elements').delete(id);
    });
    setSelectedElementId((cur) => (cur === id ? null : cur));
    setContextMenu((cur) => (cur?.id === id ? null : cur));
  };

  const editImageUrl = (id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const yEl = doc.getMap<Y.Map<unknown>>('elements').get(id);
    const cur = (yEl?.get('content') as Record<string, unknown> | undefined)?.url as string | undefined;
    const next = window.prompt('Image URL', cur ?? '');
    if (next === null) return;
    patchElementContent(id, { url: next });
  };

  const editShapeFill = (id: string) => {
    const doc = docRef.current;
    if (!doc) return;
    const yEl = doc.getMap<Y.Map<unknown>>('elements').get(id);
    const cur = (yEl?.get('content') as Record<string, unknown> | undefined)?.fill as string | undefined;
    const next = window.prompt('Shape fill color (hex, rgb, css color)', cur ?? '#e2e8f0');
    if (next === null) return;
    patchElementContent(id, { fill: next });
  };

  const triggerImageUpload = (id: string) => {
    pendingUploadIdRef.current = id;
    fileInputRef.current?.click();
  };

  const onUploadFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetId = pendingUploadIdRef.current;
    pendingUploadIdRef.current = null;
    e.target.value = '';
    if (!file || !targetId) return;
    try {
      const res = await api.post<{ url: string }>('/uploads', file, {
        headers: { 'Content-Type': file.type },
      });
      patchElementContent(targetId, { url: res.data.url });
    } catch (err) {
      console.error('upload failed', err);
      window.alert('Image upload failed');
    }
  };

  const moveElementInStack = (id: string, dir: -1 | 1) => {
    const doc = docRef.current;
    if (!doc) return;
    doc.transact(() => {
      const yElements = doc.getMap<Y.Map<unknown>>('elements');
      const target = yElements.get(id);
      if (!target) return;
      const slideId = target.get('slide_id') as string;
      const peers: { id: string; yEl: Y.Map<unknown>; z: number }[] = [];
      for (const [pid, yEl] of yElements) {
        if ((yEl.get('slide_id') as string) === slideId) {
          peers.push({ id: pid, yEl, z: (yEl.get('z') as number) ?? 0 });
        }
      }
      // Sort by current z (stable iteration order breaks ties for unset z).
      peers.sort((a, b) => a.z - b.z);
      // Normalize so every peer has a unique sequential z, preserving display order.
      peers.forEach((p, i) => {
        if (p.z !== i) p.yEl.set('z', i);
        p.z = i;
      });
      const idx = peers.findIndex((p) => p.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= peers.length) return;
      peers[idx].yEl.set('z', peers[swap].z);
      peers[swap].yEl.set('z', peers[idx].z);
    });
  };

  // Scale factor: fit 1920×1080 into the container
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const compute = () =>
      setScale(Math.min(el.clientWidth / SLIDE_W, el.clientHeight / SLIDE_H));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dismiss the right-click menu on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const onDocClick = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Horizontal-scroll slide navigation. Non-passive so we can preventDefault.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 2) {
        e.preventDefault();
        const dir = e.deltaX > 0 ? 1 : -1;
        setCurrentSlideIndex((i) => {
          const max = Math.max(0, slideOrder.length - 1);
          return Math.min(max, Math.max(0, i + dir));
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [slideOrder.length]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      setCurrentSlideIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'ArrowRight') {
      setCurrentSlideIndex((i) => Math.min(Math.max(0, slideOrder.length - 1), i + 1));
    }
  };

  const currentSlideId = slideOrder[currentSlideIndex];
  const slideElements = currentSlideId
    ? [...elements.entries()]
      .filter(([, el]) => el.slide_id === currentSlideId)
      .sort(([, a], [, b]) => (a.z ?? 0) - (b.z ?? 0))
    : [];
  const selectedStackIndex = selectedElementId
    ? slideElements.findIndex(([id]) => id === selectedElementId)
    : -1;
  const canMoveDown = selectedStackIndex > 0;
  const canMoveUp = selectedStackIndex >= 0 && selectedStackIndex < slideElements.length - 1;

  const bgColor = theme.variables['--vibe-bg'] ?? '#ffffff';
  const mh = (SLIDE_W * (scale - 1)) / 2;
  const mv = (SLIDE_H * (scale - 1)) / 2;

  const selectedElement =
    selectedElementId && currentSlideId
      ? elements.get(selectedElementId) ?? null
      : null;
  const selectedIsOnCurrentSlide =
    selectedElement?.slide_id === currentSlideId ? selectedElement : null;

  const renderInfoBar = () => {
    const el = selectedIsOnCurrentSlide;
    if (!el || !selectedElementId) {
      const total = slideOrder.length;
      const label = total === 0
        ? 'No slides'
        : `Slide ${currentSlideIndex + 1} of ${total} — click an element to inspect`;
      return <span className="text-muted-foreground">{label}</span>;
    }

    const reorderControls = (
      <span className="ml-auto inline-flex items-center gap-1">
        <button
          type="button"
          disabled={!canMoveDown}
          onClick={() => moveElementInStack(selectedElementId, -1)}
          title="Send backward"
          className="px-1.5 h-6 rounded border border-border text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↓
        </button>
        <button
          type="button"
          disabled={!canMoveUp}
          onClick={() => moveElementInStack(selectedElementId, 1)}
          title="Bring forward"
          className="px-1.5 h-6 rounded border border-border text-foreground hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ↑
        </button>
      </span>
    );

    const selectClass =
      'h-6 text-[11px] px-1.5 rounded border border-border bg-background text-foreground';

    if (el.type === 'image') {
      return (
        <>
          <span className="font-medium text-foreground">Image</span>
          {reorderControls}
        </>
      );
    }

    if (el.type === 'shape') {
      const kind = getShapeKind(el.content);
      return (
        <>
          <span className="font-medium text-foreground">Shape</span>
          <select
            value={kind}
            onChange={(e) => patchElementContent(selectedElementId, { shape: e.target.value })}
            className={selectClass}
          >
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
          </select>
          {reorderControls}
        </>
      );
    }

    // text
    const level = getTextLevel(el.content);
    const flag = (key: string) => Boolean(el.content[key]);
    const toggle = (key: string) =>
      patchElementContent(selectedElementId, { [key]: !flag(key) });
    const badge = (label: string, key: string, fontStyle?: React.CSSProperties) => {
      const on = flag(key);
      return (
        <button
          type="button"
          onClick={() => toggle(key)}
          title={`Toggle ${key}`}
          style={fontStyle}
          className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold border transition-colors ${
            on
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent text-muted-foreground border-border hover:bg-muted/50'
          }`}
        >
          {label}
        </button>
      );
    };
    return (
      <>
        <select
          value={level}
          onChange={(e) => patchElementContent(selectedElementId, { level: e.target.value })}
          className={selectClass}
          title="Text type"
        >
          <option value="body">Body</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>
        <select
          value={(el.content.fontFamily as string) ?? ''}
          onChange={(e) =>
            patchElementContent(selectedElementId, {
              fontFamily: e.target.value || undefined,
            })
          }
          className={selectClass}
          title="Font"
        >
          <option value="">Default</option>
          <optgroup label="System">
            {SYSTEM_FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </optgroup>
          <optgroup label="Google Fonts">
            {GOOGLE_FONTS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </optgroup>
        </select>
        <span className="ml-2 inline-flex items-center gap-1">
          {badge('B', 'bold', { fontWeight: 700 })}
          {badge('I', 'italic', { fontStyle: 'italic' })}
          {badge('U', 'underline', { textDecoration: 'underline' })}
          {badge('S', 'strikethrough', { textDecoration: 'line-through' })}
        </span>
        {reorderControls}
      </>
    );
  };

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Click on background → clear selection. Element clicks stopPropagation.
        if (e.target === e.currentTarget) setSelectedElementId(null);
      }}
      className={`w-full h-full flex items-center justify-center overflow-hidden relative outline-none${className ? ` ${className}` : ''}`}
    >
      {/* Force AI-authored HTML inside text elements to inherit our wrapper's
          font-size / weight / style / decoration, so changing the level dropdown
          actually re-styles browser-default tags like <h1>, <h2>, <p>. */}
      <style>{`
        .crdt-text-el, .crdt-text-el * {
          font-size: inherit;
          font-weight: inherit;
          font-style: inherit;
          text-decoration: inherit;
          line-height: inherit;
          font-family: inherit;
          margin: 0;
          padding: 0;
        }
      `}</style>

      {/* Element info bar — top of canvas */}
      <div
        className="absolute top-0 left-0 right-0 z-20 h-8 px-3 flex items-center gap-2 text-[12px] bg-card/80 border-b border-border backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {renderInfoBar()}
      </div>

      {/* Connection status badge */}
      <div
        className={`absolute top-10 right-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
          wsStatus === 'connected'
            ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
            : wsStatus === 'disconnected'
              ? 'bg-red-500/15 text-red-700 border-red-500/30'
              : 'bg-amber-500/15 text-amber-700 border-amber-500/30'
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            wsStatus === 'connected'
              ? 'bg-emerald-500'
              : wsStatus === 'disconnected'
                ? 'bg-red-500'
                : 'bg-amber-500 animate-pulse'
          }`}
        />
        {wsStatus}
      </div>

      {/* Slide dot navigation */}
      {slideOrder.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          {slideOrder.map((_, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentSlideIndex(i);
              }}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === currentSlideIndex
                  ? 'bg-primary'
                  : 'bg-muted-foreground/40 hover:bg-muted-foreground/70'
              }`}
            />
          ))}
        </div>
      )}

      {/* 1920×1080 canvas, CSS-scaled to fill the wrapper */}
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedElementId(null);
        }}
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'relative',
          backgroundColor: bgColor,
          borderRadius: 5,
          flexShrink: 0,
          marginLeft: mh,
          marginRight: mh,
          marginTop: mv,
          marginBottom: mv,
          visibility: scale === 0 ? 'hidden' : 'visible',
          ...(theme.variables as React.CSSProperties),
        }}
      >
        {slideOrder.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-2xl text-gray-300 select-none">
            No slides yet
          </div>
        )}
        {slideOrder.length > 0 && slideElements.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-2xl text-gray-300 select-none">
            Slide {currentSlideIndex + 1}
          </div>
        )}
        {slideElements.map(([id, el]) => {
          const isSelected = id === selectedElementId;
          return (
            <div
              key={id}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedElementId(id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedElementId(id);
                setContextMenu({ id, x: e.clientX, y: e.clientY });
              }}
              style={{
                position: 'absolute',
                left: el.x,
                top: el.y,
                width: el.w,
                height: el.h,
                overflow: 'hidden',
                cursor: 'pointer',
                outline: isSelected ? '2px solid #3b82f6' : 'none',
                outlineOffset: 2,
                ...el.styleOverrides,
              }}
            >
              {el.type === 'text' && (() => {
                const level = getTextLevel(el.content);
                const decorations: string[] = [];
                if (el.content.underline) decorations.push('underline');
                if (el.content.strikethrough) decorations.push('line-through');
                const family = el.content.fontFamily as string | undefined;
                return (
                  <div
                    className="crdt-text-el"
                    style={{
                      width: '100%',
                      height: '100%',
                      fontSize: LEVEL_FONT_SIZE[level],
                      fontWeight: el.content.bold ? 700 : 400,
                      fontStyle: el.content.italic ? 'italic' : 'normal',
                      textDecoration: decorations.length ? decorations.join(' ') : 'none',
                      fontFamily: family ? `"${family}", sans-serif` : undefined,
                    }}
                    // Content is authored by the AI system, not raw user input
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: (el.content.html as string) ?? (el.content.text as string) ?? '',
                    }}
                  />
                );
              })()}
              {el.type === 'image' && (
                <img
                  src={(el.content.url as string) ?? ''}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
              {el.type === 'shape' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor:
                      (el.content.fill as string) ??
                      (el.styleOverrides?.background) ??
                      '#e2e8f0',
                    borderRadius:
                      getShapeKind(el.content) === 'circle'
                        ? '50%'
                        : (el.content.borderRadius as string | undefined),
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={onUploadFileSelected}
      />

      {contextMenu && (() => {
        const el = elements.get(contextMenu.id);
        if (!el) return null;
        const id = contextMenu.id;
        const itemClass =
          'w-full text-left px-3 py-1.5 text-[12px] text-foreground hover:bg-muted/60';
        const dangerClass =
          'w-full text-left px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-500/10';
        return (
          <div
            className="fixed z-50 min-w-[160px] rounded-md border border-border bg-card shadow-lg py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {el.type === 'image' && (
              <>
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => { editImageUrl(id); setContextMenu(null); }}
                >
                  Edit URL
                </button>
                <button
                  type="button"
                  className={itemClass}
                  onClick={() => { triggerImageUpload(id); setContextMenu(null); }}
                >
                  Upload image
                </button>
              </>
            )}
            {el.type === 'shape' && (
              <button
                type="button"
                className={itemClass}
                onClick={() => { editShapeFill(id); setContextMenu(null); }}
              >
                Edit shape
              </button>
            )}
            <button
              type="button"
              className={dangerClass}
              onClick={() => { deleteElement(id); setContextMenu(null); }}
            >
              Delete
            </button>
          </div>
        );
      })()}
    </div>
  );
}
