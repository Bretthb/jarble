import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SandboxConfigPanel } from "../SandboxConfigPanel";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSchema(
  properties: Record<string, any>,
  required?: string[]
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required ? { required } : {}),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SandboxConfigPanel", () => {
  describe("rendering", () => {
    it("renders nothing for invalid schema (non-object type)", () => {
      const { container } = render(
        <SandboxConfigPanel
          configSchema={{ type: "string" }}
          values={{}}
          onChange={() => {}}
        />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders nothing for null schema", () => {
      const { container } = render(
        <SandboxConfigPanel
          configSchema={null as any}
          values={{}}
          onChange={() => {}}
        />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders nothing when properties is empty", () => {
      const { container } = render(
        <SandboxConfigPanel
          configSchema={makeSchema({})}
          values={{}}
          onChange={() => {}}
        />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders Configuration button", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      expect(screen.getByText("Configuration")).toBeDefined();
    });

    it("shows Show text when collapsed", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      expect(screen.getByText("Show")).toBeDefined();
    });

    it("shows Hide text when expanded", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("Hide")).toBeDefined();
    });
  });

  describe("string fields", () => {
    it("renders string field as text input", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string", title: "Name" } })}
          values={{ name: "hello" }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByDisplayValue("hello");
      expect(input).toBeDefined();
      expect(input.getAttribute("type")).toBe("text");
    });

    it("calls onChange when string field changes", () => {
      const onChange = vi.fn();
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string" } })}
          values={{ name: "old" }}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      fireEvent.change(screen.getByDisplayValue("old"), { target: { value: "new" } });
      expect(onChange).toHaveBeenCalledWith({ name: "new" });
    });

    it("renders enum as select dropdown", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({
            color: { type: "string", enum: ["red", "green", "blue"] },
          })}
          values={{ color: "red" }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const options = screen.getAllByRole("option");
      expect(options.length).toBe(3);
    });

    it("shows description as placeholder", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({
            name: { type: "string", description: "Enter your name" },
          })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByPlaceholderText("Enter your name")).toBeDefined();
    });
  });

  describe("number fields", () => {
    it("renders number field as number input", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ count: { type: "number", title: "Count" } })}
          values={{ count: 42 }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByDisplayValue("42");
      expect(input.getAttribute("type")).toBe("number");
    });

    it("calls onChange when number field changes", () => {
      const onChange = vi.fn();
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ count: { type: "number" } })}
          values={{ count: 5 }}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "10" } });
      expect(onChange).toHaveBeenCalledWith({ count: 10 });
    });

    it("respects min and max on number field", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({
            age: { type: "number", minimum: 0, maximum: 120 },
          })}
          values={{ age: 25 }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByDisplayValue("25");
      expect(input.getAttribute("min")).toBe("0");
      expect(input.getAttribute("max")).toBe("120");
    });

    it("uses step 1 for integer fields", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ count: { type: "integer" } })}
          values={{ count: 5 }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByDisplayValue("5");
      expect(input.getAttribute("step")).toBe("1");
    });

    it("uses step any for number fields", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ ratio: { type: "number" } })}
          values={{ ratio: 0.5 }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByDisplayValue("0.5");
      expect(input.getAttribute("step")).toBe("any");
    });
  });

  describe("boolean fields", () => {
    it("renders boolean as checkbox", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ enabled: { type: "boolean" } })}
          values={{ enabled: true }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it("shows Enabled text when true", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ enabled: { type: "boolean" } })}
          values={{ enabled: true }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("Enabled")).toBeDefined();
    });

    it("shows Disabled text when false", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ enabled: { type: "boolean" } })}
          values={{ enabled: false }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("Disabled")).toBeDefined();
    });

    it("calls onChange when checkbox toggled", () => {
      const onChange = vi.fn();
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ enabled: { type: "boolean" } })}
          values={{ enabled: false }}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      fireEvent.click(screen.getByRole("checkbox"));
      expect(onChange).toHaveBeenCalledWith({ enabled: true });
    });
  });

  describe("object/array fields", () => {
    it("renders object type as textarea with JSON", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ data: { type: "object" } })}
          values={{ data: { key: "value" } }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const textarea = screen.getByPlaceholderText("JSON value");
      expect((textarea as HTMLTextAreaElement).value).toContain('"key"');
    });

    it("renders array type as textarea", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ items: { type: "array" } })}
          values={{ items: [1, 2, 3] }}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const textarea = screen.getByPlaceholderText("JSON value");
      expect((textarea as HTMLTextAreaElement).value).toContain("[");
    });

    it("passes valid JSON through JSON.parse", () => {
      const onChange = vi.fn();
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ data: { type: "object" } })}
          values={{ data: {} }}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      fireEvent.change(screen.getByPlaceholderText("JSON value"), {
        target: { value: '{"key": "val"}' },
      });
      expect(onChange).toHaveBeenCalledWith({ data: { key: "val" } });
    });

    it("keeps invalid JSON as string", () => {
      const onChange = vi.fn();
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ data: { type: "object" } })}
          values={{ data: {} }}
          onChange={onChange}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      fireEvent.change(screen.getByPlaceholderText("JSON value"), {
        target: { value: "{invalid json" },
      });
      expect(onChange).toHaveBeenCalledWith({ data: "{invalid json" });
    });
  });

  describe("defaults", () => {
    it("uses explicit default for string", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({
            name: { type: "string", default: "default-name" },
          })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByDisplayValue("default-name")).toBeDefined();
    });

    it("uses empty string default for string without default", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const input = screen.getByRole("textbox") as HTMLInputElement;
      expect(input.value).toBe("");
    });

    it("uses 0 default for number without default", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ count: { type: "number" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByDisplayValue("0")).toBeDefined();
    });

    it("uses minimum as default for number with minimum", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ count: { type: "number", minimum: 5 } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByDisplayValue("5")).toBeDefined();
    });

    it("uses false default for boolean without default", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ flag: { type: "boolean" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });
  });

  describe("required fields", () => {
    it("shows required asterisk for required fields", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema(
            { name: { type: "string", title: "Name" } },
            ["name"]
          )}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("*")).toBeDefined();
    });

    it("does not show asterisk for optional fields", () => {
      const { container } = render(
        <SandboxConfigPanel
          configSchema={makeSchema({ name: { type: "string", title: "Name" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      const redStars = container.querySelectorAll(".text-red-400");
      expect(redStars.length).toBe(0);
    });
  });

  describe("labels and descriptions", () => {
    it("uses title as label when provided", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ x: { type: "string", title: "X Coordinate" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("X Coordinate")).toBeDefined();
    });

    it("falls back to property name when no title", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({ myField: { type: "string" } })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("myField")).toBeDefined();
    });

    it("renders description text", () => {
      render(
        <SandboxConfigPanel
          configSchema={makeSchema({
            name: { type: "string", description: "Enter your full name" },
          })}
          values={{}}
          onChange={() => {}}
        />
      );
      fireEvent.click(screen.getByText("Configuration"));
      expect(screen.getByText("Enter your full name")).toBeDefined();
    });
  });
});
