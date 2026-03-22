import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { Task, JarbleDevConfig, QualityReport } from "./types.js";
import type { Logger } from "./logger.js";
import { REPO_CONTEXT } from "./prompts/system.js";

/** Paths in .claude/rules/ that match specific file patterns */
interface RuleFile {
  name: string;
  paths: string[];
  content: string;
}

/** Context budget — track how much context we've assembled */
interface ContextBudget {
  /** Approximate token count (chars / 4) */
  tokens: number;
  /** Hard limit before truncation */
  maxTokens: number;
}

/**
 * Builds rich, scope-matched context for agent prompts.
 *
 * Layers (in priority order):
 * 1. REPO_CONTEXT — project structure and patterns (always)
 * 2. Rules — .claude/rules/ files matched to task.touchesFiles
 * 3. File previews — first N lines of files the agent will modify
 * 4. Memory — relevant sections from .claude/memory/
 * 5. Upstream diffs — from completed dependencies (semantic summaries)
 * 6. Quality context — previous failures for retries
 */
export class ContextBuilder {
  private config: JarbleDevConfig;
  private logger: Logger;
  private ruleFiles: RuleFile[] = [];
  private memoryIndex: Map<string, string> = new Map(); // name → content

  constructor(config: JarbleDevConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.loadRules();
    this.loadMemory();
  }

  /** Build the full system prompt for an agent */
  buildSystemPrompt(task: Task, worktreeBranch: string): string {
    const parts: string[] = [];

    // 1. Always: repo context
    parts.push(REPO_CONTEXT);

    // 2. Matched rules
    const matchedRules = this.matchRules(task.touchesFiles);
    if (matchedRules.length > 0) {
      parts.push("\n## Project Rules (auto-matched to your scope)");
      for (const rule of matchedRules) {
        parts.push(`\n### ${rule.name}\n${rule.content}`);
      }
    }

    // 3. Task-specific instructions
    parts.push(
      `\nYou are working on task "${task.name}" in a git worktree branch "${worktreeBranch}".`,
      `Files you should focus on: ${task.touchesFiles.join(", ") || "as needed"}`,
    );

    return parts.join("\n");
  }

  /** Build the enriched task prompt with file previews, memory, and context */
  buildEnrichedPrompt(
    task: Task,
    upstreamDiffs?: Map<string, { taskName: string; diff: string }>,
  ): string {
    const budget: ContextBudget = { tokens: 0, maxTokens: this.config.contextBudgetTokens };
    const parts: string[] = [];

    // 1. Task header + description + prompt
    parts.push(`# Task: ${task.name}`);
    parts.push(task.description);
    parts.push("\n---\n");
    parts.push(task.prompt);
    budget.tokens += this.estimateTokens(parts.join("\n"));

    // 2. File previews — pre-read files so agent doesn't start blind
    const previews = this.buildFilePreviews(task.touchesFiles, budget);
    if (previews) {
      parts.push("\n\n---\n");
      parts.push(previews);
    }

    // 3. Relevant memory sections
    const memory = this.buildMemoryContext(task, budget);
    if (memory) {
      parts.push("\n\n---\n");
      parts.push(memory);
    }

    // 4. Upstream dependency context (smart summaries)
    if (upstreamDiffs && upstreamDiffs.size > 0) {
      const upstream = this.buildUpstreamContext(upstreamDiffs, budget);
      if (upstream) {
        parts.push("\n\n---\n");
        parts.push(upstream);
      }
    }

    // 5. Retry context with quality report
    if (task.previousErrors && task.previousErrors.length > 0) {
      parts.push("\n\n---\n");
      parts.push(this.buildRetryContext(task));
    }

    // 6. Final instructions
    parts.push("\n\nWhen you are done, create a git commit with all your changes. Use a descriptive commit message.");

    const prompt = parts.join("\n");
    const totalTokens = this.estimateTokens(prompt);
    this.logger.debug(`Context for "${task.name}": ~${totalTokens} tokens (${matchedRulesCount(this.matchRules(task.touchesFiles))} rules, ${previews ? "previews" : "no previews"})`, {
      taskId: task.id,
    });

    return prompt;
  }

  /** Match .claude/rules/ files to the task's touchesFiles using glob-like patterns */
  private matchRules(touchesFiles: string[]): RuleFile[] {
    if (touchesFiles.length === 0) return [];

    return this.ruleFiles.filter(rule => {
      return rule.paths.some(pattern => {
        // Strip glob suffix for prefix matching
        const prefix = pattern.replace(/\*\*?\/?$/, "").replace(/\*$/, "");
        return touchesFiles.some(file =>
          file.startsWith(prefix) || prefix.startsWith(file),
        );
      });
    });
  }

