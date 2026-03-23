"use client";

import { memo, useState } from "react";
import { FadeIn } from "../FadeIn";
import { useCanvasAction } from "../CanvasActionContext";

interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "textarea" | "select" | "checkbox" | "number";
  placeholder?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string | number | boolean;
}

export interface CanvasFormProps {
  title?: string;
  fields: FormField[];
  submitLabel?: string;
}

function CanvasFormInner({
  title,
  fields,
  submitLabel = "Submit",
}: CanvasFormProps) {
  const { dispatch } = useCanvasAction();
  const [submitted, setSubmitted] = useState(false);

  // Initialize form values from defaults
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const initial: Record<string, string | number | boolean> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) {
        initial[field.name] = field.defaultValue;
      } else if (field.type === "checkbox") {
        initial[field.name] = false;
      } else if (field.type === "number") {
        initial[field.name] = 0;
      } else {
        initial[field.name] = "";
      }
    }
    return initial;
  });

  const updateField = (name: string, value: string | number | boolean) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    dispatch({ action: "submit", payload: { fields: values } });
  };

  if (!Array.isArray(fields) || fields.length === 0) return null;

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50";

  return (
    <FadeIn className="p-4 h-full">
      {title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
      <form onSubmit={handleSubmit} className="space-y-3">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <label htmlFor={`field-${field.name}`} className="text-xs font-medium text-muted-foreground">
              {field.label}
              {field.required && <span className="text-red-600 dark:text-red-400 ml-0.5">*</span>}
            </label>

            {field.type === "textarea" ? (
              <textarea
                id={`field-${field.name}`}
                value={String(values[field.name] || "")}
                onChange={(e) => updateField(field.name, e.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                aria-required={field.required}
                disabled={submitted}
                rows={3}
                className={`${inputClass} resize-y`}
              />
            ) : field.type === "select" ? (
              <select
                id={`field-${field.name}`}
                value={String(values[field.name] || "")}
                onChange={(e) => updateField(field.name, e.target.value)}
                required={field.required}
                aria-required={field.required}
                disabled={submitted}
                className={inputClass}
              >
                <option value="">{field.placeholder || "Select..."}</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  id={`field-${field.name}`}
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(e) => updateField(field.name, e.target.checked)}
                  disabled={submitted}
                  className="rounded border-border"
                />
                {field.placeholder || field.label}
              </label>
            ) : (
              <input
                id={`field-${field.name}`}
                type={field.type}
                value={String(values[field.name] || "")}
                onChange={(e) =>
                  updateField(
                    field.name,
                    field.type === "number" ? Number(e.target.value) : e.target.value
                  )
                }
                placeholder={field.placeholder}
                required={field.required}
                aria-required={field.required}
                disabled={submitted}
                className={inputClass}
              />
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={submitted}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitted ? "Submitted" : submitLabel}
        </button>
      </form>

      {submitted && (
        <div className="mt-3 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-400">
          Form submitted successfully
        </div>
      )}
    </FadeIn>
  );
}

export default memo(CanvasFormInner);
