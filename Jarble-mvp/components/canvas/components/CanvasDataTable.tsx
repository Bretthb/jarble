"use client";

import { memo } from "react";
import { FadeIn } from "../FadeIn";
import { useCanvasAction } from "../CanvasActionContext";

/**
 * Column definition accepted by CanvasDataTable.
 *
 * The LLM may emit columns in three formats:
 *   1. Plain strings: ["Name", "Role", "Salary"]
 *   2. Objects with label: [{ key: "name", label: "Name" }, ...]
 *   3. Objects with just name/title: [{ name: "Name" }, ...]
 *
 * All three are normalized to plain strings before rendering. Previously
 * the component only accepted strings and crashed with React error #31
 * ("Objects are not valid as a React child") when the LLM emitted format 2.
 */
export type CanvasDataTableColumn =
  | string
  | { key?: string; label?: string; name?: string; title?: string };

export interface CanvasDataTableProps {
  title?: string;
  columns?: CanvasDataTableColumn[];
  rows?: unknown[];
}

/** Normalize a column definition to a plain string label for display. */
function columnLabel(col: CanvasDataTableColumn): string {
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    return (
      (col as any).label ??
      (col as any).title ??
      (col as any).name ??
      (col as any).key ??
      ""
    );
  }
  return String(col ?? "");
}

/** Normalize a column definition to its underlying object key (for row lookup). */
function columnKey(col: CanvasDataTableColumn): string {
  if (typeof col === "string") return col;
  if (col && typeof col === "object") {
    return (
      (col as any).key ??
      (col as any).name ??
      (col as any).label ??
      (col as any).title ??
      ""
    );
  }
  return String(col ?? "");
}

/**
 * Normalize a row into an array of cell values.
 * The LLM may pass rows as:
 *   - arrays: ["Alice", "Engineer"]
 *   - objects: { name: "Alice", role: "Engineer" }
 *
 * `columnKeys` and `columnLabels` are parallel arrays — key is used for
 * object lookup, label is used to match case-insensitively as a fallback.
 */
function normalizeRow(
  row: unknown,
  columnKeys: string[],
  columnLabels: string[],
): string[] {
  if (Array.isArray(row)) return row.map((v) => safeToString(v));
  if (row && typeof row === "object") {
    const obj = row as Record<string, unknown>;
    // If we have columns, extract values in column order
    if (columnKeys.length > 0) {
      return columnKeys.map((key, i) => {
        // Try exact key match first
        if (key && key in obj) return safeToString(obj[key]);
        // Then case-insensitive match against key OR label
        const needles = [key, columnLabels[i]].filter(Boolean).map((s) => s.toLowerCase());
        const foundKey = Object.keys(obj).find((k) =>
          needles.includes(k.toLowerCase())
        );
        return foundKey != null ? safeToString(obj[foundKey]) : "";
      });
    }
    return Object.values(obj).map((v) => safeToString(v));
  }
  return [safeToString(row)];
}

/**
 * Convert any value to a string safely. Critical: objects and arrays are
 * JSON-stringified instead of going through String() which returns
 * "[object Object]" — and arrays never reach React render as naked values.
 */
function safeToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Detect if a column contains primarily numeric values */
function isNumericColumn(rows: string[][], colIdx: number): boolean {
  if (rows.length === 0) return false;
  let numericCount = 0;
  for (const row of rows) {
    const val = row[colIdx]?.trim();
    if (!val) continue;
    // Strip currency/percent symbols for detection
    const cleaned = val.replace(/[$\u20AC\u00A3\u00A5%,]/g, "");
    if (!isNaN(Number(cleaned))) numericCount++;
  }
  return numericCount > rows.length * 0.6;
}

