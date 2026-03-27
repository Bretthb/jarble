"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { useCanvasAction } from "../CanvasActionContext";

export interface CanvasDataTableProps {
  title?: string;
  columns?: string[];
  rows?: unknown[];
}

/**
 * Normalize a row into an array of cell values.
 * Tambo's LLM may pass rows as:
 *   - arrays: ["Alice", "Engineer"]
 *   - objects: { name: "Alice", role: "Engineer" }
 */
function normalizeRow(row: unknown, columns: string[]): string[] {
  if (Array.isArray(row)) return row.map(String);
  if (row && typeof row === "object") {
    const obj = row as Record<string, unknown>;
    // If we have columns, extract values in column order
    if (columns.length > 0) {
      return columns.map((col) => {
        const key = Object.keys(obj).find(
          (k) => k.toLowerCase() === col.toLowerCase()
        );
        return key != null ? String(obj[key] ?? "") : "";
      });
    }
    return Object.values(obj).map(String);
  }
  return [String(row)];
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
    // Not inside CanvasActionProvider - interactivity disabled
  }

  // Infer columns from first object row if not provided
  const resolvedColumns =
    columns.length > 0
      ? columns
      : rows.length > 0 && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];

  const normalizedRows = rows.map((row) => normalizeRow(row, resolvedColumns));

  // Detect numeric columns for right-alignment
  const numericCols = resolvedColumns.map((_, i) => isNumericColumn(normalizedRows, i));

  const handleRowClick = (rowIndex: number, rowCells: string[]) => {
    if (!dispatch) return;
    // Build row data as key-value pairs using column names
    const rowData: Record<string, string> = {};
    resolvedColumns.forEach((col, i) => {
      rowData[col] = rowCells[i] ?? "";
    });
    dispatch({
      action: "row_click",
      payload: { rowIndex, rowData, columns: resolvedColumns },
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="h-full flex flex-col overflow-hidden"
    >
      {title && (
        <div className="px-4 py-2.5 border-b border-border shrink-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-sm">
          {resolvedColumns.length > 0 && (
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/60">
                {resolvedColumns.map((col, i) => (
                  <th
                    key={col}
                    className={`px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border ${
                      numericCols[i] ? "text-right" : "text-left"
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {normalizedRows.map((row, ri) => (
              <tr
                key={ri}
                className={`group cursor-pointer transition-colors border-b border-border/20 last:border-0 hover:bg-accent/50 ${
                  ri % 2 === 1 ? "bg-muted/15" : ""
                }`}
                onClick={() => handleRowClick(ri, row)}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={`px-4 py-2.5 whitespace-nowrap ${
                      numericCols[ci]
                        ? "text-right font-mono tabular-nums text-foreground"
                        : "text-foreground/90"
                    }`}
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
        <div className="px-4 py-2 border-t border-border/40 shrink-0 flex items-center">
          <span className="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {normalizedRows.length} {normalizedRows.length === 1 ? "row" : "rows"}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export default memo(CanvasDataTableInner);
