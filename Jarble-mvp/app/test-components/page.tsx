"use client";

import CanvasAlert from "@/components/canvas/components/CanvasAlert";
import CanvasProgress from "@/components/canvas/components/CanvasProgress";
import CanvasTimeline from "@/components/canvas/components/CanvasTimeline";
import CanvasList from "@/components/canvas/components/CanvasList";
import CanvasDataTable from "@/components/canvas/components/CanvasDataTable";
import CanvasHeader from "@/components/canvas/components/CanvasHeader";
import CanvasCodeBlock from "@/components/canvas/components/CanvasCodeBlock";
import CanvasMetricCard from "@/components/canvas/components/CanvasMetricCard";
import CanvasStatGrid from "@/components/canvas/components/CanvasStatGrid";
// ── Newly registered components ──────────────────────────────────────
import CanvasAudio from "@/components/canvas/components/CanvasAudio";
import CanvasAvatar from "@/components/canvas/components/CanvasAvatar";
import CanvasBlockquote from "@/components/canvas/components/CanvasBlockquote";
import CanvasTextMessage from "@/components/canvas/components/CanvasTextMessage";
import dynamic from "next/dynamic";

const CanvasImageGallery = dynamic(() => import("@/components/canvas/components/CanvasImageGallery"), { ssr: false });
const CanvasDescriptions = dynamic(() => import("@/components/canvas/components/CanvasDescriptions"), { ssr: false });
const CanvasSteps = dynamic(() => import("@/components/canvas/components/CanvasSteps"), { ssr: false });
const CanvasResult = dynamic(() => import("@/components/canvas/components/CanvasResult"), { ssr: false });
const CanvasCarousel = dynamic(() => import("@/components/canvas/components/CanvasCarousel"), { ssr: false });
const CanvasStatistic = dynamic(() => import("@/components/canvas/components/CanvasStatistic"), { ssr: false });
const CanvasTagCloud = dynamic(() => import("@/components/canvas/components/CanvasTagCloud"), { ssr: false });
const CanvasMap = dynamic(() => import("@/components/canvas/components/CanvasMap"), { ssr: false });

