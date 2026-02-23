"use client";

import { useParams, useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { trpc } from "@/lib/trpc";
import { StatusBadge } from "@/components/StatusBadge";
import { useStatusStream } from "@/hooks/useStatusStream";
import DeploymentTamboProvider from "@/components/DeploymentTamboProvider";
import { ComponentCatalogProvider } from "@/components/ComponentCatalogProvider";
import TamboToggle from "@/components/DirectChatToggle";
import { useDirectChat, type DirectChatMessage } from "@/hooks/useDirectChat";
import EditableCanvas from "@/components/canvas/EditableCanvas";
import {
  useTambo,
  useTamboThreadInput,
  ComponentRenderer,
  type TamboThreadMessage,
  type Content,
} from "@tambo-ai/react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Loader2,
  SendHorizontal,
  Bot,
  User,
  Wrench,
} from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import ProfileDropdown from "@/components/ProfileDropdown";
import MarkdownMessage from "@/components/MarkdownMessage";

export default function DeploymentChatPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth0();

  const deploymentQuery = trpc.deployment.getById.useQuery(
    { id },
    { enabled: isAuthenticated && !authLoading }
  );

  const { getStatus: getLiveStatus } = useStatusStream({
    enabled: isAuthenticated && !authLoading,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    router.replace("/login");
    return null;
  }

  if (deploymentQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading deployment...</p>
        </div>
      </div>
    );
  }

  if (!deploymentQuery.data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Deployment not found</p>
      </div>
    );
  }

  const deployment = deploymentQuery.data;
  const liveStatus = getLiveStatus(deployment.id)?.status || deployment.status;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/dashboard")}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{deployment.name}</span>
              <StatusBadge status={liveStatus} />
            </div>
          </div>
          <ProfileDropdown />
        </div>
      </header>

      <ComponentCatalogProvider deploymentId={id}>
        <DeploymentTamboProvider
          deploymentId={id}
          deploymentName={deployment.name}
        >
          <ChatInterface deploymentId={id} deployment={deployment} />
        </DeploymentTamboProvider>
      </ComponentCatalogProvider>
    </div>
  );
}

// ─── Chat Interface — Tambo ON by default, toggle OFF for direct bot ──────────

function ChatInterface({
  deploymentId,
  deployment,
}: {
  deploymentId: string;
  deployment: any;
}) {
  const [tamboEnabled, setTamboEnabled] = useState(true);

  return tamboEnabled ? (
    <TamboChat
      deploymentId={deploymentId}
      tamboEnabled={tamboEnabled}
      onTamboToggle={setTamboEnabled}
    />
  ) : (
    <DirectChat
      deploymentId={deploymentId}
      deploymentName={deployment.name}
      tamboEnabled={tamboEnabled}
      onTamboToggle={setTamboEnabled}
    />
  );
}

// ─── Tambo ON: User ←→ Tambo ←→ Bot ──────────────────────────────────────────

function TamboChat({
  deploymentId,
  tamboEnabled,
  onTamboToggle,
}: {
  deploymentId: string;
  tamboEnabled: boolean;
  onTamboToggle: (v: boolean) => void;
}) {
  const { messages, isStreaming, isWaiting, currentThreadId } = useTambo();
  const { value, setValue, submit, isPending } = useTamboThreadInput();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isBusy = isStreaming || isWaiting || isPending;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isBusy) return;
    setSubmitError(null);
    try {
      await submit();
    } catch (err: any) {
      setSubmitError(err.message || "Failed to send message");
    }
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {messages.map((msg) => (
            <TamboMessageBubble
              key={msg.id}
              message={msg}
              threadId={currentThreadId}
              deploymentId={deploymentId}
            />
          ))}
          {(isStreaming || isWaiting) && messages.length > 0 && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{isWaiting ? "Thinking..." : "Streaming..."}</span>
            </div>
          )}
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400">
              {submitError}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background/95 backdrop-blur-sm sticky bottom-0">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-3 flex gap-2 items-center"
        >
          <TamboToggle
            enabled={tamboEnabled}
            onChange={onTamboToggle}
            disabled={isBusy}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            disabled={isBusy}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!value.trim() || isBusy}
            className="h-10 w-10 p-0"
          >
            {isBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SendHorizontal className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </>
  );
}