  /** Pre-read files from touchesFiles to give agents a head start */
  private buildFilePreviews(touchesFiles: string[], budget: ContextBudget): string | null {
    if (touchesFiles.length === 0) return null;

    const previews: string[] = [];
    const maxPreviewLines = 500;
    const maxTotalPreviewTokens = Math.floor(budget.maxTokens * 0.4);
    let previewTokens = 0;

    previews.push("## Existing File Previews");
    previews.push("These are the current contents of key files you'll be working with. Read them fully before making changes.\n");

    for (const filePath of touchesFiles) {
      if (previewTokens >= maxTotalPreviewTokens) break;
      if (budget.tokens + previewTokens >= budget.maxTokens * 0.85) break;

      // Skip directories (end with /)
      if (filePath.endsWith("/") || filePath.endsWith("\\")) continue;
      // Skip glob patterns
      if (filePath.includes("*")) continue;

      const fullPath = path.join(this.config.repoRoot, filePath);
      if (!fs.existsSync(fullPath)) continue;

      // Check if it's a file (not directory)
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) continue;
        // Skip very large files (over 200KB)
        if (stat.size > 200_000) {
          previews.push(`### ${filePath}\n*(${(stat.size / 1024).toFixed(0)}KB — too large to preview, read it yourself)*\n`);
          continue;
        }
      } catch { continue; }

      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const preview = lines.length > maxPreviewLines
          ? lines.slice(0, maxPreviewLines).join("\n") + `\n... (${lines.length - maxPreviewLines} more lines)`
          : content;

        const ext = path.extname(filePath).slice(1) || "text";
        const entry = `### ${filePath}\n\`\`\`${ext}\n${preview}\n\`\`\`\n`;
        const entryTokens = this.estimateTokens(entry);

        if (previewTokens + entryTokens > maxTotalPreviewTokens) break;

