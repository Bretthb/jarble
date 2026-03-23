#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { loadConfig } from "./config.js";
import { Orchestrator } from "./orchestrator.js";
import { PlanValidator } from "./planValidator.js";
import { StateStore } from "./stateStore.js";
import { LiveDashboard } from "./liveDashboard.js";
import { ReportGenerator } from "./reportGenerator.js";
import { PLAN_TEMPLATES } from "./templates.js";
import { Logger } from "./logger.js";
import { TeamOrchestrator } from "./teamOrchestrator.js";
import { TEAM_PRESETS, listTeamPresets, getAutoWiredDeps } from "./teamPresets.js";
import type { TaskPlan, TeamPlan, CIEvent } from "./types.js";

const program = new Command();

program
  .name("jarble-dev")
  .description("Meta-development orchestrator — spawn parallel Claude Code agents across git worktrees")
  .version("0.3.0");

// ─── run ────────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Execute a task plan with parallel agents")
  .argument("<plan-file>", "Path to a JSON plan file")
  .option("-c, --concurrency <n>", "Max concurrent agents", "4")
  .option("-b, --base-branch <branch>", "Base branch for worktrees", "main")
  .option("--budget <usd>", "Default budget per agent in USD", "5")
  .option("--no-quality-gates", "Skip typecheck/test quality gates before merge")
  .option("--no-merge", "Don't merge after completion — leave branches")
  .option("--no-auto-resolve", "Don't auto-resolve merge conflicts")
  .option("--no-context-forwarding", "Don't forward dependency diffs to downstream tasks")
  .option("--retries <n>", "Max retries per failed task", "1")
  .option("--timeout <ms>", "Agent timeout in ms", "600000")
  .option("--json", "JSON output for CI pipelines (no colors, structured events)")
  .option("--run-budget <usd>", "Total budget cap for entire run (0=unlimited)", "0")
  .option("--webhook <urls>", "Comma-separated webhook URLs for CI event notifications")
  .option("--incremental", "Skip tasks whose touchesFiles haven't changed since last success")
  .option("-v, --verbose", "Verbose debug output")
  .action(async (planFile: string, opts) => {
    const planPath = path.resolve(planFile);
    if (!fs.existsSync(planPath)) {
      console.error(chalk.red(`Plan file not found: ${planPath}`));
      process.exit(1);
    }

    let plan: TaskPlan;
    try {
      plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    } catch (e) {
      console.error(chalk.red(`Failed to parse plan file: ${e}`));
      process.exit(1);
    }

    if (!plan.tasks || !Array.isArray(plan.tasks)) {
      console.error(chalk.red("Plan file must have a 'tasks' array"));
      process.exit(1);
    }

    const isJson = !!opts.json;
    const config = loadConfig({
      maxConcurrency: parseInt(opts.concurrency),
      baseBranch: opts.baseBranch,
      defaultBudgetUsd: parseFloat(opts.budget),
      qualityGates: opts.qualityGates !== false,
      agentTimeoutMs: parseInt(opts.timeout),
      maxRetries: parseInt(opts.retries),
      autoResolve: opts.autoResolve !== false,
      contextForwarding: opts.contextForwarding !== false,
      jsonOutput: isJson,
      runBudgetUsd: parseFloat(opts.runBudget || "0"),
      webhookUrls: opts.webhook ? opts.webhook.split(",").map((s: string) => s.trim()) : [],
      incremental: !!opts.incremental,
    });

    // Validate plan first
    const validator = new PlanValidator(config.repoRoot);
    const validation = validator.validate(plan);
    if (!validation.valid) {
      if (isJson) {
        console.log(JSON.stringify({ error: "validation_failed", errors: validation.errors }));
      } else {
        console.error(chalk.red("\n  Plan validation failed:\n"));
        for (const err of validation.errors) {
          console.error(chalk.red(`  ✗ ${err.message}`));
        }
      }
      process.exit(1);
    }

    if (!isJson) {
      for (const warn of validation.warnings) {
        console.log(chalk.yellow(`  ⚠ ${warn.message}`));
      }

      console.log(chalk.bold(`\n  jarble-dev v0.3.0\n`));
      console.log(`  Plan: ${chalk.cyan(plan.name)}`);
      console.log(`  Tasks: ${chalk.yellow(String(plan.tasks.length))}`);
      console.log(`  Concurrency: ${chalk.yellow(opts.concurrency)}`);
      console.log(`  Budget/agent: ${chalk.yellow("$" + opts.budget)}`);
      console.log(`  Retries: ${chalk.yellow(opts.retries)}`);
      console.log(`  Quality gates: ${opts.qualityGates !== false ? chalk.green("on") : chalk.dim("off")}`);
      console.log(`  Auto-resolve: ${opts.autoResolve !== false ? chalk.green("on") : chalk.dim("off")}`);
      console.log(`  Context fwd:  ${opts.contextForwarding !== false ? chalk.green("on") : chalk.dim("off")}`);
      if (config.runBudgetUsd > 0) {
        console.log(`  Run budget:   ${chalk.yellow("$" + config.runBudgetUsd)}`);
      }
      if (config.webhookUrls.length > 0) {
        console.log(`  Webhooks:     ${chalk.green(config.webhookUrls.length + " configured")}`);
      }
      if (config.incremental) {
        console.log(`  Incremental:  ${chalk.green("on")}`);
      }
      console.log();
    }

    const orchestrator = new Orchestrator(config, opts.verbose);

    // In JSON mode, pipe CI events to stdout
    if (isJson) {
      orchestrator.events.on("ci:event", (evt: CIEvent) => {
        console.log(JSON.stringify(evt));
      });
    }

    // Handle Ctrl+C gracefully
    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n\nInterrupted — saving state for resume..."));
      orchestrator.saveState();
      await orchestrator.cleanup();
      process.exit(1);
    });

    const state = await orchestrator.run(plan);

    // Merge if requested
    if (opts.merge !== false) {
      const doneTasks = state.tasks.filter(t => t.status === "done");
      if (doneTasks.length > 0) {
        if (!isJson) console.log(chalk.bold("\nMerging completed tasks..."));
        const results = await orchestrator.mergeCompleted();

        if (!isJson) {
          for (const r of results) {
            const icon = r.status === "merged" ? chalk.green("✓") : r.status === "conflict" ? chalk.yellow("⚠") : chalk.red("✗");
            console.log(`  ${icon} ${r.branch} → ${r.status}`);
            if (r.conflictFiles) {
              for (const f of r.conflictFiles) {
                console.log(chalk.dim(`    conflict: ${f}`));
              }
            }
          }
        }
      }
    }

    if (!isJson) {
      console.log(chalk.dim("\nCleaning up worktrees..."));
    }
    await orchestrator.cleanup();

    // In JSON mode, emit final report as JSON
    if (isJson) {
      console.log(JSON.stringify({ event: "report", data: ReportGenerator.toJSON(state) }));
    }

    const failed = state.tasks.filter(t => t.status === "failed" || t.status === "skipped");
    process.exit(failed.length > 0 ? 1 : 0);
  });

