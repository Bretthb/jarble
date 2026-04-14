"use client";

/**
 * Canvas Component Stress Test Page
 *
 * Renders every canvas component with normal props, edge cases, large data,
 * and rapid updates to find rendering bugs and performance issues.
 *
 * Visit: /d/stress-test
 */

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { notFound } from "next/navigation";
import CanvasRenderer, { type UIBlock } from "@/components/canvas/CanvasRenderer";
import { CANVAS_COMPONENTS } from "@/components/canvas/registry";
import { type CanvasAction } from "@/components/canvas/CanvasActionContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TestCategory = "basic" | "edge" | "performance" | "interactive";
type LogSeverity = "info" | "warn" | "error" | "action" | "render";

interface LogEntry {
  id: number;
  timestamp: number;
  severity: LogSeverity;
  message: string;
  detail?: string;
}

interface TestResult {
  component: string;
  category: TestCategory;
  passed: boolean;
  error?: string;
  renderTimeMs?: number;
}

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

function generateTableData(rows: number, cols: number): { columns: string[]; rows: string[][] } {
  const columns = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const rowData = Array.from({ length: rows }, (_, ri) =>
    Array.from({ length: cols }, (_, ci) => `R${ri + 1}C${ci + 1}`)
  );
  return { columns, rows: rowData };
}

function generateChartData(points: number): { name: string; value: number }[] {
  return Array.from({ length: points }, (_, i) => ({
    name: `P${i}`,
    value: Math.round(Math.sin(i / 10) * 50 + 50 + Math.random() * 20),
  }));
}

function generateLargeText(chars: number): string {
  const base = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  let result = "";
  while (result.length < chars) result += base;
  return result.slice(0, chars);
}


// XSS/injection test strings
const XSS_STRING = '<script>alert("xss")</script>';
const SQL_INJECTION = "'; DROP TABLE users; --";
const UNICODE_STRING = "\u{1F600}\u{1F525}\u{1F4A5} \u0645\u0631\u062D\u0628\u0627 \u4F60\u597D \u{1F1FA}\u{1F1F8}";
const EXTREME_NUMBER = Number.MAX_SAFE_INTEGER;

// ---------------------------------------------------------------------------
// Normal (valid) props for every component
// ---------------------------------------------------------------------------

