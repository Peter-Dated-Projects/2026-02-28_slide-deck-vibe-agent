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
import { getAccessToken } from '../api';

type ElementType = 'text' | 'image' | 'shape';

interface ElementShape {
  type: ElementType;
  slide_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
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

interface CrdtCanvasProps {
  projectId: string;
  className?: string;
}

export function CrdtCanvas({ projectId, className }: CrdtCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [elements, setElements] = useState<Map<string, ElementShape>>(new Map());
  const [slideOrder, setSlideOrder] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeShape>({ id: 'default', variables: {} });
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [wsStatus, setWsStatus] = useState<WsStatus>('connecting');

  useEffect(() => {
    const doc = new Y.Doc({ gc: true });

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
    };
  }, [projectId]);

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

  const currentSlideId = slideOrder[currentSlideIndex];
  const slideElements = currentSlideId
    ? [...elements.entries()].filter(([, el]) => el.slide_id === currentSlideId)
    : [];

  const bgColor = theme.variables['--vibe-bg'] ?? '#ffffff';
  const mh = (SLIDE_W * (scale - 1)) / 2;
  const mv = (SLIDE_H * (scale - 1)) / 2;

  return (
    <div
      ref={wrapperRef}
      className={`w-full h-full flex items-center justify-center overflow-hidden relative${className ? ` ${className}` : ''}`}
    >
      {/* Connection status badge */}
      <div
        className={`absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
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
              onClick={() => setCurrentSlideIndex(i)}
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
        {slideElements.map(([id, el]) => (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: el.x,
              top: el.y,
              width: el.w,
              height: el.h,
              overflow: 'hidden',
              ...el.styleOverrides,
            }}
          >
            {el.type === 'text' && (
              <div
                style={{ width: '100%', height: '100%' }}
                // Content is authored by the AI system, not raw user input
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{
                  __html: (el.content.html as string) ?? (el.content.text as string) ?? '',
                }}
              />
            )}
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
                  borderRadius: (el.content.borderRadius as string | undefined),
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