// ─── watch ──────────────────────────────────────────────────────────────
program
  .command("watch")
  .description("Execute a plan with a live dashboard showing agent status and output")
  .argument("<plan-file>", "Path to a JSON plan file")
  .option("-c, --concurrency <n>", "Max concurrent agents", "4")
  .option("-b, --base-branch <branch>", "Base branch for worktrees", "main")
  .option("--budget <usd>", "Default budget per agent in USD", "5")
  .option("--no-quality-gates", "Skip quality gates")
  .option("--no-merge", "Don't merge after completion")
  .option("--no-context-forwarding", "Don't forward dependency diffs")
  .option("--retries <n>", "Max retries per failed task", "1")
  .option("--timeout <ms>", "Agent timeout in ms", "600000")
  .option("--run-budget <usd>", "Total budget cap for entire run (0=unlimited)", "0")
  .option("--webhook <urls>", "Comma-separated webhook URLs")
  .option("--incremental", "Skip unchanged tasks")
  .action(async (planFile: string, opts) => {
    const planPath = path.resolve(planFile);
    if (!fs.existsSync(planPath)) {
      console.error(chalk.red(`Plan file not found: ${planPath}`));
      process.exit(1);
    }

    let plan: TaskPlan;
    try {
      plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    } catch (e) {
      console.error(chalk.red(`Failed to parse plan file: ${e}`));
      process.exit(1);
    }

    const config = loadConfig({
      maxConcurrency: parseInt(opts.concurrency),
      baseBranch: opts.baseBranch,
      defaultBudgetUsd: parseFloat(opts.budget),
      qualityGates: opts.qualityGates !== false,
      agentTimeoutMs: parseInt(opts.timeout),
      maxRetries: parseInt(opts.retries),
      contextForwarding: opts.contextForwarding !== false,
      runBudgetUsd: parseFloat(opts.runBudget || "0"),
      webhookUrls: opts.webhook ? opts.webhook.split(",").map((s: string) => s.trim()) : [],
      incremental: !!opts.incremental,
    });

    const orchestrator = new Orchestrator(config, false);
    const dashboard = new LiveDashboard(
      // Logger is private — dashboard just reads state
      { agentLog: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
      orchestrator.getState(),
      orchestrator.events,
    );

    process.on("SIGINT", async () => {
      dashboard.stop();
      orchestrator.saveState();
      await orchestrator.cleanup();
      process.exit(1);
    });

    dashboard.start();
    const state = await orchestrator.run(plan);
    dashboard.stop();

    // Merge
    if (opts.merge !== false) {
      const doneTasks = state.tasks.filter(t => t.status === "done");
      if (doneTasks.length > 0) {
        console.log(chalk.bold("\nMerging completed tasks..."));
        const results = await orchestrator.mergeCompleted();
        for (const r of results) {
          const icon = r.status === "merged" ? chalk.green("✓") : r.status === "conflict" ? chalk.yellow("⚠") : chalk.red("✗");
          console.log(`  ${icon} ${r.branch} → ${r.status}`);
        }
      }
    }

    await orchestrator.cleanup();
    const failed = state.tasks.filter(t => t.status === "failed" || t.status === "skipped");
    process.exit(failed.length > 0 ? 1 : 0);
  });

// ─── validate ───────────────────────────────────────────────────────────
program
  .command("validate")
  .description("Validate a plan file before running")
  .argument("<plan-file>", "Path to a JSON plan file")
  .action(async (planFile: string) => {
    const planPath = path.resolve(planFile);
    if (!fs.existsSync(planPath)) {
      console.error(chalk.red(`Plan file not found: ${planPath}`));
      process.exit(1);
    }

    let content: Record<string, unknown>;
    try {
      content = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    } catch (e) {
      console.error(chalk.red(`Failed to parse plan file: ${e}`));
      process.exit(1);
    }

    const config = loadConfig();
    const validator = new PlanValidator(config.repoRoot);

    // Detect plan type: team plan (has teams array) vs flat plan (has tasks array)
    const isTeamPlan = content.teams && Array.isArray(content.teams);
    const result = isTeamPlan
      ? validator.validateTeamPlan(content as unknown as TeamPlan)
      : validator.validate(content as unknown as TaskPlan);

    const plan = content as Record<string, unknown>;

    console.log(chalk.bold("\n  Plan Validation\n"));
    console.log(`  Plan: ${chalk.cyan(String(plan.name || "(unnamed)"))}`);
    if (isTeamPlan) {
      const teams = (content as unknown as TeamPlan).teams;
      console.log(`  Type: ${chalk.cyan("Team plan")}`);
      console.log(`  Teams: ${teams.length}`);
      const totalTasks = teams.reduce((s, t) => s + (t.tasks?.length || 0), 0);
      console.log(`  Total tasks: ${totalTasks}`);
    } else {
      console.log(`  Tasks: ${(content as unknown as TaskPlan).tasks?.length || 0}`);
    }
    console.log();

    if (result.errors.length > 0) {
      console.log(chalk.red("  Errors:"));
      for (const err of result.errors) {
        console.log(chalk.red(`    ✗ [${err.type}] ${err.message}`));
      }
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow("\n  Warnings:"));
      for (const warn of result.warnings) {
        console.log(chalk.yellow(`    ⚠ [${warn.type}] ${warn.message}`));
      }
    }

    if (result.valid) {
      console.log(chalk.green("\n  ✓ Plan is valid\n"));
    } else {
      console.log(chalk.red("\n  ✗ Plan has errors — fix before running\n"));
      process.exit(1);
    }
  });