function CanvasDataTableInner({ title, columns = [], rows = [] }: CanvasDataTableProps) {
  let dispatch: ReturnType<typeof useCanvasAction>["dispatch"] | null = null;
  try {
    const ctx = useCanvasAction();
    dispatch = ctx.dispatch;
  } catch {
    // Not inside CanvasActionProvider -- interactivity disabled
  }

  // Normalize column definitions to parallel arrays of keys + display labels.
  // Handles strings, {key, label} objects, {name}, {title}, etc.
  const normalizedColumns = columns.length > 0 ? columns : [];
  let columnKeys = normalizedColumns.map(columnKey);
  let columnLabels = normalizedColumns.map(columnLabel);

  // If no columns provided, infer from the first object row
  if (columnKeys.length === 0 && rows.length > 0 && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])) {
    const inferred = Object.keys(rows[0] as Record<string, unknown>);
    columnKeys = inferred;
    columnLabels = inferred;
  }

  const normalizedRows = rows.map((row) => normalizeRow(row, columnKeys, columnLabels));

  // Detect numeric columns for right-alignment
  const numericCols = columnKeys.map((_, i) => isNumericColumn(normalizedRows, i));

  const handleRowClick = (rowIndex: number, rowCells: string[]) => {
    if (!dispatch) return;
    // Build row data as key-value pairs using column keys
    const rowData: Record<string, string> = {};
    columnKeys.forEach((key, i) => {
      rowData[key] = rowCells[i] ?? "";
    });
    dispatch({
      action: "row_click",
      payload: { rowIndex, rowData, columns: columnLabels },
    });
  };

  // Empty state
  if (normalizedRows.length === 0) {
    return (
      <FadeIn className="h-full flex flex-col items-center justify-center p-8 gap-2">
        <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-muted-foreground/50">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-sm text-muted-foreground/60">No data available</span>
      </FadeIn>
    );
  }

  return (
    <FadeIn className="h-full flex flex-col overflow-hidden rounded-xl border border-border/40">
      {title && (
        <div className="px-4 py-3 border-b border-border/50 shrink-0 bg-gradient-to-r from-muted/30 to-transparent">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm" aria-label={title || "Data table"}>
          {columnLabels.length > 0 && (
            <thead className="sticky top-0 z-10">
              <tr className="bg-gradient-to-r from-muted/80 via-muted/60 to-muted/40 dark:from-white/[0.06] dark:via-white/[0.04] dark:to-white/[0.02] backdrop-blur-sm">
                {columnLabels.map((label, i) => (
                  <th
                    key={`${columnKeys[i] || label}-${i}`}
                    scope="col"
                    className={[
                      "px-4 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap",
                      "border-b border-border/50",
                      "first:rounded-tl-lg last:rounded-tr-lg",
                      numericCols[i] ? "text-right" : "text-left",
                    ].join(" ")}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {normalizedRows.map((row, ri) => (
              <tr
                key={ri}
                tabIndex={0}
                className={[
                  "group cursor-pointer transition-colors duration-150",
                  "border-b border-border/15 last:border-0",
                  "hover:bg-primary/[0.04] dark:hover:bg-white/[0.04]",
                  ri % 2 === 1
                    ? "bg-muted/20 dark:bg-white/[0.015]"
                    : "",
                ].join(" ")}
                onClick={() => handleRowClick(ri, row)}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(ri, row); } }}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={[
                      "px-4 py-2.5 whitespace-nowrap",
                      "transition-colors duration-150",
                      numericCols[ci]
                        ? "text-right font-mono tabular-nums text-foreground"
                        : "text-foreground/90",
                      "group-hover:text-foreground",
                    ].join(" ")}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {normalizedRows.length > 0 && (
        <div className="px-4 py-2 border-t border-border/30 shrink-0 flex items-center bg-gradient-to-r from-muted/20 to-transparent">
          <span className="inline-flex items-center rounded-full bg-secondary/60 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/70">
            {normalizedRows.length} {normalizedRows.length === 1 ? "row" : "rows"}
          </span>
        </div>
      )}
    </FadeIn>
  );
}

export default memo(CanvasDataTableInner);
