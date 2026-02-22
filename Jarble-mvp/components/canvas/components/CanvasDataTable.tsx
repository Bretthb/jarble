"use client";

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

export default function CanvasDataTable({ title, columns = [], rows = [] }: CanvasDataTableProps) {
  // Infer columns from first object row if not provided
  const resolvedColumns =
    columns.length > 0
      ? columns
      : rows.length > 0 && rows[0] && typeof rows[0] === "object" && !Array.isArray(rows[0])
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];

  const normalizedRows = rows.map((row) => normalizeRow(row, resolvedColumns));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {title && (
        <div className="px-4 py-2.5 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          {resolvedColumns.length > 0 && (
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                {resolvedColumns.map((col, i) => (
                  <th key={i} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {normalizedRows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2 text-foreground/90 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