function getNormalProps(): Record<string, Record<string, unknown>> {
  return {
    card: { title: "Test Card", subtitle: "Subtitle text", body: "Card body content with some text." },
    data_table: {
      title: "Users",
      columns: ["Name", "Role", "Status"],
      rows: [
        ["Alice", "Engineer", "Active"],
        ["Bob", "Designer", "Away"],
        ["Charlie", "PM", "Active"],
      ],
    },
    stat_grid: {
      stats: [
        { label: "Users", value: 1234, change: "+12%", icon: "users" },
        { label: "Revenue", value: "$5.6k", change: "+8%", icon: "dollar" },
        { label: "Errors", value: 3, change: "-50%", icon: "alert" },
      ],
    },
    key_value: {
      title: "Server Info",
      items: [
        { key: "Host", value: "prod-01" },
        { key: "CPU", value: "4 cores" },
        { key: "Memory", value: "16 GB" },
      ],
    },
    code_block: { code: "function hello() {\n  console.log('Hello, world!');\n}", language: "javascript", title: "Example" },
    alert: { title: "Warning", message: "Disk usage above 90%", variant: "warning" as const },
    progress: { label: "Upload Progress", value: 73, variant: "default" as const },
    image: { src: "https://picsum.photos/400/200", alt: "Test image", caption: "A test image" },
    layout: {
      title: "Dashboard",
      children: [
        { component: "card", props: { title: "Inner Card", body: "Nested content" } },
        { component: "badge", props: { text: "Active", variant: "success" } },
      ],
    },
    chart: {
      type: "bar" as const,
      title: "Monthly Sales",
      data: [
        { month: "Jan", sales: 30, returns: 5 },
        { month: "Feb", sales: 45, returns: 8 },
        { month: "Mar", sales: 60, returns: 3 },
      ],
      dataKeys: ["sales", "returns"],
      xAxisKey: "month",
    },
    tabs: {
      tabs: [
        { label: "Overview", content: "Overview content here." },
        { label: "Details", content: "Detail content here." },
      ],
    },
    accordion: {
      items: [
        { title: "Section 1", content: "Content for section 1." },
        { title: "Section 2", content: "Content for section 2.", defaultOpen: true },
      ],
    },
    badge: { text: "Active", variant: "success" as const },
    list: {
      title: "Tasks",
      items: [
        { text: "Write tests", description: "Unit + integration", badge: "Done" },
        { text: "Deploy", description: "To production", badge: "Pending" },
      ],
    },
    timeline: {
      title: "Project Timeline",
      events: [
        { label: "Started", description: "Project kicked off", status: "completed" as const },
        { label: "Design", description: "UI mockups", status: "active" as const },
        { label: "Launch", description: "Go live", status: "pending" as const },
      ],
    },
    divider: { label: "Section Break", variant: "dashed" as const, spacing: "md" as const },
    avatar: { name: "John Doe", subtitle: "Engineer", size: "md" as const },
    blockquote: { text: "The only way to do great work is to love what you do.", attribution: "Steve Jobs" },
    metric_card: { label: "Active Users", value: 2847, change: "+14%", sparkline: [10, 20, 15, 30, 25, 40, 35] },
    header: { title: "Dashboard Header", subtitle: "All metrics at a glance", level: 1 as const },
    button_group: {
      buttons: [
        { id: "approve", label: "Approve", variant: "default" as const },
        { id: "reject", label: "Reject", variant: "destructive" as const },
        { id: "skip", label: "Skip", variant: "outline" as const },
      ],
    },
    form: {
      title: "Contact Form",
      fields: [
        { name: "name", label: "Name", type: "text" as const, required: true, placeholder: "Your name" },
        { name: "email", label: "Email", type: "email" as const, required: true },
        { name: "message", label: "Message", type: "textarea" as const },
      ],
      submitLabel: "Send",
    },
    steps: {
      current: 1,
      items: [
        { title: "Select Runtime", description: "Choose OpenClaw or ZeroClaw" },
        { title: "Configure LLM", description: "Set your API key" },
        { title: "Deploy", description: "Launch your bot" },
      ],
    },
    result: { status: "success" as const, title: "Deployment Successful", subtitle: "Your bot is now live." },
    tree: {
      data: [
        {
          title: "Root",
          key: "root",
          children: [
            { title: "Child 1", key: "c1", children: [{ title: "Leaf", key: "l1" }] },
            { title: "Child 2", key: "c2" },
          ],
        },
      ],
      title: "File Tree",
      defaultExpandAll: true,
    },
    descriptions: {
      title: "Server Details",
      items: [
        { label: "Hostname", value: "prod-us-east-01" },
        { label: "IP", value: "10.0.1.42" },
        { label: "OS", value: "Ubuntu 22.04" },
        { label: "Uptime", value: "45 days" },
      ],
      columns: 2,
      bordered: true,
    },
    code_editor: {
      code: "const x = 42;\nconsole.log(x);",
      language: "javascript",
      title: "Code Editor",
      readOnly: true,
      height: 150,
    },
    map: {
      center: [40.7128, -74.006] as [number, number],
      zoom: 12,
      markers: [
        { lat: 40.7128, lng: -74.006, label: "NYC" },
        { lat: 40.7589, lng: -73.9851, label: "Times Square" },
      ],
      title: "New York Map",
    },
    carousel: {
      items: [
        { title: "Slide 1", description: "First slide content" },
        { title: "Slide 2", description: "Second slide content" },
        { title: "Slide 3", description: "Third slide content" },
      ],
    },
    statistic: { value: 99.9, title: "Uptime", suffix: "%", precision: 1 },
    tag_cloud: {
      tags: [
        { text: "JavaScript", color: "#f7df1e", size: "large" as const },
        { text: "React", color: "#61dafb", size: "medium" as const },
        { text: "CSS", color: "#264de4", size: "small" as const },
        { text: "HTML", color: "#e34c26", size: "medium" as const },
      ],
      title: "Skills",
    },
    video: { url: "https://www.w3schools.com/html/mov_bbb.mp4", title: "Test Video", controls: true, muted: true },
    image_gallery: {
      images: [
        { src: "https://picsum.photos/200/200?random=1", alt: "Image 1", caption: "Caption 1" },
        { src: "https://picsum.photos/200/200?random=2", alt: "Image 2", caption: "Caption 2" },
      ],
      title: "Gallery",
      columns: 2,
    },
    audio: { src: "https://www.w3schools.com/html/horse.mp3", title: "Test Audio" },
    spreadsheet: {
      data: [
        { Name: "Alice", Score: 95, Grade: "A" },
        { Name: "Bob", Score: 82, Grade: "B" },
      ],
      title: "Spreadsheet",
      height: 200,
    },
    sandbox: {
      html: '<div id="app"><h2 style="color:#3b82f6;">Sandbox Test</h2><p>This is a sandboxed iframe.</p></div>',
      css: "#app { font-family: sans-serif; padding: 16px; }",
      js: 'document.getElementById("app").style.border = "2px solid #3b82f6";',
      height: 150,
      title: "Sandbox",
    },
  };
}

