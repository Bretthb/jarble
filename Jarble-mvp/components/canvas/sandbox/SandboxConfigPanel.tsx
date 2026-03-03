"use client";

/**
 * SandboxConfigPanel — renders a config UI from a JSON Schema.
 *
 * Sandbox components can declare a `configSchema` (JSON Schema format) in their
 * props. This panel renders form fields for each schema property, allowing users
 * to tweak sandbox parameters without editing code.
 *
 * Supported types: string, number, integer, boolean, enum (string + enum array).
 * Complex types (object, array) render as JSON textareas.
 */

import { memo, useState, useCallback } from "react";
import { Settings } from "lucide-react";

// ── JSON Schema property definition (subset we support) ──────────────────────

interface JsonSchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isJsonSchemaObject(schema: unknown): schema is JsonSchemaObject {
  if (typeof schema !== "object" || schema === null) return false;
  const s = schema as Record<string, unknown>;
  return s.type === "object" && typeof s.properties === "object" && s.properties !== null;
}

function getDefault(prop: JsonSchemaProperty): unknown {
  if (prop.default !== undefined) return prop.default;
  switch (prop.type) {
    case "string": return "";
    case "number":
    case "integer": return prop.minimum ?? 0;
    case "boolean": return false;
    default: return undefined;
  }
}

// ── Field renderers ──────────────────────────────────────────────────────────

function StringField({
  name,
  prop,
  value,
  onChange,
}: {
  name: string;
  prop: JsonSchemaProperty;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  // Enum: render as select
  if (prop.enum && prop.enum.length > 0) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        className="w-full px-2 py-1 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm text-foreground"
      >
        {prop.enum.map((opt) => (
          <option key={String(opt)} value={String(opt)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(name, e.target.value)}
      maxLength={prop.maxLength ?? 500}
      className="w-full px-2 py-1 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm text-foreground"
      placeholder={prop.description || name}
    />
  );
}

function NumberField({
  name,
  prop,
  value,
  onChange,
}: {
  name: string;
  prop: JsonSchemaProperty;
  value: number;
  onChange: (name: string, value: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(name, Number(e.target.value))}
      min={prop.minimum}
      max={prop.maximum}
      step={prop.type === "integer" ? 1 : "any"}
      className="w-full px-2 py-1 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm text-foreground"
    />
  );
}

function BooleanField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: boolean;
  onChange: (name: string, value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(name, e.target.checked)}
        className="rounded border-muted-foreground/20"
      />
      <span className="text-sm text-foreground">{value ? "Enabled" : "Disabled"}</span>
    </label>
  );
}

function JsonField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(name, e.target.value)}
      rows={3}
      className="w-full px-2 py-1 rounded-md bg-muted/50 border border-muted-foreground/20 text-sm text-foreground font-mono resize-y"
      placeholder="JSON value"
    />
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface SandboxConfigPanelProps {
  /** JSON Schema object defining configurable properties. */
  configSchema: Record<string, unknown>;
  /** Current config values. */
  values: Record<string, unknown>;
  /** Called when a config value changes. */
  onChange: (values: Record<string, unknown>) => void;
}

function SandboxConfigPanelInner({
  configSchema,
  values,
  onChange,
}: SandboxConfigPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!isJsonSchemaObject(configSchema)) return null;

  const properties = configSchema.properties;
  const propertyNames = Object.keys(properties);
  if (propertyNames.length === 0) return null;

  const requiredSet = new Set(configSchema.required || []);

  const handleChange = useCallback(
    (name: string, value: unknown) => {
      onChange({ ...values, [name]: value });
    },
    [values, onChange],
  );

  return (
    <div className="border border-muted-foreground/15 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Configuration
        <span className="ml-auto text-muted-foreground/50">{isExpanded ? "Hide" : "Show"}</span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-muted-foreground/10">
          {propertyNames.map((name) => {
            const prop = properties[name] as JsonSchemaProperty;
            const currentValue = values[name] ?? getDefault(prop);
            const label = prop.title || name;
            const isRequired = requiredSet.has(name);

            return (
              <div key={name} className="space-y-1 pt-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {label}
                  {isRequired && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                {prop.description && (
                  <p className="text-xs text-muted-foreground/60">{prop.description}</p>
                )}

                {prop.type === "string" && (
                  <StringField
                    name={name}
                    prop={prop}
                    value={String(currentValue ?? "")}
                    onChange={handleChange as (name: string, value: string) => void}
                  />
                )}
                {(prop.type === "number" || prop.type === "integer") && (
                  <NumberField
                    name={name}
                    prop={prop}
                    value={Number(currentValue ?? 0)}
                    onChange={handleChange as (name: string, value: number) => void}
                  />
                )}
                {prop.type === "boolean" && (
                  <BooleanField
                    name={name}
                    value={Boolean(currentValue)}
                    onChange={handleChange as (name: string, value: boolean) => void}
                  />
                )}
                {(prop.type === "object" || prop.type === "array") && (
                  <JsonField
                    name={name}
                    value={typeof currentValue === "string" ? currentValue : JSON.stringify(currentValue ?? null, null, 2)}
                    onChange={(n, v) => {
                      try {
                        handleChange(n, JSON.parse(v));
                      } catch {
                        // Keep as string while user is typing invalid JSON
                        handleChange(n, v);
                      }
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const SandboxConfigPanel = memo(SandboxConfigPanelInner);