// ─── plan ───────────────────────────────────────────────────────────────
program
  .command("plan")
  .description("Generate a task plan from a description (uses Claude to decompose)")
  .argument("<description>", "High-level description of the work to do")
  .option("-o, --output <file>", "Output plan file", "plan.json")
  .option("--budget <usd>", "Budget for planner agent", "2")
  .action(async (description: string, opts) => {
    console.log(chalk.bold("\n  jarble-dev planner\n"));
    console.log(`  Generating plan for: ${chalk.cyan(description.slice(0, 80))}`);

    const config = loadConfig({ defaultBudgetUsd: parseFloat(opts.budget) });
    const { spawn: spawnChild } = await import("child_process");

    const prompt = [
      "You are a software architect decomposing a development task into parallel sub-tasks for the Jarble platform monorepo.",
      "",
      "The monorepo has these packages:",
      "- Jarble-mvp/ (Next.js 15 frontend)",
      "- jarble-api-main/ (Express + tRPC API)",
      "- shared/component-manifest/ (shared types/schemas)",
      "",
      'Generate a JSON plan file with this structure:',
      '{ "name": "plan name", "description": "what this plan does", "tasks": [',
      '  { "name": "task-name", "description": "What this task does",',
      '    "touchesFiles": ["jarble-api-main/src/path/file.ts"],',
      '    "dependsOn": ["other-task-name"],',
      '    "agentType": "optional agent from .claude/agents/",',
      '    "prompt": "Detailed instructions for the agent",',
      '    "maxBudgetUsd": 5, "permissionMode": "acceptEdits" }',
      "] }",
      "",
      "Rules:",
      "- Tasks that can run in parallel should have no dependencies between them",
      "- Tasks that modify the same files MUST have dependencies to avoid conflicts",
      "- Schema changes should be a single task that runs first",
      "- Keep prompts detailed — the agent gets no other context",
      "- Use agentType when a specialized agent exists (drizzle-db-schema, mcp-server, test-writer, etc.)",
      "",
      "The work to decompose:",
      description,
      "",
      "Respond with ONLY the JSON plan, no markdown fences or explanation.",
    ].join("\n");

    const childEnv = { ...process.env };
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;

    try {
      const result = await new Promise<string>((resolve, reject) => {
        const args = [
          "--print",
          "--output-format", "json",
          "--max-budget-usd", String(opts.budget),
          "--permission-mode", "plan",
          prompt,
        ];

        const child = spawnChild(config.claudePath, args, {
          cwd: config.repoRoot,
          env: childEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("Planner timed out after 2 minutes"));
        }, 120_000);

        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) reject(new Error(`Claude exited with code ${code}: ${stderr}`));
          else resolve(stdout);
        });
        child.on("error", (err) => { clearTimeout(timer); reject(err); });
      });

      let planJson: string;
      try {
        const parsed = JSON.parse(result);
        planJson = parsed.result || result;
      } catch {
        planJson = result;
      }

      const jsonMatch = planJson.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(chalk.red("Failed to extract plan JSON from response"));
        process.exit(1);
      }

      const plan: TaskPlan = JSON.parse(jsonMatch[0]);
      fs.writeFileSync(opts.output, JSON.stringify(plan, null, 2));
      console.log(chalk.green(`\n  Plan saved to ${opts.output}`));
      console.log(`  Tasks: ${plan.tasks.length}`);
      for (const t of plan.tasks) {
        const deps = t.dependsOn?.length ? chalk.dim(` (after: ${t.dependsOn.join(", ")})`) : "";
        console.log(`    ${chalk.cyan("•")} ${t.name}${deps}`);
      }
    } catch (e) {
      console.error(chalk.red(`Planner failed: ${e}`));
      process.exit(1);
    }
  });

