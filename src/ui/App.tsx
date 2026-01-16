import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { useIPC } from "./hooks/useIPC";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent } from "./types";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModal } from "./components/StartSessionModal";
import { PromptInput, usePromptActions } from "./components/PromptInput";
import { MessageCard } from "./components/EventCard";
import MDContent from "./render/markdown";

// 滚动到底部的阈值（px），用户滚动到距离底部这个范围内，视为"在底部"
const SCROLL_THRESHOLD = 50;

function App() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const partialMessageRef = useRef("");
  const [partialMessage, setPartialMessage] = useState("");
  const [showPartialMessage, setShowPartialMessage] = useState(false);
  // 控制是否自动滚动到底部
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  // 是否有新消息（用于显示提示按钮）
  const [hasNewMessages, setHasNewMessages] = useState(false);
  // 记录上一次消息数量，用于判断是否有新消息
  const prevMessagesLengthRef = useRef(0);

  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showStartModal = useAppStore((s) => s.showStartModal);
  const setShowStartModal = useAppStore((s) => s.setShowStartModal);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const historyRequested = useAppStore((s) => s.historyRequested);
  const markHistoryRequested = useAppStore((s) => s.markHistoryRequested);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const cwd = useAppStore((s) => s.cwd);
  const setCwd = useAppStore((s) => s.setCwd);
  const pendingStart = useAppStore((s) => s.pendingStart);

  // Helper function to extract partial message content
  const getPartialMessageContent = (eventMessage: any) => {
    try {
      const realType = eventMessage.delta.type.split("_")[0];
      return eventMessage.delta[realType];
    } catch (error) {
      console.error(error);
      return "";
    }
  };

  // Handle partial messages from stream events
  const handlePartialMessages = useCallback((partialEvent: ServerEvent) => {
    if (partialEvent.type !== "stream.message" || partialEvent.payload.message.type !== "stream_event") return;

    const message = partialEvent.payload.message as any;
    if (message.event.type === "content_block_start") {
      partialMessageRef.current = "";
      setPartialMessage(partialMessageRef.current);
      setShowPartialMessage(true);
    }

    if (message.event.type === "content_block_delta") {
      partialMessageRef.current += getPartialMessageContent(message.event) || "";
      setPartialMessage(partialMessageRef.current);
      // 仅在 shouldAutoScroll 为 true 时滚动到底部
      if (shouldAutoScroll) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        // 用户不在底部，标记有新消息
        setHasNewMessages(true);
      }
    }

    if (message.event.type === "content_block_stop") {
      setShowPartialMessage(false);
      setTimeout(() => {
        partialMessageRef.current = "";
        setPartialMessage(partialMessageRef.current);
      }, 500);
    }
  }, [shouldAutoScroll]);

  // Combined event handler
  const onEvent = useCallback((event: ServerEvent) => {
    handleServerEvent(event);
    handlePartialMessages(event);
  }, [handleServerEvent, handlePartialMessages]);

  const { connected, sendEvent } = useIPC(onEvent);
  const { handleStartFromModal } = usePromptActions(sendEvent);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSession?.messages ?? [];
  const permissionRequests = activeSession?.permissionRequests ?? [];
  const isRunning = activeSession?.status === "running";

  useEffect(() => {
    if (connected) sendEvent({ type: "session.list" });
  }, [connected, sendEvent]);

  useEffect(() => {
    if (!activeSessionId || !connected) return;
    const session = sessions[activeSessionId];
    if (session && !session.hydrated && !historyRequested.has(activeSessionId)) {
      markHistoryRequested(activeSessionId);
      sendEvent({ type: "session.history", payload: { sessionId: activeSessionId } });
    }
  }, [activeSessionId, connected, sessions, historyRequested, markHistoryRequested, sendEvent]);

  // 滚动事件处理：判断用户是否滚动到底部
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;
    
    // 仅在状态需要改变时更新
    if (isAtBottom !== shouldAutoScroll) {
      setShouldAutoScroll(isAtBottom);
      // 用户滚动到底部时，清除新消息提示
      if (isAtBottom) {
        setHasNewMessages(false);
      }
    }
  }, [shouldAutoScroll]);

  // 会话切换时重置滚动状态
  useEffect(() => {
    // 当会话切换时，重置自动滚动状态并滚动到底部
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    prevMessagesLengthRef.current = 0;
    // 延迟执行滚动，确保消息已渲染
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, 100);
  }, [activeSessionId]);

  useEffect(() => {
    // 仅在 shouldAutoScroll 为 true 时滚动到底部
    if (shouldAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > prevMessagesLengthRef.current && prevMessagesLengthRef.current > 0) {
      // 有新消息且用户不在底部
      setHasNewMessages(true);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, partialMessage, shouldAutoScroll]);

  // 点击"有新消息"按钮，滚动到底部
  const scrollToBottom = useCallback(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleNewSession = useCallback(() => {
    useAppStore.getState().setActiveSessionId(null);
    setShowStartModal(true);
  }, [setShowStartModal]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    sendEvent({ type: "session.delete", payload: { sessionId } });
  }, [sendEvent]);

  const handlePermissionResult = useCallback((toolUseId: string, result: PermissionResult) => {
    if (!activeSessionId) return;
    sendEvent({ type: "permission.response", payload: { sessionId: activeSessionId, toolUseId, result } });
    resolvePermissionRequest(activeSessionId, toolUseId);
  }, [activeSessionId, sendEvent, resolvePermissionRequest]);

  return (
    <div className="flex h-screen bg-surface">
      <Sidebar
        connected={connected}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      <main className="flex flex-1 flex-col ml-[280px] bg-surface-cream">
        <div 
          className="flex items-center justify-center h-12 border-b border-ink-900/10 bg-surface-cream select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="text-sm font-medium text-ink-700">{activeSession?.title || "Agent Cowork"}</span>
        </div>

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-8 pb-40 pt-6"
        >
          <div className="mx-auto max-w-3xl">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="text-lg font-medium text-ink-700">No messages yet</div>
                <p className="mt-2 text-sm text-muted">Start a conversation with Claude Code</p>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <MessageCard
                  key={idx}
                  message={msg}
                  isLast={idx === messages.length - 1}
                  isRunning={isRunning}
                  permissionRequest={permissionRequests[0]}
                  onPermissionResult={handlePermissionResult}
                />
              ))
            )}

            {/* Partial message display with skeleton loading */}
            <div className="partial-message">
              <MDContent text={partialMessage} />
              {showPartialMessage && (
                <div className="mt-3 flex flex-col gap-2 px-1">
                  <div className="relative h-3 w-2/12 overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                  <div className="relative h-3 w-4/12 overflow-hidden rounded-full bg-ink-900/10">
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                  </div>
                </div>
              )}
            </div>

            <div ref={messagesEndRef} />
          </div>
        </div>

        <PromptInput sendEvent={sendEvent} onSendMessage={() => {
          setShouldAutoScroll(true);
          setHasNewMessages(false);
        }} />

        {/* 有新消息提示按钮 */}
        {hasNewMessages && !shouldAutoScroll && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-28 left-1/2 ml-[140px] z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg transition-all hover:bg-accent-hover hover:scale-105 animate-bounce-subtle"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            <span>有新消息</span>
          </button>
        )}
      </main>

      {showStartModal && (
        <StartSessionModal
          cwd={cwd}
          prompt={prompt}
          pendingStart={pendingStart}
          onCwdChange={setCwd}
          onPromptChange={setPrompt}
          onStart={handleStartFromModal}
          onClose={() => setShowStartModal(false)}
        />
      )}

      {globalError && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-error/20 bg-error-light px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-sm text-error">{globalError}</span>
            <button className="text-error hover:text-error/80" onClick={() => setGlobalError(null)}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