// ─── Tambo OFF: User ←→ Bot (direct streaming) ───────────────────────────────

function DirectChat({
  deploymentId,
  deploymentName,
  tamboEnabled,
  onTamboToggle,
}: {
  deploymentId: string;
  deploymentName: string;
  tamboEnabled: boolean;
  onTamboToggle: (v: boolean) => void;
}) {
  const { messages, isStreaming, sendMessage } = useDirectChat(deploymentId);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const greeting: DirectChatMessage = {
    id: "greeting",
    role: "assistant",
    content: `Hi! I'm ${deploymentName}. Tambo is off — you're talking directly to me.`,
  };
  const allMessages = [greeting, ...messages];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length, messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const text = input;
    setInput("");
    await sendMessage(text);
  };

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          {allMessages.map((msg) => (
            <DirectMessageBubble
              key={msg.id}
              message={msg}
              deploymentId={deploymentId}
              sendMessage={sendMessage}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border bg-background/95 backdrop-blur-sm sticky bottom-0">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-3 flex gap-2 items-center"
        >
          <TamboToggle
            enabled={tamboEnabled}
            onChange={onTamboToggle}
            disabled={isStreaming}
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            disabled={isStreaming}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || isStreaming}
            className="h-10 w-10 p-0"
          >
            {isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SendHorizontal className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </>
  );
}

// ─── Message Bubbles ──────────────────────────────────────────────────────────

function TamboMessageBubble({
  message,
  threadId,
  deploymentId,
}: {
  message: TamboThreadMessage;
  threadId: string;
  deploymentId: string;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary/10" : "bg-secondary"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      <div className={`flex-1 ${isUser ? "text-right" : ""} space-y-3`}>
        {message.content.map((block, i) => (
          <ContentBlock
            key={`${message.id}-${i}`}
            block={block}
            isUser={isUser}
            threadId={threadId}
            messageId={message.id}
            deploymentId={deploymentId}
          />
        ))}
      </div>
    </div>
  );
}

function ContentBlock({
  block,
  isUser,
  threadId,
  messageId,
  deploymentId,
}: {
  block: Content;
  isUser: boolean;
  threadId: string;
  messageId: string;
  deploymentId: string;
}) {
  if (block.type === "text" && block.text) {
    if (isUser) {
      return (
        <div className="inline-block rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
          <span className="whitespace-pre-wrap">{block.text}</span>
        </div>
      );
    }
    return (
      <div className="inline-block rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-secondary/50 text-foreground">
        <MarkdownMessage content={block.text} />
      </div>
    );
  }

  if (block.type === "component") {
    return (
      <div className="max-w-md">
        <ComponentRenderer
          content={block}
          threadId={threadId}
          messageId={messageId}
          fallback={
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
              Unknown component: {block.name}
            </div>
          }
        />
      </div>
    );
  }

  if (block.type === "tool_use") {
    const toolBlock = block as Content & { type: "tool_use" };
    const hasCompleted = (toolBlock as any).hasCompleted;
    const statusMessage = (toolBlock as any).statusMessage;
    const toolName = (toolBlock as any).name;

    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/30 border border-border/40 text-xs text-muted-foreground">
        {hasCompleted ? (
          <Wrench className="w-3.5 h-3.5" />
        ) : (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        )}
        <span>{statusMessage || toolName || "Running tool..."}</span>
      </div>
    );
  }

  // tool_result, resource — skip rendering
  return null;
}

function DirectMessageBubble({
  message,
  deploymentId,
  sendMessage,
}: {
  message: DirectChatMessage;
  deploymentId: string;
  sendMessage: (text: string) => Promise<void>;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary/10" : "bg-secondary"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary" />
        ) : (
          <Bot className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      <div className={`flex-1 ${isUser ? "text-right" : ""} space-y-3`}>
        {message.content && (
          isUser ? (
            <div className="inline-block rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
              <span className="whitespace-pre-wrap">{message.content}</span>
            </div>
          ) : (
            <div className="inline-block rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-secondary/50 text-foreground">
              <MarkdownMessage content={message.content} />
            </div>
          )
        )}

        {message.uiBlocks?.map((block) => (
          <div key={block.id} className="max-w-md">
            <EditableCanvas
              block={block}
              deploymentId={deploymentId}
              sendMessage={sendMessage}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
