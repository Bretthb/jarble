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

export default function TestComponentsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">Canvas Component Visual Test</h1>

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
        <CanvasAlert variant="info" title="System Update" message="A new version is available. Please update at your earliest convenience." />
        <CanvasAlert variant="success" title="Deployment Complete" message="Your bot has been successfully deployed to all channels." />
        <CanvasAlert variant="warning" title="Rate Limit Warning" message="You are approaching your API rate limit. Consider upgrading your plan." />
        <CanvasAlert variant="error" title="Connection Failed" message="Unable to reach the database server. Retrying in 30 seconds." />
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

      {/* Timeline */}
      <section data-testid="timeline-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasTimeline</p>
        <CanvasTimeline
          title="Project Milestones"
          events={[
            { label: "Requirements Gathered", description: "All stakeholder interviews completed", timestamp: "Jan 15", status: "completed" },
            { label: "Design Approved", description: "UI/UX mockups signed off by team lead", timestamp: "Feb 1", status: "completed" },
            { label: "Backend API Development", description: "Building core REST endpoints and database schema", timestamp: "Feb 20", status: "active" },
            { label: "Frontend Integration", timestamp: "Mar 10", status: "pending" },
            { label: "QA & Launch", description: "Final testing and production deployment", timestamp: "Mar 25", status: "pending" },
          ]}
        />
      </section>

      {/* List */}
      <section data-testid="list-section" className="grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-muted-foreground mb-2">CanvasList (ordered)</p>
          <CanvasList
            title="Top Languages"
            ordered
            items={[
              { text: "TypeScript", description: "Strongly typed JavaScript", badge: "Popular", badgeVariant: "info" },
              { text: "Python", description: "Versatile scripting language", badge: "Trending", badgeVariant: "success" },
              { text: "Rust", description: "Memory-safe systems language", badge: "Growing", badgeVariant: "warning" },
              { text: "Go", description: "Fast compiled language" },
              { text: "Swift", description: "Apple ecosystem" },
            ]}
          />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-2">CanvasList (unordered with icons)</p>
          <CanvasList
            title="Quick Actions"
            items={[
              { text: "Deploy to Production", icon: "🚀", badge: "Ready", badgeVariant: "success" },
              { text: "Run Test Suite", icon: "🧪", description: "142 tests across 8 modules" },
              { text: "Review Pull Requests", icon: "📝", badge: "3 pending", badgeVariant: "warning" },
              { text: "Check Error Logs", icon: "🔍", description: "Last checked 2 hours ago" },
            ]}
          />
        </div>
      </section>

      {/* DataTable */}
      <section data-testid="datatable-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasDataTable</p>
        <CanvasDataTable
          title="Team Members"
          columns={["Name", "Role", "Department", "Salary", "Status"]}
          rows={[
            ["Alice Chen", "Senior Engineer", "Engineering", "$145,000", "Active"],
            ["Bob Martinez", "Product Manager", "Product", "$130,000", "Active"],
            ["Carol Kim", "UX Designer", "Design", "$120,000", "Active"],
            ["David Patel", "DevOps Lead", "Infrastructure", "$140,000", "On Leave"],
            ["Eva Johnson", "Data Scientist", "Analytics", "$135,000", "Active"],
            ["Frank Wu", "QA Engineer", "Engineering", "$110,000", "Active"],
            ["Grace Lee", "Frontend Dev", "Engineering", "$125,000", "Active"],
          ]}
        />
      </section>

      {/* CodeBlock */}
      <section data-testid="codeblock-section">
        <p className="text-xs text-muted-foreground mb-2">CanvasCodeBlock</p>
        <CanvasCodeBlock
          title="fibonacci.py"
          language="python"
          code={`def fibonacci(n: int) -> list[int]:
    """Generate fibonacci sequence up to n terms."""
    if n <= 0:
        return []
    if n == 1:
        return [0]

    fib = [0, 1]
    for i in range(2, n):
        fib.append(fib[i-1] + fib[i-2])
    return fib

# Usage
result = fibonacci(10)
print(f"First 10 terms: {result}")`}
        />
      </section>

      {/* ── Dashboard Layout Tests ───────────────────────────────────── */}
      <h2 className="text-xl font-bold mt-16 mb-4 pt-8 border-t border-border">Dashboard Layout Tests</h2>

      {/* KPI Row — 3 metric cards in a row */}
      <section data-testid="dashboard-kpi-row">
        <p className="text-xs text-muted-foreground mb-2">KPI Row (3 × metric_card, span-1 each)</p>
        <div className="grid grid-cols-3 gap-4">
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

      {/* Chart + Sidebar — chart (span-2) + list (span-1) */}
      <section data-testid="dashboard-chart-sidebar">
        <p className="text-xs text-muted-foreground mb-2">Chart + Sidebar (span-2 + span-1)</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 rounded-lg overflow-hidden border border-border/40">
            <CanvasTimeline
              title="Recent Activity"
              events={[
                { label: "Deployment started", timestamp: "10:30 AM", status: "completed" },
                { label: "Tests passed", timestamp: "10:32 AM", status: "completed" },
                { label: "Live on production", timestamp: "10:35 AM", status: "active" },
              ]}
            />
          </div>
          <div className="col-span-1 rounded-lg overflow-hidden border border-border/40">
            <CanvasList
              title="Top Pages"
              items={[
                { text: "/dashboard", badge: "1.2k", badgeVariant: "info" },
                { text: "/settings", badge: "890" },
                { text: "/api/docs", badge: "654" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* Full-width table — data_table spanning full width */}
      <section data-testid="dashboard-full-table">
        <p className="text-xs text-muted-foreground mb-2">Full-Width Table (span-3)</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-3 rounded-lg overflow-hidden border border-border/40">
            <CanvasDataTable
              title="Recent Deployments"
              columns={["Name", "Status", "Runtime", "Region", "Created", "Last Active"]}
              rows={[
                ["Support Bot", "Running", "OpenClaw", "US-East", "Feb 20", "2 min ago"],
                ["Sales Assistant", "Stopped", "ZeroClaw", "EU-West", "Feb 18", "1 day ago"],
                ["Analytics Bot", "Running", "OpenClaw", "US-West", "Feb 15", "5 min ago"],
              ]}
            />
          </div>
        </div>
      </section>

      {/* Mixed Dashboard — full flow */}
      <section data-testid="dashboard-mixed-full">
        <p className="text-xs text-muted-foreground mb-2">Mixed Dashboard (header + KPIs + chart + list + table)</p>
        <div className="grid grid-cols-3 gap-4">
          {/* Header — full width */}
          <div className="col-span-3 rounded-lg overflow-hidden border border-border/40">
            <CanvasHeader title="Sales Analytics Dashboard" subtitle="Q4 2025 Performance" level={1} />
          </div>

          {/* 3 KPI metrics */}
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Total Sales" value="$1.8M" change="+15%" trend="up" />
          </div>
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Conversion" value="3.2%" change="+0.5%" trend="up" />
          </div>
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasMetricCard label="Avg Order" value="$89" change="-$3" trend="down" />
          </div>

          {/* Timeline (span-2) + Alert (span-1) */}
          <div className="col-span-2 rounded-lg overflow-hidden border border-border/40">
            <CanvasTimeline
              title="Q4 Milestones"
              events={[
                { label: "Black Friday Launch", timestamp: "Nov 24", status: "completed" },
                { label: "Holiday Campaign", timestamp: "Dec 1", status: "completed" },
                { label: "Year-End Review", timestamp: "Dec 31", status: "active" },
              ]}
            />
          </div>
          <div className="rounded-lg overflow-hidden border border-border/40">
            <CanvasAlert variant="success" title="Target Met" message="Q4 revenue exceeded target by 12%." />
          </div>

          {/* Full-width table */}
          <div className="col-span-3 rounded-lg overflow-hidden border border-border/40">
            <CanvasDataTable
              title="Top Products"
              columns={["Product", "Units Sold", "Revenue", "Growth"]}
              rows={[
                ["Pro Plan", "2,340", "$210K", "+18%"],
                ["Enterprise", "156", "$468K", "+25%"],
                ["Starter", "8,920", "$89K", "+5%"],
              ]}
            />
          </div>
        </div>
      </section>

      {/* Stat Grid — full width */}
      <section data-testid="dashboard-stat-grid">
        <p className="text-xs text-muted-foreground mb-2">Stat Grid (auto span-3 for 4+ stats)</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-3 rounded-lg overflow-hidden border border-border/40">
            <CanvasStatGrid
              stats={[
                { label: "CPU Usage", value: "42%", change: "-3%" },
                { label: "Memory", value: "6.2 GB", change: "+0.4 GB" },
                { label: "Disk I/O", value: "120 MB/s" },
                { label: "Network", value: "2.1 Gbps", change: "+15%" },
                { label: "Uptime", value: "99.97%" },
                { label: "Requests/s", value: "12,400", change: "+800" },
              ]}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