// ─── resume ─────────────────────────────────────────────────────────────
program
  .command("resume")
  .description("Resume an interrupted run from saved state")
  .argument("[run-id]", "Run ID to resume (defaults to most recent)")
  .option("--no-merge", "Don't merge after completion")
  .action(async (runId: string | undefined, opts) => {
    const config = loadConfig();

    let store: StateStore | null;
    if (runId) {
      store = new StateStore(config.logDir, runId);
    } else {
      store = StateStore.findLatest(config.logDir);
    }

    if (!store) {
      console.error(chalk.red("No saved state found to resume"));
      process.exit(1);
    }

    const savedState = store.load();
    if (!savedState) {
      console.error(chalk.red("Failed to load saved state"));
      process.exit(1);
    }

    const incomplete = savedState.tasks.filter(t => t.status !== "done" && t.status !== "skipped");
    if (incomplete.length === 0) {
      console.log(chalk.green("All tasks already completed — nothing to resume"));
      process.exit(0);
    }

    console.log(chalk.bold(`\n  Resuming run ${savedState.runId}\n`));
    console.log(`  Tasks: ${savedState.tasks.length} (${incomplete.length} incomplete)`);
    console.log();

    const orchestrator = new Orchestrator(config);

    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n\nInterrupted — saving state..."));
      orchestrator.saveState();
      await orchestrator.cleanup();
      process.exit(1);
    });

    const state = await orchestrator.resume(savedState);

    if (opts.merge !== false) {
      const doneTasks = state.tasks.filter(t => t.status === "done");
      if (doneTasks.length > 0) {
        console.log(chalk.bold("\nMerging completed tasks..."));
        const results = await orchestrator.mergeCompleted();
        for (const r of results) {
          const icon = r.status === "merged" ? chalk.green("✓") : chalk.red("✗");
          console.log(`  ${icon} ${r.branch} → ${r.status}`);
        }
      }
    }

    await orchestrator.cleanup();
    const failed = state.tasks.filter(t => t.status === "failed" || t.status === "skipped");
    process.exit(failed.length > 0 ? 1 : 0);
  });