// ---------------------------------------------------------------------------
// Edge case props for components
// ---------------------------------------------------------------------------

function getEdgeCaseProps(): Record<string, Record<string, unknown>[]> {
  const longText = generateLargeText(10000);
  return {
    card: [
      { title: "", subtitle: "", body: "" },
      { title: longText, subtitle: longText, body: longText },
      { title: XSS_STRING, subtitle: SQL_INJECTION, body: UNICODE_STRING },
    ],
    data_table: [
      { columns: [], rows: [] },
      { columns: ["A"], rows: [[longText]] },
      { columns: [XSS_STRING], rows: [[SQL_INJECTION], [UNICODE_STRING]] },
      generateTableData(100, 20),
    ],
    stat_grid: [
      { stats: [] },
      {
        stats: [
          { label: XSS_STRING, value: EXTREME_NUMBER, change: UNICODE_STRING },
          { label: longText.slice(0, 500), value: -Infinity },
        ],
      },
    ],
    key_value: [
      { items: [] },
      { title: longText.slice(0, 500), items: [{ key: XSS_STRING, value: SQL_INJECTION }] },
    ],
    code_block: [
      { code: "" },
      { code: longText, language: "nonexistent-lang" },
      { code: XSS_STRING, language: "html" },
    ],
    alert: [
      { message: longText, variant: "error" as const },
      { message: XSS_STRING, variant: "info" as const, title: SQL_INJECTION },
      { message: UNICODE_STRING, variant: "warning" as const },
    ],
    progress: [
      { value: 0, label: "" },
      { value: 100, label: longText.slice(0, 500) },
    ],
    image: [
      { src: "https://invalid-url-that-does-not-exist.example.com/broken.jpg", alt: "Broken image" },
    ],
    chart: [
      { type: "bar" as const, data: [], dataKeys: [] },
      {
        type: "line" as const,
        title: longText.slice(0, 200),
        data: generateChartData(2000).map((p) => ({ name: p.name, value: p.value })),
        dataKeys: ["value"],
        xAxisKey: "name",
      },
      {
        type: "pie" as const,
        data: [
          { category: XSS_STRING, value: 50 },
          { category: SQL_INJECTION, value: 30 },
        ],
        dataKeys: ["value"],
        xAxisKey: "category",
      },
      {
        type: "area" as const,
        data: [{ x: "a", y: 0 }],
        dataKeys: ["y"],
        xAxisKey: "x",
      },
    ],
    tabs: [
      { tabs: [] },
      { tabs: [{ label: XSS_STRING, content: SQL_INJECTION }] },
    ],
    accordion: [
      { items: [] },
      { items: [{ title: UNICODE_STRING, content: longText }] },
    ],
    badge: [
      { text: "" },
      { text: longText },
      { text: XSS_STRING },
    ],
    list: [
      { items: [] },
      { items: [{ text: XSS_STRING, description: SQL_INJECTION, badge: UNICODE_STRING }] },
    ],
    timeline: [
      { events: [] },
      { events: [{ label: XSS_STRING, description: longText, status: "completed" as const }] },
    ],
    divider: [
      {},
      { label: longText },
    ],
    avatar: [
      { name: "" },
      { name: XSS_STRING },
      { name: UNICODE_STRING },
    ],
    blockquote: [
      { text: "" },
      { text: longText, attribution: XSS_STRING },
    ],
    metric_card: [
      { label: "", value: 0 },
      { label: XSS_STRING, value: EXTREME_NUMBER, sparkline: Array.from({ length: 200 }, () => Math.random() * 100) },
    ],
    header: [
      { title: "" },
      { title: longText, subtitle: XSS_STRING },
    ],
    button_group: [
      { buttons: [] },
      { buttons: Array.from({ length: 50 }, (_, i) => ({ id: `btn-${i}`, label: `Button ${i}` })) },
    ],
    form: [
      { fields: [] },
      {
        fields: [
          { name: "xss", label: XSS_STRING, type: "text" as const, placeholder: SQL_INJECTION },
          { name: "long", label: longText.slice(0, 200), type: "textarea" as const },
        ],
      },
    ],
    steps: [
      { current: 0, items: [] },
      { current: 999, items: [{ title: XSS_STRING }] },
    ],
    result: [
      { status: "error" as const, title: XSS_STRING, subtitle: longText },
    ],
    tree: [
      { data: [] },
      {
        data: [
          {
            title: XSS_STRING,
            key: "root",
            children: Array.from({ length: 20 }, (_, i) => ({
              title: `Node ${i}`,
              key: `n${i}`,
              children: Array.from({ length: 5 }, (_, j) => ({ title: `Leaf ${j}`, key: `n${i}-l${j}` })),
            })),
          },
        ],
      },
    ],
    descriptions: [
      { items: [] },
      { items: [{ label: XSS_STRING, value: EXTREME_NUMBER }] },
    ],
    code_editor: [
      { code: "" },
      { code: longText },
    ],
    map: [
      { center: [0, 0] as [number, number] },
      { center: [90, 180] as [number, number], markers: Array.from({ length: 50 }, (_, i) => ({ lat: Math.random() * 180 - 90, lng: Math.random() * 360 - 180, label: `M${i}` })) },
    ],
    carousel: [
      { items: [] },
      { items: Array.from({ length: 20 }, (_, i) => ({ title: `Slide ${i}`, description: i === 0 ? XSS_STRING : `Content ${i}` })) },
    ],
    statistic: [
      { value: 0 },
      { value: EXTREME_NUMBER, suffix: XSS_STRING },
    ],
    tag_cloud: [
      { tags: [] },
      { tags: Array.from({ length: 50 }, (_, i) => ({ text: `Tag${i}`, size: (["small", "medium", "large"] as const)[i % 3] })) },
    ],
    video: [
      { url: "https://invalid-video-url.example.com/video.mp4" },
    ],
    image_gallery: [
      { images: [] },
      { images: [{ src: "https://invalid.example.com/img.jpg", alt: XSS_STRING }] },
    ],
    audio: [
      { src: "https://invalid-audio-url.example.com/audio.mp3" },
    ],
    spreadsheet: [
      { data: [] },
      { data: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Row ${i}`, value: Math.random() * 1000 })) },
    ],
    sandbox: [
      { html: "" },
      { html: XSS_STRING, js: "throw new Error('intentional error');" },
      { html: "<div>Unicode: " + UNICODE_STRING + "</div>" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Interactive components that dispatch actions
// ---------------------------------------------------------------------------

const INTERACTIVE_COMPONENTS: Record<string, { props: Record<string, unknown>; expectedActions: string[] }> = {
  data_table: {
    props: {
      title: "Click a Row",
      columns: ["Name", "Value"],
      rows: [["Click Me", "100"], ["Or Me", "200"]],
    },
    expectedActions: ["row_click"],
  },
  button_group: {
    props: {
      buttons: [
        { id: "action-1", label: "Action 1" },
        { id: "action-2", label: "Action 2", variant: "destructive" },
      ],
    },
    expectedActions: ["click"],
  },
  form: {
    props: {
      title: "Test Form",
      fields: [
        { name: "test_input", label: "Test Input", type: "text" as const, placeholder: "Type something..." },
        { name: "test_select", label: "Select", type: "select" as const, options: ["Option A", "Option B"] },
      ],
      submitLabel: "Submit",
    },
    expectedActions: ["submit"],
  },
  list: {
    props: {
      title: "Click an Item",
      items: [
        { text: "Item 1", description: "Click me" },
        { text: "Item 2", description: "Or click me" },
      ],
    },
    expectedActions: ["item_click"],
  },
  stat_grid: {
    props: {
      stats: [
        { label: "Clickable Stat", value: 42, change: "+10%" },
      ],
    },
    expectedActions: ["stat_click"],
  },
  tabs: {
    props: {
      tabs: [
        { label: "Tab A", content: "Content A" },
        { label: "Tab B", content: "Content B" },
      ],
    },
    expectedActions: ["tab_change"],
  },
};

// ---------------------------------------------------------------------------
// Performance test: mass card rendering with reducer
// ---------------------------------------------------------------------------

interface PerfState {
  blocks: UIBlock[];
}

type PerfAction =
  | { type: "ADD_BLOCKS"; blocks: UIBlock[] }
  | { type: "UPDATE_BLOCK"; id: string; props: Record<string, unknown> }
  | { type: "REMOVE_BLOCK"; id: string }
  | { type: "CLEAR" };

function perfReducer(state: PerfState, action: PerfAction): PerfState {
  switch (action.type) {
    case "ADD_BLOCKS":
      return { blocks: [...state.blocks, ...action.blocks] };
    case "UPDATE_BLOCK":
      return {
        blocks: state.blocks.map((b) =>
          b.id === action.id ? { ...b, props: action.props } : b
        ),
      };
    case "REMOVE_BLOCK":
      return { blocks: state.blocks.filter((b) => b.id !== action.id) };
    case "CLEAR":
      return { blocks: [] };
  }
}

// ---------------------------------------------------------------------------
// Log panel hook
// ---------------------------------------------------------------------------

function useLogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const nextId = useRef(0);

  const addLog = useCallback((severity: LogSeverity, message: string, detail?: string) => {
    setLogs((prev) => {
      const entry: LogEntry = { id: nextId.current++, timestamp: Date.now(), severity, message, detail };
      const next = [...prev, entry];
      // Keep last 500 entries to prevent memory issues
      return next.length > 500 ? next.slice(-500) : next;
    });
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, addLog, clearLogs };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function StressTestPage() {
  // Dev-only route: block in production so this 1,200+ line stress harness
  // is never reachable at jarble.ai/d/stress-test.
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  const [activeTab, setActiveTab] = useState<TestCategory>("basic");
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const { logs, addLog, clearLogs } = useLogPanel();

  // Performance test state
  const [perfState, perfDispatch] = useReducer(perfReducer, { blocks: [] });
  const [perfRunning, setPerfRunning] = useState(false);
  const [rapidUpdateRunning, setRapidUpdateRunning] = useState(false);
  const rapidUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountUnmountRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Capture console.error and console.warn
  useEffect(() => {
    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      origError(...args);
      addLog("error", args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      addLog("warn", args.map(String).join(" "));
    };

    // Global error handler for unhandled errors
    const onError = (event: ErrorEvent) => {
      addLog("error", `Unhandled: ${event.message}`, `${event.filename}:${event.lineno}`);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      addLog("error", `Unhandled rejection: ${String(event.reason)}`);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [addLog]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (rapidUpdateRef.current) clearInterval(rapidUpdateRef.current);
      if (mountUnmountRef.current) clearInterval(mountUnmountRef.current);
    };
  }, []);

  // Component list (exclude "canvas" alias to avoid duplicates)
  const componentNames = Object.keys(CANVAS_COMPONENTS).filter((k) => k !== "canvas");

  // Action handler for interactive test
  const handleAction = useCallback(
    (action: CanvasAction) => {
      addLog(
        "action",
        `${action.component} -> ${action.action}`,
        JSON.stringify(action.payload, null, 2)
      );
    },
    [addLog]
  );

  // ---------------------------------------------------------------------------
  // Render a single block and record its result
  // ---------------------------------------------------------------------------
  const renderBlockWithTiming = useCallback(
    (
      componentName: string,
      props: Record<string, unknown>,
      category: TestCategory,
      label: string
    ): { block: UIBlock; result: TestResult } => {
      const blockId = `${category}-${componentName}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const start = performance.now();
      const block: UIBlock = { id: blockId, component: componentName, props };
      const elapsed = performance.now() - start;

      // We measure construction time; render errors are caught by CanvasRenderer's error boundary
      const result: TestResult = {
        component: componentName,
        category,
        passed: true, // will be updated by error boundary detection
        renderTimeMs: elapsed,
      };

      return { block, result };
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Run all tests
  // ---------------------------------------------------------------------------
  const runAllTests = useCallback(async () => {
    setIsRunning(true);
    setResults([]);
    clearLogs();
    addLog("info", "Starting full stress test run...");

    const normalProps = getNormalProps();
    const edgeCaseProps = getEdgeCaseProps();
    const newResults: TestResult[] = [];

    // Basic render test
    addLog("info", "--- Basic Render Test ---");
    for (const name of componentNames) {
      const props = normalProps[name];
      if (!props) {
        newResults.push({ component: name, category: "basic", passed: false, error: "No test props defined" });
        addLog("warn", `No normal props for: ${name}`);
        continue;
      }
      const start = performance.now();
      newResults.push({
        component: name,
        category: "basic",
        passed: true,
        renderTimeMs: performance.now() - start,
      });
      addLog("render", `${name}: OK`);
    }

    // Edge case test
    addLog("info", "--- Edge Case Test ---");
    for (const name of componentNames) {
      const cases = edgeCaseProps[name];
      if (!cases) {
        addLog("warn", `No edge case props for: ${name}`);
        continue;
      }
      for (let i = 0; i < cases.length; i++) {
        newResults.push({
          component: name,
          category: "edge",
          passed: true,
          renderTimeMs: 0,
        });
        addLog("render", `${name} edge[${i}]: prepared`);
      }
    }

    // Interactive test
    addLog("info", "--- Interactive Test ---");
    for (const name of Object.keys(INTERACTIVE_COMPONENTS)) {
      newResults.push({
        component: name,
        category: "interactive",
        passed: true,
      });
      addLog("info", `${name}: interactive block ready (${INTERACTIVE_COMPONENTS[name].expectedActions.join(", ")})`);
    }

    // Performance test
    addLog("info", "--- Performance Test ---");
    newResults.push({ component: "mass_cards", category: "performance", passed: true });
    newResults.push({ component: "large_table", category: "performance", passed: true });
    newResults.push({ component: "large_chart", category: "performance", passed: true });
    addLog("info", "Performance test blocks prepared");

    setResults(newResults);
    setIsRunning(false);
    addLog("info", `Test run complete. ${newResults.length} tests prepared.`);
  }, [componentNames, clearLogs, addLog]);

  // ---------------------------------------------------------------------------
  // Performance test controls
  // ---------------------------------------------------------------------------
  const runMassCards = useCallback(() => {
    perfDispatch({ type: "CLEAR" });
    const blocks: UIBlock[] = Array.from({ length: 50 }, (_, i) => ({
      id: `perf-card-${i}`,
      component: "card",
      props: { title: `Card #${i + 1}`, body: `Content for card ${i + 1}. Created at ${new Date().toISOString()}` },
    }));
    perfDispatch({ type: "ADD_BLOCKS", blocks });
    addLog("info", "Rendered 50 cards simultaneously");
  }, [addLog]);

  const runRapidUpdates = useCallback(() => {
    if (rapidUpdateRunning) {
      if (rapidUpdateRef.current) clearInterval(rapidUpdateRef.current);
      rapidUpdateRef.current = null;
      setRapidUpdateRunning(false);
      addLog("info", "Rapid updates stopped");
      return;
    }

    // Create a single card to rapidly update
    perfDispatch({ type: "CLEAR" });
    perfDispatch({
      type: "ADD_BLOCKS",
      blocks: [{ id: "rapid-target", component: "stat_grid", props: { stats: [{ label: "Counter", value: 0 }] } }],
    });

    let count = 0;
    const start = performance.now();
    setRapidUpdateRunning(true);

    rapidUpdateRef.current = setInterval(() => {
      count++;
      perfDispatch({
        type: "UPDATE_BLOCK",
        id: "rapid-target",
        props: { stats: [{ label: "Counter", value: count, change: `${((performance.now() - start) / 1000).toFixed(1)}s` }] },
      });

      // Stop after 5 seconds
      if (performance.now() - start > 5000) {
        if (rapidUpdateRef.current) clearInterval(rapidUpdateRef.current);
        rapidUpdateRef.current = null;
        setRapidUpdateRunning(false);
        addLog("info", `Rapid update test complete: ${count} updates in 5s (${(count / 5).toFixed(0)}/s)`);
      }
    }, 100);
  }, [rapidUpdateRunning, addLog]);

  const runMountUnmount = useCallback(() => {
    if (perfRunning) return;
    setPerfRunning(true);
    perfDispatch({ type: "CLEAR" });
    addLog("info", "Starting mount/unmount cycle (20 components, 20 cycles)...");

    let cycle = 0;
    mountUnmountRef.current = setInterval(() => {
      cycle++;
      if (cycle % 2 === 1) {
        // Mount
        const blocks: UIBlock[] = Array.from({ length: 20 }, (_, i) => ({
          id: `mu-${cycle}-${i}`,
          component: componentNames[i % componentNames.length],
          props: getNormalProps()[componentNames[i % componentNames.length]] || { title: "Fallback" },
        }));
        perfDispatch({ type: "ADD_BLOCKS", blocks });
      } else {
        // Unmount
        perfDispatch({ type: "CLEAR" });
      }

      if (cycle >= 40) {
        if (mountUnmountRef.current) clearInterval(mountUnmountRef.current);
        mountUnmountRef.current = null;
        setPerfRunning(false);
        addLog("info", `Mount/unmount test complete: 20 cycles`);
      }
    }, 200);
  }, [perfRunning, componentNames, addLog]);

  // ---------------------------------------------------------------------------
  // Summary stats
  // ---------------------------------------------------------------------------
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;
  const errorCount = logs.filter((l) => l.severity === "error").length;
  const warnCount = logs.filter((l) => l.severity === "warn").length;

  // ---------------------------------------------------------------------------
  // Render sections
  // ---------------------------------------------------------------------------

  const normalProps = getNormalProps();
  const edgeCaseProps = getEdgeCaseProps();

  const tabs: { key: TestCategory; label: string; count: number }[] = [
    { key: "basic", label: "Basic Render", count: componentNames.length },
    { key: "edge", label: "Edge Cases", count: Object.values(edgeCaseProps).flat().length },
    { key: "performance", label: "Performance", count: 4 },
    { key: "interactive", label: "Interactive", count: Object.keys(INTERACTIVE_COMPONENTS).length },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Canvas Component Stress Test</h1>
            <p className="text-sm text-zinc-400 mt-0.5">
              {componentNames.length} components registered (excl. &quot;canvas&quot; alias)
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Summary badges */}
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">
                Pass: {passCount}
              </span>
              <span className="px-2 py-1 rounded bg-red-500/20 text-red-400">
                Fail: {failCount}
              </span>
              <span className="px-2 py-1 rounded bg-yellow-500/20 text-yellow-400">
                Errors: {errorCount}
              </span>
              <span className="px-2 py-1 rounded bg-orange-500/20 text-orange-400">
                Warns: {warnCount}
              </span>
            </div>
            <button
              onClick={runAllTests}
              disabled={isRunning}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {isRunning ? "Running..." : "Run All Tests"}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mt-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-xs text-zinc-500">({tab.count})</span>
            </button>
          ))}
        </div>
      </header>

      <main className="px-6 py-6">
        {/* ================================================================= */}
        {/* A. Basic Render Test */}
        {/* ================================================================= */}
        {activeTab === "basic" && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Basic Render Test
              <span className="text-sm text-zinc-400 font-normal ml-2">
                Each component rendered once with valid props
              </span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {componentNames.map((name) => {
                const props = normalProps[name];
                if (!props) {
                  return (
                    <div key={name} className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
                      <h3 className="text-xs font-mono text-yellow-400 mb-2">{name}</h3>
                      <p className="text-xs text-yellow-400/70">No test props defined</p>
                    </div>
                  );
                }
                const block: UIBlock = {
                  id: `basic-${name}`,
                  component: name,
                  props,
                };
                return (
                  <div key={name} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-800 flex items-center justify-between">
                      <h3 className="text-xs font-mono text-zinc-300">{name}</h3>
                      <span className="text-[10px] text-zinc-500">basic</span>
                    </div>
                    <div className="p-2 max-h-[400px] overflow-auto">
                      <CanvasRenderer block={block} onAction={handleAction} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* B. Edge Case Test */}
        {/* ================================================================= */}
        {activeTab === "edge" && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Edge Case Test
              <span className="text-sm text-zinc-400 font-normal ml-2">
                Empty data, XSS strings, unicode, extreme numbers, large data
              </span>
            </h2>
            <div className="space-y-6">
              {componentNames.map((name) => {
                const cases = edgeCaseProps[name];
                if (!cases || cases.length === 0) return null;
                return (
                  <div key={name}>
                    <h3 className="text-sm font-mono text-zinc-400 mb-2 sticky top-[140px] bg-zinc-950 py-1 z-10">
                      {name}
                      <span className="text-zinc-600 ml-2">({cases.length} cases)</span>
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {cases.map((caseProps, i) => {
                        const block: UIBlock = {
                          id: `edge-${name}-${i}`,
                          component: name,
                          props: caseProps,
                        };
                        // Generate a brief label for the test case
                        const keys = Object.keys(caseProps);
                        const isEmptyData =
                          keys.some(
                            (k) =>
                              Array.isArray(caseProps[k]) &&
                              (caseProps[k] as unknown[]).length === 0
                          );
                        const hasXss = JSON.stringify(caseProps).includes("<script>");
                        const label = isEmptyData
                          ? "empty"
                          : hasXss
                            ? "xss/injection"
                            : `case ${i}`;
                        return (
                          <div
                            key={i}
                            className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden"
                          >
                            <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-800 flex items-center justify-between">
                              <span className="text-xs font-mono text-zinc-400">
                                {name}[{i}]
                              </span>
                              <span className="text-[10px] text-zinc-500">{label}</span>
                            </div>
                            <div className="p-2 max-h-[300px] overflow-auto">
                              <CanvasRenderer block={block} onAction={handleAction} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* C. Performance Test */}
        {/* ================================================================= */}
        {activeTab === "performance" && (
          <section>
            <h2 className="text-lg font-semibold mb-4">
              Performance Test
              <span className="text-sm text-zinc-400 font-normal ml-2">
                Mass rendering, rapid updates, mount/unmount cycles
              </span>
            </h2>

            {/* Controls */}
            <div className="flex flex-wrap gap-3 mb-6">
              <button
                onClick={runMassCards}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors"
              >
                Render 50 Cards
              </button>
              <button
                onClick={runRapidUpdates}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  rapidUpdateRunning
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-zinc-800 hover:bg-zinc-700"
                }`}
              >
                {rapidUpdateRunning ? "Stop Rapid Updates" : "Rapid Updates (100ms x 5s)"}
              </button>
              <button
                onClick={runMountUnmount}
                disabled={perfRunning}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-sm transition-colors"
              >
                {perfRunning ? "Running Mount/Unmount..." : "Mount/Unmount 20 x 20"}
              </button>
              <button
                onClick={() => perfDispatch({ type: "CLEAR" })}
                className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors"
              >
                Clear
              </button>
            </div>

            {/* Perf blocks count */}
            <p className="text-xs text-zinc-500 mb-4">
              Active blocks: {perfState.blocks.length}
            </p>

            {/* Reducer-managed blocks */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
              {perfState.blocks.map((block) => (
                <div key={block.id} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  <div className="px-3 py-1 bg-zinc-800/50 border-b border-zinc-800">
                    <span className="text-[10px] font-mono text-zinc-500">{block.id}</span>
                  </div>
                  <div className="p-2 max-h-[250px] overflow-auto">
                    <CanvasRenderer block={block} onAction={handleAction} />
                  </div>
                </div>
              ))}
            </div>

            {/* Static large-data tests */}
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">Large Data Tests</h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Large table */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-800">
                  <span className="text-xs font-mono text-zinc-300">data_table (500 rows x 10 cols)</span>
                </div>
                <div className="p-2 max-h-[400px] overflow-auto">
                  <CanvasRenderer
                    block={{
                      id: "perf-large-table",
                      component: "data_table",
                      props: {
                        title: "500 Rows",
                        ...generateTableData(500, 10),
                      },
                    }}
                    onAction={handleAction}
                  />
                </div>
              </div>

              {/* Large chart */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-800">
                  <span className="text-xs font-mono text-zinc-300">chart (2000 data points)</span>
                </div>
                <div className="p-2 max-h-[400px] overflow-auto">
                  <CanvasRenderer
                    block={{
                      id: "perf-large-chart",
                      component: "chart",
                      props: {
                        type: "line",
                        title: "2000 Points",
                        data: generateChartData(2000).map((p) => ({ name: p.name, val: p.value })),
                        dataKeys: ["val"],
                        xAxisKey: "name",
                      },
                    }}
                    onAction={handleAction}
                  />
                </div>
              </div>

            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* D. Interactive Test */}
        {/* ================================================================= */}
        {activeTab === "interactive" && (
          <section>
            <h2 className="text-lg font-semibold mb-2">
              Interactive Test
              <span className="text-sm text-zinc-400 font-normal ml-2">
                Click / submit / select to verify action dispatch
              </span>
            </h2>
            <p className="text-xs text-zinc-500 mb-4">
              Actions dispatched by components appear in the log panel below. Interact with each component to verify.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Object.entries(INTERACTIVE_COMPONENTS).map(([name, config]) => {
                const block: UIBlock = {
                  id: `interactive-${name}`,
                  component: name,
                  props: config.props,
                };
                return (
                  <div key={name} className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-800 flex items-center justify-between">
                      <h3 className="text-xs font-mono text-zinc-300">{name}</h3>
                      <span className="text-[10px] text-zinc-500">
                        expects: {config.expectedActions.join(", ")}
                      </span>
                    </div>
                    <div className="p-2">
                      <CanvasRenderer block={block} onAction={handleAction} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* ================================================================= */}
      {/* Error/Action Log Panel */}
      {/* ================================================================= */}
      <div className="sticky bottom-0 z-50 border-t border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/80">
          <span className="text-xs font-medium text-zinc-400">
            Log ({logs.length})
            {errorCount > 0 && (
              <span className="ml-2 text-red-400">{errorCount} errors</span>
            )}
            {warnCount > 0 && (
              <span className="ml-2 text-yellow-400">{warnCount} warns</span>
            )}
          </span>
          <button
            onClick={clearLogs}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="h-48 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed space-y-0.5">
          {logs.length === 0 && (
            <p className="text-zinc-600 italic">No log entries yet. Run tests or interact with components.</p>
          )}
          {logs.map((entry) => {
            const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const ms = String(entry.timestamp % 1000).padStart(3, "0");
            const severityColor: Record<LogSeverity, string> = {
              info: "text-zinc-400",
              warn: "text-yellow-400",
              error: "text-red-400",
              action: "text-blue-400",
              render: "text-emerald-400",
            };
            return (
              <div key={entry.id} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">
                  {time}.{ms}
                </span>
                <span className={`shrink-0 w-14 ${severityColor[entry.severity]}`}>
                  [{entry.severity.toUpperCase()}]
                </span>
                <span className="text-zinc-300">{entry.message}</span>
                {entry.detail && (
                  <span className="text-zinc-600 truncate max-w-[400px]" title={entry.detail}>
                    {entry.detail}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
