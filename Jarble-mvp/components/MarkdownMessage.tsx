"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Replace raw jarble_delegate/json delegation blocks with clean styled cards.
 * The bot emits these as fenced code blocks but users shouldn't see raw JSON.
 */
function transformDelegationBlocks(text: string): string {
  return text
    // Replace ```jarble_delegate { "to": "name", "task": "..." } ```
    .replace(/```jarble_delegate\s*\n\s*\{[^}]*"to"\s*:\s*"([^"]+)"[^}]*"task"\s*:\s*"([^"]*)"[^}]*\}\s*\n?```/g,
      (_, to, task) => `> **Delegating to ${to}:** ${task.slice(0, 120)}${task.length > 120 ? "..." : ""}\n`)
    // Replace ```json { "tool": "delegate_to_name", "task": "..." } ```
    .replace(/```json\s*\n\s*\{[^}]*"tool"\s*:\s*"delegate_to_([^"]+)"[^}]*"task"\s*:\s*"([^"]*)"[^}]*\}\s*\n?```/g,
      (_, to, task) => `> **Delegating to ${to}:** ${task.slice(0, 120)}${task.length > 120 ? "..." : ""}\n`)
    // Also handle { "to": "name", ... } without specific fenced tag
    .replace(/```json\s*\n\s*\{[^}]*"to"\s*:\s*"([^"]+)"[^}]*"task"\s*:\s*"([^"]*)"[^}]*\}\s*\n?```/g,
      (_, to, task) => `> **Delegating to ${to}:** ${task.slice(0, 120)}${task.length > 120 ? "..." : ""}\n`)
    // Clean up excessive newlines after replacements
    .replace(/\n{3,}/g, "\n\n");
}

export default function MarkdownMessage({ content }: { content: string }) {
  const transformedContent = transformDelegationBlocks(content);
  return (
    <div className="break-words overflow-hidden" style={{ overflowWrap: "anywhere" }}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="whitespace-pre-wrap mb-2 last:mb-0">{children}</p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:text-primary/80"
          >
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="rounded-lg bg-secondary p-3 my-2 overflow-x-auto text-xs max-w-full">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">
              {children}
            </code>
          );
        },
        ul: ({ children }) => (
          <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
      }}
    >
      {transformedContent}
    </ReactMarkdown>
    </div>
  );
}