// ─── status ─────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show status of worktrees and branches from previous runs")
  .action(async () => {
    const config = loadConfig();
    const { execSync } = await import("child_process");

    console.log(chalk.bold("\n  jarble-dev worktree status\n"));

    try {
      const worktrees = execSync("git worktree list", {
        cwd: config.repoRoot,
        encoding: "utf-8",
      });

      const lines = worktrees.trim().split("\n");
      for (const line of lines) {
        const isJarbleDev = line.includes("jarble-dev/") || line.includes(".worktrees");
        const icon = isJarbleDev ? chalk.cyan("▸") : chalk.dim("·");
        console.log(`  ${icon} ${isJarbleDev ? chalk.cyan(line) : chalk.dim(line)}`);
      }
    } catch (e) {
      console.error(chalk.red(`Failed to list worktrees: ${e}`));
    }

    // Show jarble-dev branches
    try {
      const branches = execSync('git branch --list "jarble-dev/*"', {
        cwd: config.repoRoot,
        encoding: "utf-8",
      });

      if (branches.trim()) {
        console.log(chalk.bold("\n  Branches:"));
        for (const branch of branches.trim().split("\n")) {
          console.log(`  ${chalk.cyan("▸")} ${branch.trim()}`);
        }
      }
    } catch { /* no branches */ }

    // Show saved states
    const logDir = path.join(config.repoRoot, "jarble-dev", "logs");
    if (fs.existsSync(logDir)) {
      const states = fs.readdirSync(logDir)
        .filter(f => f.startsWith("state-"))
        .sort()
        .reverse()
        .slice(0, 5);

      if (states.length > 0) {
        console.log(chalk.bold("\n  Resumable runs:"));
        for (const s of states) {
          const match = s.match(/state-(.+)\.json/);
          console.log(`  ${chalk.cyan("▸")} ${match?.[1] || s}`);
        }
      }

      const logs = fs.readdirSync(logDir)
        .filter(f => f.startsWith("run-"))
        .sort()
        .reverse()
        .slice(0, 5);

      if (logs.length > 0) {
        console.log(chalk.bold("\n  Recent logs:"));
        for (const log of logs) {
          console.log(`  ${chalk.dim("▸")} ${log}`);
        }
      }
    }

    console.log();
  });

// ─── cleanup ────────────────────────────────────────────────────────────
program
  .command("cleanup")
  .description("Remove all jarble-dev worktrees and branches")
  .option("--branches", "Also delete jarble-dev/* branches")
  .action(async (opts) => {
    const config = loadConfig();
    const { execSync } = await import("child_process");

    console.log(chalk.bold("\n  Cleaning up jarble-dev artifacts...\n"));

    // Remove worktrees
    try {
      const worktrees = execSync("git worktree list --porcelain", {
        cwd: config.repoRoot,
        encoding: "utf-8",
      });

      for (const block of worktrees.split("\n\n")) {
        const pathMatch = block.match(/worktree (.+)/);
        if (pathMatch && pathMatch[1].includes(".worktrees")) {
          try {
            execSync(`git worktree remove "${pathMatch[1]}" --force`, {
              cwd: config.repoRoot,
              stdio: "pipe",
            });
            console.log(chalk.green(`  ✓ Removed worktree: ${pathMatch[1]}`));
          } catch {
            console.log(chalk.yellow(`  ⚠ Failed to remove: ${pathMatch[1]}`));
          }
        }
      }

      execSync("git worktree prune", { cwd: config.repoRoot, stdio: "pipe" });
    } catch (e) {
      console.error(chalk.red(`  Failed to clean worktrees: ${e}`));
    }

    // Delete branches
    if (opts.branches) {
      console.log(chalk.dim("  Deleting jarble-dev branches..."));
      try {
        const branches = execSync('git branch --list "jarble-dev/*"', {
          cwd: config.repoRoot,
          encoding: "utf-8",
        });

        for (const branch of branches.trim().split("\n")) {
          const name = branch.trim();
          if (!name) continue;
          try {
            execSync(`git branch -D "${name}"`, { cwd: config.repoRoot, stdio: "pipe" });
            console.log(chalk.green(`  ✓ Deleted branch: ${name}`));
          } catch {
            console.log(chalk.yellow(`  ⚠ Failed to delete: ${name}`));
          }
        }
      } catch { /* no branches */ }
    }

    console.log(chalk.green("\n  Cleanup complete.\n"));
  });

// ─── report ────────────────────────────────────────────────────────────
program
  .command("report")
  .description("Show detailed analytics for a run")
  .argument("[run-id]", "Run ID (defaults to most recent)")
  .option("--json", "Output as JSON")
  .option("--history", "Show cross-run aggregate stats")
  .action(async (runId: string | undefined, opts) => {
    const config = loadConfig();

    if (opts.history) {
      console.log(ReportGenerator.aggregateHistory(config.logDir));
      return;
    }

    const result = ReportGenerator.loadAndReport(config.logDir, runId);
    if (!result) {
      console.error(chalk.red("No saved state found"));
      process.exit(1);
    }

    if (opts.json) {
      console.log(JSON.stringify(ReportGenerator.toJSON(result.state), null, 2));
    } else {
      console.log(result.report);
    }
  });

