"use client";

export interface CanvasDataTableProps {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export default function CanvasDataTable({ title, columns, rows }: CanvasDataTableProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {title && (
        <div className="px-4 py-2.5 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              {columns.map((col, i) => (
                <th key={i} className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className="border-b border-border/50 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-4 py-2 text-foreground/90 whitespace-nowrap">
                    {String(cell)}
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
