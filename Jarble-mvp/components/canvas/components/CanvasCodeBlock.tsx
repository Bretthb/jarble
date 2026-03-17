"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { Copy, Check, ChevronDown, ChevronUp, Pencil, Eye } from "lucide-react";
import { useCanvasAction } from "@/components/canvas/CanvasActionContext";

export interface CanvasCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  kt: "kotlin",
  tf: "hcl",
  dockerfile: "docker",
};

function resolveLanguage(lang?: string): string {
  if (!lang) return "text";
  const lower = lang.toLowerCase().trim();
  return LANG_ALIASES[lower] || lower;
}

function CanvasCodeBlockInner({ code, language, title }: CanvasCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(code);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedLang = resolveLanguage(language);
  const lines = (editing ? editValue : code).split("\n");
  const lineCount = lines.length;

  let actionCtx: ReturnType<typeof useCanvasAction> | null = null;
  try { actionCtx = useCanvasAction(); } catch { /* not in a CanvasActionProvider */ }

  // Sync editValue when code prop changes from outside (bot update)
  useEffect(() => {
    if (!editing) setEditValue(code);
  }, [code, editing]);

  // Async syntax highlighting via shiki
  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    (async () => {
      try {
        const { codeToHtml } = await import("shiki");
        const html = await codeToHtml(code, {
          lang: resolvedLang,
          theme: "github-dark-default",
        });
        if (!cancelled) setHighlightedHtml(html);
      } catch {
        if (!cancelled) setHighlightedHtml(null);
      }
    })();
    return () => { cancelled = true; };
  }, [code, resolvedLang, editing]);

  const handleCopy = () => {
    navigator.clipboard.writeText(editing ? editValue : code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleStartEdit = () => {
    setEditValue(code);
    setEditing(true);
    setCollapsed(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSaveEdit = useCallback(() => {
    if (editValue === code) {
      setEditing(false);
      return;
    }
    // Dispatch content_edit to update card props silently
    if (actionCtx) {
      actionCtx.dispatch({ action: "content_edit", payload: { code: editValue } });
    }
    setEditing(false);
  }, [editValue, code, actionCtx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd+S to save
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSaveEdit();
    }
    // Escape to cancel
    if (e.key === "Escape") {
      setEditValue(code);
      setEditing(false);
    }
    // Tab to indent
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = editValue.slice(0, start) + "  " + editValue.slice(end);
      setEditValue(newVal);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div
      role="region"
      aria-label={`Code${language ? `: ${language}` : ""}${title ? ` — ${title}` : ""}`}
      className="h-full flex flex-col overflow-hidden rounded-xl bg-[#0d1117] border border-zinc-800/50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/50 bg-[#161b22]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]" />
            <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e]" />
            <span className="w-[10px] h-[10px] rounded-full bg-[#28c840]" />
          </div>
          {title && (
            <span className="text-[11px] font-medium text-zinc-400 truncate">{title}</span>
          )}
          {editing && (
            <span className="text-[9px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">EDITING</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {language && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-800/60">
              {resolvedLang}
            </span>
          )}
          <span className="text-[9px] text-zinc-600 tabular-nums">{lineCount} line{lineCount !== 1 ? "s" : ""}</span>
          {!editing && lineCount > 20 && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          )}
          {/* Edit / View toggle */}
          {editing ? (
            <button
              onClick={handleSaveEdit}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-green-400 hover:text-green-300 hover:bg-green-900/30 transition-colors"
              title="Save changes (Ctrl+S)"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          ) : (
            <button
              onClick={handleStartEdit}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              title="Edit code"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Copy code"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Code body */}
      {!collapsed && (
        <div className="flex-1 overflow-auto min-h-0">
          {editing ? (
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSaveEdit}
              spellCheck={false}
              className="w-full h-full min-h-[200px] bg-transparent text-[13px] leading-[1.6] p-3 text-zinc-200 font-mono resize-none outline-none border-none"
              style={{ tabSize: 2 }}
            />
          ) : highlightedHtml ? (
            <div
              className="shiki-code-block text-[13px] leading-[1.6] p-3 [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <pre className="text-[13px] leading-[1.6] p-3 text-zinc-300">
              <code>
                {lines.map((line, i) => (
                  <div key={i} className="flex hover:bg-zinc-800/30 transition-colors">
                    <span className="shrink-0 w-8 text-right pr-3 text-zinc-600 select-none text-xs leading-[1.6]">
                      {i + 1}
                    </span>
                    <span className="flex-1">{line || " "}</span>
                  </div>
                ))}
              </code>
            </pre>
          )}
        </div>
      )}

      {collapsed && (
        <div className="px-3 py-2 text-[11px] text-zinc-600 italic">
          {lineCount} lines collapsed
        </div>
      )}
    </div>
  );
}

export default memo(CanvasCodeBlockInner);