        previews.push(entry);
        previewTokens += entryTokens;
      } catch { continue; }
    }

    if (previews.length <= 2) return null; // Just the header, no actual previews

    budget.tokens += previewTokens;
    return previews.join("\n");
  }

  /** Find and inject relevant memory sections */
  private buildMemoryContext(task: Task, budget: ContextBudget): string | null {
    if (this.memoryIndex.size === 0) return null;
    if (budget.tokens >= budget.maxTokens * 0.9) return null;

    const relevant: string[] = [];
    const keywords = this.extractKeywords(task);

    for (const [name, content] of this.memoryIndex) {
      // Match by keyword overlap
      const nameLC = name.toLowerCase();
      const contentLC = content.toLowerCase().slice(0, 500);
      const isRelevant = keywords.some(kw =>
        nameLC.includes(kw) || contentLC.includes(kw),
      );

      if (isRelevant) {
        // Truncate individual memory entries
        const truncated = content.length > 8000
          ? content.slice(0, 8000) + "\n... (truncated)"
          : content;
        relevant.push(`### ${name}\n${truncated}`);
      }
    }

    if (relevant.length === 0) return null;

    const memoryContext = "## Relevant Project Memory\n" +
      "Context from previous work that may be relevant to your task:\n\n" +
      relevant.join("\n\n");

    const tokens = this.estimateTokens(memoryContext);
    if (budget.tokens + tokens > budget.maxTokens) return null;

    budget.tokens += tokens;
    return memoryContext;
  }

  /** Build upstream dependency context with semantic summaries */
  private buildUpstreamContext(
    diffs: Map<string, { taskName: string; diff: string }>,
    budget: ContextBudget,
  ): string | null {
    const parts: string[] = [];
    parts.push("## Upstream Changes");
    parts.push("The following tasks completed before yours. Their changes are already in your worktree.\n");

    for (const [, { taskName, diff }] of diffs) {
      if (!diff.trim()) continue;

      // Generate a semantic summary first
      const summary = this.summarizeDiff(diff);
      parts.push(`### Changes from "${taskName}"`);
      parts.push(`**Summary:** ${summary.description}`);
      parts.push(`Files: ${summary.files.join(", ")}`);
      parts.push(`+${summary.additions}/-${summary.deletions} lines\n`);

      // Include the diff if budget allows
      const remainingBudget = budget.maxTokens - budget.tokens;
      if (remainingBudget > 3000) {
        const maxDiffChars = Math.min(diff.length, remainingBudget * 3);
        const truncatedDiff = diff.length > maxDiffChars
          ? diff.slice(0, maxDiffChars) + "\n... (truncated)"
          : diff;
        parts.push("```diff\n" + truncatedDiff + "\n```\n");
      }
    }

    const context = parts.join("\n");
    const tokens = this.estimateTokens(context);
    budget.tokens += tokens;
    return context;
  }

  /** Build retry context with quality report details */
  private buildRetryContext(task: Task): string {
    const parts: string[] = [];
    parts.push("## Previous Attempt Failed");
    parts.push("This task was attempted before and failed. Fix these issues:\n");

    if (task.previousErrors) {
      for (let i = 0; i < task.previousErrors.length; i++) {
        parts.push(`### Attempt ${i + 1}`);
        parts.push(task.previousErrors[i]);
      }
    }

    // Extract structured quality report if available
    if (task.lastQualityReport) {
      const qr = task.lastQualityReport;
      parts.push("\n### Quality Gate Results");
      if (!qr.typecheckPassed && qr.typecheckErrors) {
        parts.push("**Typecheck errors:**");
        for (const err of qr.typecheckErrors.slice(0, 15)) {
          parts.push(`- ${err}`);
        }
      }
      if (!qr.testsPassed && qr.testFailures) {
        parts.push("**Test failures:**");
        for (const fail of qr.testFailures.slice(0, 15)) {
          parts.push(`- ${fail}`);
        }
      }
    }

    parts.push("\nPay special attention to TypeScript type errors, test failures, and runtime crashes.");
    return parts.join("\n");
  }

  /** Parse a git diff into a semantic summary */
  private summarizeDiff(diff: string): {
    description: string;
    files: string[];
    additions: number;
    deletions: number;
  } {
    const files: string[] = [];
    let additions = 0;
    let deletions = 0;
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];

    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git")) {
        const match = line.match(/b\/(.+)$/);
        if (match) files.push(match[1]);
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      } else if (line.startsWith("new file")) {
        const lastFile = files[files.length - 1];
        if (lastFile) newFiles.push(lastFile);
      }
    }

    for (const f of files) {
      if (!newFiles.includes(f)) modifiedFiles.push(f);
    }

    const descParts: string[] = [];
    if (newFiles.length > 0) descParts.push(`Created ${newFiles.length} file(s): ${newFiles.slice(0, 3).join(", ")}${newFiles.length > 3 ? "..." : ""}`);
    if (modifiedFiles.length > 0) descParts.push(`Modified ${modifiedFiles.length} file(s): ${modifiedFiles.slice(0, 3).join(", ")}${modifiedFiles.length > 3 ? "..." : ""}`);
    const description = descParts.join(". ") || `${files.length} file(s) changed`;

    return { description, files, additions, deletions };
  }

  /** Extract keywords from a task for memory matching */
  private extractKeywords(task: Task): string[] {
    const keywords = new Set<string>();

    // From task name
    for (const word of task.name.toLowerCase().split(/[-_\s]+/)) {
      if (word.length > 2) keywords.add(word);
    }

    // From touchesFiles — extract package and directory names
    for (const file of task.touchesFiles) {
      const segments = file.split(/[/\\]/);
      for (const seg of segments) {
        const clean = seg.toLowerCase().replace(/\.(ts|tsx|js|jsx|json|md)$/, "");
        if (clean.length > 2 && !["src", "lib", "utils", "components"].includes(clean)) {
          keywords.add(clean);
        }
      }
    }

    // From agent type
    if (task.agentType) {
      for (const word of task.agentType.split("-")) {
        if (word.length > 2) keywords.add(word);
      }
    }

    return [...keywords];
  }

  /** Load .claude/rules/ files with their path matchers */
  private loadRules() {
    const rulesDir = path.join(this.config.repoRoot, ".claude", "rules");
    if (!fs.existsSync(rulesDir)) return;

    try {
      const files = fs.readdirSync(rulesDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(rulesDir, file), "utf-8");
          const paths = this.parseRulePaths(content);
          // Strip frontmatter from content
          const bodyStart = content.indexOf("---", 3);
          const body = bodyStart > 0 ? content.slice(bodyStart + 3).trim() : content;

          this.ruleFiles.push({
            name: file.replace(".md", ""),
            paths,
            content: body,
          });
        } catch { /* skip unreadable files */ }
      }
      this.logger.debug(`Loaded ${this.ruleFiles.length} rule files`);
    } catch { /* rules dir doesn't exist */ }
  }

  /** Parse YAML frontmatter paths from a rule file */
  private parseRulePaths(content: string): string[] {
    // Simple YAML frontmatter parser for paths array
    const match = content.match(/^---\s*\npaths:\s*\n([\s\S]*?)\n---/);
    if (!match) return [];

    return match[1]
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("- "))
      .map(line => line.slice(2).replace(/^["']|["']$/g, "").trim());
  }

  /** Load .claude/memory/ index and files */
  private loadMemory() {
    const memoryDir = path.join(this.config.repoRoot, ".claude", "memory");
    if (!fs.existsSync(memoryDir)) return;

    try {
      const files = fs.readdirSync(memoryDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memoryDir, file), "utf-8");
          this.memoryIndex.set(file.replace(".md", ""), content);
        } catch { /* skip */ }
      }
      this.logger.debug(`Loaded ${this.memoryIndex.size} memory files`);
    } catch { /* memory dir doesn't exist */ }
  }

  /** Rough token estimation (chars / 4) */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

function matchedRulesCount(rules: RuleFile[]): number {
  return rules.length;
}
