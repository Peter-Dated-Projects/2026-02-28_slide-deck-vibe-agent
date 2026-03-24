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

type ActivityEvent = {
  type: "start" | "stop";
  conversationId: string;
  token: string;
};
type ActivitySnapshot = Record<string, number>;
const CHANNEL_NAME = "vibe-agent-conversation-activity";
const listeners = new Set<() => void>();
const activeTokens = new Map<string, Set<string>>();
let cachedSnapshot: ActivitySnapshot = {};
const channel =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;
const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};
const buildSnapshot = (): ActivitySnapshot => {
  const snapshot: ActivitySnapshot = {};
  activeTokens.forEach((tokens, conversationId) => {
    if (tokens.size > 0) {
      snapshot[conversationId] = tokens.size;
    }
  });
  return snapshot;
};
const hasSnapshotChanged = (nextSnapshot: ActivitySnapshot) => {
  const previousKeys = Object.keys(cachedSnapshot);
  const nextKeys = Object.keys(nextSnapshot);
  if (previousKeys.length !== nextKeys.length) {
    return true;
  }
  for (const key of nextKeys) {
    if (cachedSnapshot[key] !== nextSnapshot[key]) {
      return true;
    }
  }
  return false;
};
const applyActivityEvent = (event: ActivityEvent) => {
  if (!event.conversationId || !event.token) {
    return;
  }
  const existingTokens = activeTokens.get(event.conversationId) ?? new Set<string>();
  const sizeBefore = existingTokens.size;
  if (event.type === "start") {
    existingTokens.add(event.token);
    activeTokens.set(event.conversationId, existingTokens);
  } else {
    existingTokens.delete(event.token);
    if (existingTokens.size === 0) {
      activeTokens.delete(event.conversationId);
    } else {
      activeTokens.set(event.conversationId, existingTokens);
    }
  }
  if (existingTokens.size === sizeBefore) {
    return;
  }
  const nextSnapshot = buildSnapshot();
  if (!hasSnapshotChanged(nextSnapshot)) {
    return;
  }
  cachedSnapshot = nextSnapshot;
  notifyListeners();
};
channel?.addEventListener("message", (messageEvent: MessageEvent<ActivityEvent>) => {
  applyActivityEvent(messageEvent.data);
});
export const subscribeConversationActivity = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getConversationActivitySnapshot = (): ActivitySnapshot => {
  return cachedSnapshot;
};
export const trackConversationRequest = (conversationId: string) => {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const startEvent: ActivityEvent = { type: "start", conversationId, token };
  applyActivityEvent(startEvent);
  channel?.postMessage(startEvent);
  return () => {
    const stopEvent: ActivityEvent = { type: "stop", conversationId, token };
    applyActivityEvent(stopEvent);
    channel?.postMessage(stopEvent);
  };
};
