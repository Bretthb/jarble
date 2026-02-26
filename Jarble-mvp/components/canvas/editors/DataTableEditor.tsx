"use client";

import { Plus, Trash2 } from "lucide-react";
import type { EditorProps } from "./registry";

export default function DataTableEditor({ props, onChange, disabled }: EditorProps) {
  const title = (props.title as string) || "";
  const columns = (props.columns as string[]) || [];
  const rows = (props.rows as (string | number)[][]) || [];

  const update = (patch: Partial<typeof props>) => {
    onChange({ ...props, ...patch });
  };

  const updateColumn = (idx: number, value: string) => {
    const next = [...columns];
    next[idx] = value;
    update({ columns: next });
  };

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const next = rows.map((r) => [...r]);
    next[rowIdx][colIdx] = value;
    update({ rows: next });
  };

  const addRow = () => {
    update({ rows: [...rows, columns.map(() => "")] });
  };

  const addColumn = () => {
    update({
      columns: [...columns, `Col ${columns.length + 1}`],
      rows: rows.map((r) => [...r, ""]),
    });
  };

  const deleteRow = (idx: number) => {
    update({ rows: rows.filter((_, i) => i !== idx) });
  };

  const deleteColumn = (idx: number) => {
    update({
      columns: columns.filter((_, i) => i !== idx),
      rows: rows.map((r) => r.filter((_, i) => i !== idx)),
    });
  };

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <input
        type="text"
        value={title}
        onChange={(e) => update({ title: e.target.value })}
        placeholder="Table title (optional)"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={`col-${col}-${i}`} className="relative group">
                  <input
                    type="text"
                    value={col}
                    onChange={(e) => updateColumn(i, e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                  />
                  {columns.length > 1 && (
                    <button
                      onClick={() => deleteColumn(i)}
                      className="absolute -top-1.5 -right-1.5 md:hidden md:group-hover:flex w-4 h-4 flex items-center justify-center rounded-full bg-red-500 text-white"
                      title="Delete column"
                      aria-label={`Delete column ${col}`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="py-6 text-center text-xs text-muted-foreground"
                >
                  No rows yet — click Add Row
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="group">
                  {row.map((cell, ci) => (
                    <td key={ci} className="p-0.5">
                      <input
                        type="text"
                        value={String(cell)}
                        onChange={(e) => updateCell(ri, ci, e.target.value)}
                        className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
                      />
                    </td>
                  ))}
                  <td className="p-0.5">
                    <button
                      onClick={() => deleteRow(ri)}
                      className="md:opacity-0 md:group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition-opacity"
                      title="Delete row"
                      aria-label={`Delete row ${ri + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button
          onClick={addRow}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
          Row
        </button>
        <button
          onClick={addColumn}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border border-border/60 bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
        >
          <Plus className="w-3 h-3" />
          Column
        </button>
      </div>
    </fieldset>
  );
}