// ─── diff ──────────────────────────────────────────────────────────────
program
  .command("diff")
  .description("Show diffs from completed tasks in a run")
  .argument("[run-id]", "Run ID (defaults to most recent)")
  .option("--task <name>", "Show diff for a specific task only")
  .option("--stat", "Show diffstat summary only")
  .action(async (runId: string | undefined, opts) => {
    const config = loadConfig();
    const { execSync } = await import("child_process");

    let store: StateStore | null;
    if (runId) {
      store = new StateStore(config.logDir, runId);
    } else {
      store = StateStore.findLatest(config.logDir);
    }

    if (!store) {
      console.error(chalk.red("No saved state found"));
      process.exit(1);
    }

    const state = store.load();
    if (!state) {
      console.error(chalk.red("Failed to load state"));
      process.exit(1);
    }

    const doneTasks = state.tasks.filter(t => t.status === "done" && t.worktreeBranch);

    if (opts.task) {
      const task = doneTasks.find(t => t.name === opts.task);
      if (!task) {
        console.error(chalk.red(`Task "${opts.task}" not found or not completed`));
        process.exit(1);
      }
      showBranchDiff(config.repoRoot, task.worktreeBranch!, config.baseBranch, opts.stat, execSync);
      return;
    }

    for (const task of doneTasks) {
      console.log(chalk.bold(`\n  ${task.name}`) + chalk.dim(` (${task.worktreeBranch})`));
      console.log(chalk.dim("  " + "─".repeat(80)));
      showBranchDiff(config.repoRoot, task.worktreeBranch!, config.baseBranch, opts.stat, execSync);
    }
  });