export default function TestComponentsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Canvas Component Visual Test</h1>
      <p className="text-sm text-muted-foreground mb-8">36 registered components — existing + 12 newly registered</p>

      {/* ══════════════════════════════════════════════════════════════════ */}
      <h2 className="text-xl font-bold mt-12 mb-4 pt-8 border-t-2 border-primary/30">NEW: 12 Newly Registered Components</h2>

      {/* Avatar */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasAvatar</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-border/40 p-4">
          <CanvasAvatar name="Jane Smith" subtitle="Senior Engineer" size="lg" />
          <CanvasAvatar name="Bob Chen" subtitle="Product Manager" size="md" />
          <CanvasAvatar name="Alice K" subtitle="Designer" size="sm" />
        </div>
      </section>

      {/* Blockquote */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasBlockquote</p>
        <div className="space-y-3 rounded-lg border border-border/40 p-4">
          <CanvasBlockquote text="The best way to predict the future is to invent it." attribution="Alan Kay" variant="default" />
          <CanvasBlockquote text="Move fast and break things. Unless you are breaking stuff, you are not moving fast enough." attribution="Mark Zuckerberg" variant="info" />
          <CanvasBlockquote text="Premature optimization is the root of all evil." attribution="Donald Knuth" variant="warning" />
        </div>
      </section>

      {/* Text Message */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasTextMessage</p>
        <div className="rounded-lg border border-border/40 p-4">
          <CanvasTextMessage
            botText="I've analyzed your deployment metrics. Here's what I found:\n\n- **Uptime**: 99.97% over the last 30 days\n- **Response time**: Average 45ms\n- **Error rate**: 0.02%\n\nOverall, your bot is performing well!"
            userText="How is my bot performing?"
          />
        </div>
      </section>

      {/* Audio */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasAudio</p>
        <div className="rounded-lg border border-border/40 p-4">
          <CanvasAudio src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" title="Sample Audio Track" />
        </div>
      </section>

      {/* Steps */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasSteps</p>
        <div className="rounded-lg border border-border/40 p-4">
          <CanvasSteps
            current={1}
            items={[
              { title: "Select Runtime", description: "Choose OpenClaw or ZeroClaw" },
              { title: "Configure LLM", description: "Set provider and model" },
              { title: "Set API Key", description: "Add your API credentials" },
              { title: "Deploy", description: "Launch your bot" },
            ]}
          />
        </div>
      </section>

      {/* Result */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasResult</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border/40">
            <CanvasResult status="success" title="Deployment Successful" subtitle="Your bot is now live on all channels" />
          </div>
          <div className="rounded-lg border border-border/40">
            <CanvasResult status="error" title="Build Failed" subtitle="Check your configuration and try again" />
          </div>
        </div>
      </section>

      {/* Statistic */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasStatistic</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border/40">
            <CanvasStatistic value={99.97} title="Uptime" suffix="%" precision={2} />
          </div>
          <div className="rounded-lg border border-border/40">
            <CanvasStatistic value={12400} title="Requests/sec" />
          </div>
          <div className="rounded-lg border border-border/40">
            <CanvasStatistic value={45} title="Avg Latency" suffix="ms" />
          </div>
          <div className="rounded-lg border border-border/40">
            <CanvasStatistic value="$2.4M" title="Revenue" />
          </div>
        </div>
      </section>

      {/* Tag Cloud */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasTagCloud</p>
        <div className="rounded-lg border border-border/40 p-4">
          <CanvasTagCloud
            title="Technology Stack"
            tags={[
              { text: "React", size: "large" },
              { text: "TypeScript", size: "large", color: "#2db7f5" },
              { text: "Next.js", size: "medium" },
              { text: "tRPC", color: "#87d068" },
              { text: "Tailwind CSS", size: "medium" },
              { text: "Zod", size: "small" },
              { text: "Drizzle ORM" },
              { text: "Docker", color: "#108ee9" },
              { text: "K3s", size: "small" },
              { text: "Playwright", color: "#ff85c0" },
            ]}
          />
        </div>
      </section>

      {/* Descriptions */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasDescriptions</p>
        <div className="rounded-lg border border-border/40">
          <CanvasDescriptions
            title="Server Configuration"
            items={[
              { label: "Hostname", value: "prod-us-east-1.jarble.ai" },
              { label: "Status", value: "Running" },
              { label: "CPU Cores", value: 4 },
              { label: "Memory", value: "16 GB" },
              { label: "Storage", value: "100 GB SSD" },
              { label: "Uptime", value: "47 days" },
            ]}
            columns={2}
            bordered
          />
        </div>
      </section>

      {/* Carousel */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasCarousel</p>
        <div className="rounded-lg border border-border/40">
          <CanvasCarousel
            items={[
              { title: "Getting Started", description: "Set up your first AI bot in minutes with our guided wizard.", image: "https://placehold.co/400x200/1a1a2e/e0e0e0?text=Getting+Started" },
              { title: "Configure Your LLM", description: "Choose from Claude, GPT-4, Gemini, and more — or bring your own key.", image: "https://placehold.co/400x200/16213e/e0e0e0?text=Configure+LLM" },
              { title: "Deploy & Connect", description: "One-click deploy to WhatsApp, Discord, Slack, and Telegram.", image: "https://placehold.co/400x200/0f3460/e0e0e0?text=Deploy" },
            ]}
            autoplay
          />
        </div>
      </section>

      {/* Image Gallery */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasImageGallery</p>
        <div className="rounded-lg border border-border/40">
          <CanvasImageGallery
            title="Architecture Diagrams"
            images={[
              { src: "https://placehold.co/300x200/2d3436/dfe6e9?text=Frontend", alt: "Frontend", caption: "Next.js Frontend" },
              { src: "https://placehold.co/300x200/0984e3/dfe6e9?text=API", alt: "API", caption: "tRPC API Layer" },
              { src: "https://placehold.co/300x200/00b894/dfe6e9?text=K8s", alt: "K8s", caption: "K8s Cluster" },
              { src: "https://placehold.co/300x200/6c5ce7/dfe6e9?text=MCP", alt: "MCP", caption: "MCP UI Server" },
              { src: "https://placehold.co/300x200/e17055/dfe6e9?text=Bot", alt: "Bot", caption: "OpenClaw Runtime" },
              { src: "https://placehold.co/300x200/fdcb6e/2d3436?text=DB", alt: "DB", caption: "Database Layer" },
            ]}
            columns={3}
          />
        </div>
      </section>

      {/* Map */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasMap</p>
        <div className="rounded-lg border border-border/40" style={{ height: 400 }}>
          <CanvasMap
            center={[37.7749, -122.4194]}
            zoom={12}
            title="San Francisco Office"
            markers={[
              { lat: 37.7749, lng: -122.4194, label: "HQ" },
              { lat: 37.7849, lng: -122.4094, label: "Data Center" },
              { lat: 37.7649, lng: -122.4294, label: "Satellite Office" },
            ]}
          />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════════ */}
      <h2 className="text-xl font-bold mt-12 mb-4 pt-8 border-t-2 border-border">Existing Components</h2>

      {/* Header */}
      <section data-testid="header-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasHeader</p>
        <div className="space-y-4">
          <CanvasHeader title="Sales Analytics Dashboard" subtitle="Real-time metrics and insights" level={1} />
          <CanvasHeader title="Section Header" subtitle="Level 2 heading" level={2} />
          <CanvasHeader title="Subsection" level={3} divider />
        </div>
      </section>

      {/* Alert */}
      <section data-testid="alert-section" className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasAlert</p>
        <CanvasAlert variant="info" title="System Update" message="A new version is available." />
        <CanvasAlert variant="success" title="Deployment Complete" message="Your bot has been successfully deployed." />
        <CanvasAlert variant="warning" title="Rate Limit Warning" message="Approaching your API rate limit." />
        <CanvasAlert variant="error" title="Connection Failed" message="Unable to reach the database server." />
      </section>

      {/* Progress */}
      <section data-testid="progress-section" className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasProgress</p>
        <div className="grid grid-cols-2 gap-4">
          <CanvasProgress label="Design Phase" value={92} variant="success" />
          <CanvasProgress label="Development" value={67} />
          <CanvasProgress label="Testing" value={35} variant="warning" />
          <CanvasProgress label="Critical Bug Fix" value={15} variant="error" />
        </div>
      </section>

      {/* Stat Grid */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasStatGrid</p>
        <div className="rounded-lg border border-border/40">
          <CanvasStatGrid
            stats={[
              { label: "CPU Usage", value: "42%", change: "-3%" },
              { label: "Memory", value: "6.2 GB", change: "+0.4 GB" },
              { label: "Network", value: "2.1 Gbps", change: "+15%" },
              { label: "Uptime", value: "99.97%" },
            ]}
          />
        </div>
      </section>

      {/* Metric Cards */}
      <section className="space-y-3">
        <p className="text-xs text-muted-foreground mb-2">CanvasMetricCard</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Revenue" value="$2.4M" change="+12.5%" trend="up" />
          </div>
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Users" value="18,420" change="+8.3%" trend="up" />
          </div>
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Churn Rate" value="2.1%" change="-0.4%" trend="down" />
          </div>
        </div>
      </section>

      {/* CodeBlock */}
      <section data-testid="codeblock-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasCodeBlock</p>
        <CanvasCodeBlock
          title="fibonacci.py"
          language="python"
          code={`def fibonacci(n: int) -> list[int]:
    if n <= 0: return []
    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib`}
        />
      </section>

      {/* DataTable */}
      <section data-testid="datatable-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasDataTable</p>
        <CanvasDataTable
          title="Team Members"
          columns={["Name", "Role", "Status"]}
          rows={[
            ["Alice Chen", "Engineer", "Active"],
            ["Bob Martinez", "PM", "Active"],
            ["Carol Kim", "Designer", "On Leave"],
          ]}
        />
      </section>

      {/* Timeline */}
      <section data-testid="timeline-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasTimeline</p>
        <CanvasTimeline
          title="Project Milestones"
          events={[
            { label: "Requirements Gathered", timestamp: "Jan 15", status: "completed" },
            { label: "Design Approved", timestamp: "Feb 1", status: "completed" },
            { label: "Backend API Dev", timestamp: "Feb 20", status: "active" },
            { label: "QA & Launch", timestamp: "Mar 25", status: "pending" },
          ]}
        />
      </section>

      {/* List */}
      <section data-testid="list-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasList</p>
        <CanvasList
          title="Quick Actions"
          items={[
            { text: "Deploy to Production", icon: "🚀", badge: "Ready", badgeVariant: "success" },
            { text: "Run Test Suite", icon: "🧪", description: "142 tests" },
            { text: "Review PRs", icon: "📝", badge: "3 pending", badgeVariant: "warning" },
          ]}
        />
      </section>
    </div>
  );
}
