"use client";

import { memo, useState } from "react";
import { motion } from "framer-motion";

export interface CanvasCodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5V3a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 3v5A1.5 1.5 0 003 9.5h1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7.5l3 3L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CanvasCodeBlockInner({ code, language, title }: CanvasCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const lines = code.split("\n");

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full overflow-hidden rounded-xl bg-zinc-950 border border-zinc-800/60"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/60 bg-zinc-900/80">
        <div className="flex items-center gap-2">
          {/* macOS-style dots */}
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
          </div>
          {title && (
            <span className="text-xs font-medium text-zinc-400">{title}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {language && (
            <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {language}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Code with line numbers */}
      <pre className="overflow-x-auto text-[13px] leading-relaxed">
        <code className="block py-3">
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-zinc-800/40 transition-colors">
              <span className="shrink-0 w-10 text-right pr-4 text-zinc-600 select-none text-xs leading-relaxed">
                {i + 1}
              </span>
              <span className="text-zinc-200 pr-4">{line || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </motion.div>
  );
}

export default memo(CanvasCodeBlockInner);