function showBranchDiff(
  repoRoot: string,
  branch: string,
  baseBranch: string,
  statOnly: boolean,
  execSync: typeof import("child_process").execSync,
) {
  try {
    const diffCmd = statOnly
      ? `git diff ${baseBranch}...${branch} --stat`
      : `git diff ${baseBranch}...${branch}`;
    const output = execSync(diffCmd, {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (output.trim()) {
      console.log(output);
    } else {
      console.log(chalk.dim("  (no changes)"));
    }
  } catch {
    console.log(chalk.yellow("  Branch not found — may have been cleaned up"));
  }
}

// ─── merge ─────────────────────────────────────────────────────────────
program
  .command("merge")
  .description("Merge completed tasks from a previous run (selective)")
  .argument("[run-id]", "Run ID (defaults to most recent)")
  .option("--tasks <names>", "Comma-separated task names to merge (default: all done)")
  .option("--no-auto-resolve", "Don't auto-resolve conflicts")
  .option("--dry-run", "Show what would be merged without merging")
  .action(async (runId: string | undefined, opts) => {
    const config = loadConfig({
      autoResolve: opts.autoResolve !== false,
    });

    let store: StateStore | null;
    if (runId) {
      store = new StateStore(config.logDir, runId);
    } else {
      store = StateStore.findLatest(config.logDir);
    }

    if (!store) {
      console.error(chalk.red("No saved state found"));
      process.exit(1);
    }

    const state = store.load();
    if (!state) {
      console.error(chalk.red("Failed to load state"));
      process.exit(1);
    }

    const doneTasks = state.tasks.filter(t => t.status === "done" && t.worktreeBranch);

    let selectedNames: string[];
    if (opts.tasks) {
      selectedNames = opts.tasks.split(",").map((s: string) => s.trim());
      const unknown = selectedNames.filter(n => !doneTasks.find(t => t.name === n));
      if (unknown.length > 0) {
        console.error(chalk.red(`Tasks not found or not completed: ${unknown.join(", ")}`));
        console.log(chalk.dim(`Available: ${doneTasks.map(t => t.name).join(", ")}`));
        process.exit(1);
      }
    } else {
      selectedNames = doneTasks.map(t => t.name);
    }

    console.log(chalk.bold(`\n  Merging ${selectedNames.length} task(s) into ${config.baseBranch}\n`));
    for (const name of selectedNames) {
      const task = doneTasks.find(t => t.name === name)!;
      console.log(`  ${chalk.cyan("•")} ${name} ${chalk.dim(`(${task.worktreeBranch})`)}`);
    }

    if (opts.dryRun) {
      console.log(chalk.yellow("\n  --dry-run: nothing was merged\n"));
      return;
    }

    console.log();

    // Use Merger directly — don't re-run orchestrator execution loop
    const { Logger } = await import("./logger.js");
    const { WorktreeManager } = await import("./worktreeManager.js");
    const { AgentSpawner } = await import("./agentSpawner.js");
    const { Merger } = await import("./merger.js");
    const { Planner } = await import("./planner.js");

    const logger = new Logger(config.logDir, false);
    const wtManager = new WorktreeManager(config.repoRoot, config.baseBranch, logger);
    const spawner = config.autoResolve ? new AgentSpawner(config, logger) : undefined;
    const merger = new Merger(config.repoRoot, logger, wtManager, spawner, config.autoResolve);
    const planner = new Planner(logger);

    // Topo-sort the full set, then filter to only selected
    const sorted = planner.topoSort(state.tasks)
      .filter(t => selectedNames.includes(t.name) && t.status === "done");

    const results = await merger.mergeAll(sorted, config.baseBranch);

    for (const r of results) {
      const icon = r.status === "merged" ? chalk.green("✓") : r.status === "conflict" ? chalk.yellow("⚠") : chalk.red("✗");
      console.log(`  ${icon} ${r.branch} → ${r.status}`);
      if (r.conflictFiles) {
        for (const f of r.conflictFiles) {
          console.log(chalk.dim(`    conflict: ${f}`));
        }
      }
    }

    await logger.close();
    console.log();
  });

// ─── init ──────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialize a plan file from a built-in template")
  .argument("[template]", "Template name (schema-change, full-stack-feature, bugfix, canvas-component, mcp-tool, refactor)")
  .option("-o, --output <file>", "Output file path", "plan.json")
  .option("--list", "List available templates")
  .action(async (templateName: string | undefined, opts) => {
    if (opts.list || !templateName) {
      console.log(chalk.bold("\n  Available Templates\n"));
      for (const t of PLAN_TEMPLATES) {
        console.log(`  ${chalk.cyan(t.name.padEnd(25))} ${chalk.dim(t.description)}`);
      }
      console.log(chalk.dim(`\n  Usage: jarble-dev init <template> [-o plan.json]\n`));
      return;
    }

    const template = PLAN_TEMPLATES.find(t => t.name === templateName);
    if (!template) {
      console.error(chalk.red(`Unknown template: "${templateName}"`));
      console.log(chalk.dim(`Available: ${PLAN_TEMPLATES.map(t => t.name).join(", ")}`));
      process.exit(1);
    }

    const outPath = path.resolve(opts.output);
    fs.writeFileSync(outPath, JSON.stringify(template.plan, null, 2));

    console.log(chalk.green(`\n  Created ${outPath} from template "${templateName}"`));
    console.log(chalk.dim(`  Edit the TODO sections in each task's prompt, then run:`));
    console.log(chalk.cyan(`  jarble-dev run ${opts.output}\n`));
  });

// ─── pr ──────────────────────────────────────────────────────────────
program
  .command("pr")
  .description("Create a GitHub PR from a completed run")
  .argument("[run-id]", "Run ID (defaults to most recent)")
  .option("--title <title>", "PR title (auto-generated if omitted)")
  .option("-b, --base <branch>", "Base branch for the PR", "main")
  .action(async (runId: string | undefined, opts) => {
    const config = loadConfig();

    let store: StateStore | null;
    if (runId) {
      store = new StateStore(config.logDir, runId);
    } else {
      store = StateStore.findLatest(config.logDir);
    }

    if (!store) {
      console.error(chalk.red("No saved state found"));
      process.exit(1);
    }

    const state = store.load();
    if (!state) {
      console.error(chalk.red("Failed to load state"));
      process.exit(1);
    }

    const { GitHubIntegration } = await import("./githubIntegration.js");
    const gh = new GitHubIntegration(config.repoRoot, new Logger(config.logDir, false));

    if (!gh.isAvailable()) {
      console.error(chalk.red("gh CLI not found. Install: https://cli.github.com"));
      process.exit(1);
    }

    console.log(chalk.bold("\n  Creating PR...\n"));

    try {
      gh.pushBranch();
      const result = await gh.createPR(state, opts.base, opts.title);
      console.log(chalk.green(`  PR created: ${result.url}\n`));
    } catch (e) {
      console.error(chalk.red(`  Failed: ${e}`));
      process.exit(1);
    }
  });

// ─── team-run ────────────────────────────────────────────────────────
program
  .command("team-run")
  .description("Execute a team plan — each team runs as a sub-orchestrator with its own agents")
  .argument("<plan-file>", "Path to a team plan JSON file")
  .option("-c, --concurrency <n>", "Max concurrent teams", "2")
  .option("--budget <usd>", "Default budget per agent", "5")
  .option("-b, --base-branch <branch>", "Base branch", "main")
  .option("--no-quality-gates", "Skip quality gates")
  .option("--retries <n>", "Max retries per task", "1")
  .option("--timeout <ms>", "Agent timeout in ms", "600000")
  .option("-v, --verbose", "Verbose output")
  .action(async (planFile: string, opts) => {
    const planPath = path.resolve(planFile);
    if (!fs.existsSync(planPath)) {
      console.error(chalk.red(`Plan file not found: ${planPath}`));
      process.exit(1);
    }

    let plan: TeamPlan;
    try {
      plan = JSON.parse(fs.readFileSync(planPath, "utf-8"));
    } catch (e) {
      console.error(chalk.red(`Failed to parse plan file: ${e}`));
      process.exit(1);
    }

    if (!plan.teams || !Array.isArray(plan.teams)) {
      console.error(chalk.red("Plan file must have a 'teams' array. Use 'run' for flat task plans."));
      process.exit(1);
    }

    const config = loadConfig({
      maxConcurrency: parseInt(opts.concurrency),
      baseBranch: opts.baseBranch,
      defaultBudgetUsd: parseFloat(opts.budget),
      qualityGates: opts.qualityGates !== false,
      agentTimeoutMs: parseInt(opts.timeout),
      maxRetries: parseInt(opts.retries),
    });

    // Validate
    const validator = new PlanValidator(config.repoRoot);
    const validation = validator.validateTeamPlan(plan);
    if (!validation.valid) {
      console.error(chalk.red("\n  Team plan validation failed:\n"));
      for (const err of validation.errors) {
        console.error(chalk.red(`  ✗ ${err.message}`));
      }
      process.exit(1);
    }

    for (const warn of validation.warnings) {
      console.log(chalk.yellow(`  ⚠ ${warn.message}`));
    }

    const totalTasks = plan.teams.reduce((s, t) => s + t.tasks.length, 0);

    console.log(chalk.bold(`\n  jarble-dev team-run\n`));
    console.log(`  Plan:         ${chalk.cyan(plan.name)}`);
    console.log(`  Teams:        ${chalk.yellow(String(plan.teams.length))}`);
    console.log(`  Total tasks:  ${chalk.yellow(String(totalTasks))}`);
    console.log(`  Concurrency:  ${chalk.yellow(opts.concurrency)} teams`);
    console.log(`  Budget/agent: ${chalk.yellow("$" + opts.budget)}`);
    console.log();

    for (const team of plan.teams) {
      const deps = team.dependsOn.length > 0 ? chalk.dim(` → after: ${team.dependsOn.join(", ")}`) : "";
      console.log(`  ${chalk.cyan("▸")} ${team.name} (${team.tasks.length} tasks)${deps}`);
    }
    console.log();

    const teamOrch = new TeamOrchestrator(config, opts.verbose);

    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n\nInterrupted."));
      process.exit(1);
    });

    const results = await teamOrch.run(plan);
    const failed = results.filter(r => r.status === "failed");
    process.exit(failed.length > 0 ? 1 : 0);
  });

