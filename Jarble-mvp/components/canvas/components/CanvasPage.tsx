"use client";

import { memo } from "react";
import CanvasRenderer from "../CanvasRenderer";
import { FadeIn } from "../FadeIn";

// ── Types ────────────────────────────────────────────────────────────────────

export type PageType =
  | "dashboard"
  | "settings"
  | "kanban"
  | "crm"
  | "landing"
  | "data_explorer"
  | "form_wizard";

interface SectionChild {
  component: string;
  props: Record<string, unknown>;
}

export interface CanvasPageProps {
  type: PageType;
  title: string;
  subtitle?: string;
  sections: Record<string, SectionChild[]>;
  navigation?: { tabs?: string[]; activeTab?: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Render a list of child components using CanvasRenderer */
function renderChildren(children: SectionChild[], keyPrefix: string) {
  return children.map((child, i) => (
    <CanvasRenderer
      key={`${keyPrefix}-${i}`}
      block={{
        id: `${keyPrefix}-${i}`,
        component: child.component,
        props: child.props,
      }}
    />
  ));
}

/** Render children in a responsive grid */
function ChildGrid({
  children,
  keyPrefix,
  columns = 2,
}: {
  children: SectionChild[];
  keyPrefix: string;
  columns?: number;
}) {
  const colClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 md:grid-cols-2"
        : columns === 3
          ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={`grid ${colClass} gap-4`}>
      {children.map((child, i) => (
        <div key={`${keyPrefix}-${i}`} className="min-h-0">
          <CanvasRenderer
            block={{
              id: `${keyPrefix}-${i}`,
              component: child.component,
              props: child.props,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Render children in a vertical stack */
function ChildStack({
  children,
  keyPrefix,
}: {
  children: SectionChild[];
  keyPrefix: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {children.map((child, i) => (
        <div key={`${keyPrefix}-${i}`}>
          <CanvasRenderer
            block={{
              id: `${keyPrefix}-${i}`,
              component: child.component,
              props: child.props,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Render children in a horizontal scrollable row */
function ChildRow({
  children,
  keyPrefix,
}: {
  children: SectionChild[];
  keyPrefix: string;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {children.map((child, i) => (
        <div key={`${keyPrefix}-${i}`} className="shrink-0 min-w-[250px]">
          <CanvasRenderer
            block={{
              id: `${keyPrefix}-${i}`,
              component: child.component,
              props: child.props,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {label.replace(/_/g, " ")}
    </h3>
  );
}

// ── Layout renderers per page type ───────────────────────────────────────────

function DashboardLayout({ sections }: { sections: Record<string, SectionChild[]> }) {
  const { header, kpi, charts, tables, ...rest } = sections;
  return (
    <div className="space-y-6">
      {header && header.length > 0 && (
        <div>
          <ChildRow children={header} keyPrefix="dash-header" />
        </div>
      )}
      {kpi && kpi.length > 0 && (
        <div>
          <SectionLabel label="Key Metrics" />
          <ChildGrid children={kpi} keyPrefix="dash-kpi" columns={Math.min(kpi.length, 4)} />
        </div>
      )}
      {charts && charts.length > 0 && (
        <div>
          <SectionLabel label="Charts" />
          <ChildGrid children={charts} keyPrefix="dash-charts" columns={2} />
        </div>
      )}
      {tables && tables.length > 0 && (
        <div>
          <SectionLabel label="Tables" />
          <ChildStack children={tables} keyPrefix="dash-tables" />
        </div>
      )}
      {/* Render any extra sections */}
      {Object.entries(rest).map(([key, items]) =>
        items.length > 0 ? (
          <div key={key}>
            <SectionLabel label={key} />
            <ChildGrid children={items} keyPrefix={`dash-${key}`} columns={2} />
          </div>
        ) : null
      )}
    </div>
  );
}

function SettingsLayout({ sections, navigation }: { sections: Record<string, SectionChild[]>; navigation?: CanvasPageProps["navigation"] }) {
  const sectionKeys = Object.keys(sections);
  const activeKey = navigation?.activeTab || sectionKeys[0] || "";
  const activeSection = sections[activeKey] || [];

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Sidebar nav */}
      <nav className="w-1/4 min-w-[160px] shrink-0 border-r border-border/40 pr-4 space-y-1">
        {(navigation?.tabs || sectionKeys).map((tab) => (
          <div
            key={tab}
            className={`px-3 py-2 rounded-md text-sm cursor-default ${
              tab === activeKey
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-secondary/50"
            }`}
          >
            {tab.replace(/_/g, " ")}
          </div>
        ))}
      </nav>
      {/* Content area */}
      <div className="flex-1 min-w-0 overflow-auto">
        <ChildStack children={activeSection} keyPrefix={`settings-${activeKey}`} />
      </div>
    </div>
  );
}

function KanbanLayout({ sections }: { sections: Record<string, SectionChild[]> }) {
  return (
    <div className="flex gap-4 overflow-x-auto h-full min-h-0 pb-2">
      {Object.entries(sections).map(([column, items]) => (
        <div
          key={column}
          className="shrink-0 w-[280px] bg-secondary/20 rounded-lg border border-border/30 p-3 flex flex-col"
        >
          <h3 className="text-sm font-semibold mb-3 text-foreground/80 capitalize">
            {column.replace(/_/g, " ")}
          </h3>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {renderChildren(items, `kanban-${column}`)}
          </div>
        </div>
      ))}
    </div>
  );
}

function CrmLayout({ sections }: { sections: Record<string, SectionChild[]> }) {
  const { header, summary, contacts, activity, ...rest } = sections;
  return (
    <div className="space-y-6">
      {header && header.length > 0 && (
        <ChildRow children={header} keyPrefix="crm-header" />
      )}
      {summary && summary.length > 0 && (
        <div>
          <SectionLabel label="Summary" />
          <ChildGrid children={summary} keyPrefix="crm-summary" columns={Math.min(summary.length, 4)} />
        </div>
      )}
      {contacts && contacts.length > 0 && (
        <div>
          <SectionLabel label="Contacts" />
          <ChildGrid children={contacts} keyPrefix="crm-contacts" columns={3} />
        </div>
      )}
      {activity && activity.length > 0 && (
        <div>
          <SectionLabel label="Activity" />
          <ChildStack children={activity} keyPrefix="crm-activity" />
        </div>
      )}
      {Object.entries(rest).map(([key, items]) =>
        items.length > 0 ? (
          <div key={key}>
            <SectionLabel label={key} />
            <ChildGrid children={items} keyPrefix={`crm-${key}`} columns={2} />
          </div>
        ) : null
      )}
    </div>
  );
}

function LandingLayout({ sections }: { sections: Record<string, SectionChild[]> }) {
  const { hero, features, testimonials, cta, ...rest } = sections;
  return (
    <div className="space-y-8">
      {hero && hero.length > 0 && (
        <div className="text-center">
          <ChildStack children={hero} keyPrefix="landing-hero" />
        </div>
      )}
      {features && features.length > 0 && (
        <div>
          <SectionLabel label="Features" />
          <ChildGrid children={features} keyPrefix="landing-features" columns={3} />
        </div>
      )}
      {testimonials && testimonials.length > 0 && (
        <div>
          <SectionLabel label="Testimonials" />
          <ChildRow children={testimonials} keyPrefix="landing-testimonials" />
        </div>
      )}
      {cta && cta.length > 0 && (
        <div className="text-center">
          <ChildStack children={cta} keyPrefix="landing-cta" />
        </div>
      )}
      {Object.entries(rest).map(([key, items]) =>
        items.length > 0 ? (
          <div key={key}>
            <SectionLabel label={key} />
            <ChildGrid children={items} keyPrefix={`landing-${key}`} columns={2} />
          </div>
        ) : null
      )}
    </div>
  );
}

function DataExplorerLayout({ sections }: { sections: Record<string, SectionChild[]> }) {
  const { filters, data, detail, ...rest } = sections;
  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* Filters sidebar */}
      {filters && filters.length > 0 && (
        <aside className="w-[220px] shrink-0 border-r border-border/40 pr-4 overflow-y-auto">
          <SectionLabel label="Filters" />
          <ChildStack children={filters} keyPrefix="explorer-filters" />
        </aside>
      )}
      {/* Data view */}
      <div className="flex-1 min-w-0 overflow-auto">
        {data && data.length > 0 && (
          <ChildStack children={data} keyPrefix="explorer-data" />
        )}
        {Object.entries(rest).map(([key, items]) =>
          items.length > 0 ? (
            <div key={key} className="mt-4">
              <SectionLabel label={key} />
              <ChildGrid children={items} keyPrefix={`explorer-${key}`} columns={2} />
            </div>
          ) : null
        )}
      </div>
      {/* Detail panel */}
      {detail && detail.length > 0 && (
        <aside className="w-[280px] shrink-0 border-l border-border/40 pl-4 overflow-y-auto">
          <SectionLabel label="Details" />
          <ChildStack children={detail} keyPrefix="explorer-detail" />
        </aside>
      )}
    </div>
  );
}

function FormWizardLayout({ sections, navigation }: { sections: Record<string, SectionChild[]>; navigation?: CanvasPageProps["navigation"] }) {
  const sectionKeys = Object.keys(sections);
  const activeKey = navigation?.activeTab || sectionKeys[0] || "";
  const activeSection = sections[activeKey] || [];
  const { actions, ...contentSections } = sections;
  const activeContent = contentSections[activeKey] || activeSection;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Steps indicator */}
      {sectionKeys.length > 1 && (
        <div className="flex items-center gap-2 mb-6 px-2">
          {sectionKeys
            .filter((k) => k !== "actions")
            .map((step, i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                    step === activeKey
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </div>
                <span
                  className={`text-xs ${
                    step === activeKey ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {step.replace(/_/g, " ")}
                </span>
                {i < arr.length - 1 && (
                  <div className="w-8 h-px bg-border" />
                )}
              </div>
            ))}
        </div>
      )}
      {/* Form area */}
      <div className="flex-1 overflow-auto">
        <ChildStack children={activeContent} keyPrefix={`wizard-${activeKey}`} />
      </div>
      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/40 flex justify-end gap-3">
          {renderChildren(actions, "wizard-actions")}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

function CanvasPageInner({ type, title, subtitle, sections, navigation }: CanvasPageProps) {
  if (!sections || typeof sections !== "object") {
    return (
      <div className="p-4 h-full text-sm text-muted-foreground">
        No sections provided for page.
      </div>
    );
  }

  const layoutContent = (() => {
    switch (type) {
      case "dashboard":
        return <DashboardLayout sections={sections} />;
      case "settings":
        return <SettingsLayout sections={sections} navigation={navigation} />;
      case "kanban":
        return <KanbanLayout sections={sections} />;
      case "crm":
        return <CrmLayout sections={sections} />;
      case "landing":
        return <LandingLayout sections={sections} />;
      case "data_explorer":
        return <DataExplorerLayout sections={sections} />;
      case "form_wizard":
        return <FormWizardLayout sections={sections} navigation={navigation} />;
      default:
        // Fallback: render all sections as stacked grids
        return (
          <div className="space-y-6">
            {Object.entries(sections).map(([key, items]) =>
              items.length > 0 ? (
                <div key={key}>
                  <SectionLabel label={key} />
                  <ChildGrid children={items} keyPrefix={`fallback-${key}`} columns={2} />
                </div>
              ) : null
            )}
          </div>
        );
    }
  })();

  return (
    <FadeIn className="p-4 h-full overflow-auto">
      {/* Title area */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {layoutContent}
    </FadeIn>
  );
}

export default memo(CanvasPageInner);