// ─── team-init ───────────────────────────────────────────────────────
program
  .command("team-init")
  .description("Initialize a team plan from presets")
  .argument("[teams...]", "Team preset names (schema, backend, frontend, mcp, tests, etc.)")
  .option("-o, --output <file>", "Output file", "team-plan.json")
  .option("--list", "List available team presets")
  .action(async (teams: string[], opts) => {
    if (opts.list || teams.length === 0) {
      console.log(chalk.bold("\n  Available Team Presets\n"));
      for (const [name, preset] of Object.entries(TEAM_PRESETS)) {
        const agent = preset.agentType ? chalk.dim(` [${preset.agentType}]`) : "";
        console.log(`  ${chalk.cyan(name.padEnd(15))} ${chalk.dim(preset.description)}${agent}`);
      }
      console.log(chalk.dim(`\n  Usage: jarble-dev team-init schema backend frontend [-o team-plan.json]\n`));
      return;
    }

    // Validate preset names
    const unknown = teams.filter(t => !TEAM_PRESETS[t]);
    if (unknown.length > 0) {
      console.error(chalk.red(`Unknown presets: ${unknown.join(", ")}`));
      console.log(chalk.dim(`Available: ${listTeamPresets().join(", ")}`));
      process.exit(1);
    }

    // Build team plan with auto-wired dependencies
    const teamPlan: TeamPlan = {
      name: "TODO: plan name",
      description: "TODO: plan description",
      teams: teams.map(name => {
        const preset = TEAM_PRESETS[name];
        return {
          name: preset.name,
          description: preset.description,
          dependsOn: getAutoWiredDeps(name, teams),
          agentType: preset.agentType,
          budget: preset.defaultBudget,
          permissionMode: preset.permissionMode,
          scope: preset.scope,
          tasks: preset.exampleTasks.map(ex => ({
            name: ex.name,
            description: ex.description,
            touchesFiles: ex.touchesFiles,
            dependsOn: [],
            prompt: "TODO: Write detailed instructions for this task",
          })),
        };
      }),
    };

    const outPath = path.resolve(opts.output);
    fs.writeFileSync(outPath, JSON.stringify(teamPlan, null, 2));

    console.log(chalk.green(`\n  Created ${outPath}`));
    console.log();
    for (const team of teamPlan.teams) {
      const deps = team.dependsOn.length > 0 ? chalk.dim(` → after: ${team.dependsOn.join(", ")}`) : "";
      console.log(`  ${chalk.cyan("▸")} ${team.name} (${team.tasks.length} tasks, $${team.budget})${deps}`);
    }
    console.log(chalk.dim(`\n  Edit the TODO sections in each task, then run:`));
    console.log(chalk.cyan(`  jarble-dev team-run ${opts.output}\n`));
  });

program.parse();
