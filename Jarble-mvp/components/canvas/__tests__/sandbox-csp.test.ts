import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { createElement } from "react";

// Mock the CanvasActionContext
vi.mock("../CanvasActionContext", () => ({
  useCanvasAction: () => ({
    dispatch: vi.fn(),
    blockId: "test-block",
    component: "sandbox",
  }),
}));

// Mock sanitize (DOMPurify)
vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (html: string) => html,
}));

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
}));

describe("CanvasSandbox CSP and Security", () => {
  // Dynamically import after mocks
  async function importSandbox() {
    const mod = await import("../components/CanvasSandbox");
    return mod.default;
  }

  it('iframe has sandbox="allow-scripts allow-popups" (no allow-same-origin)', async () => {
    const CanvasSandbox = await importSandbox();
    const { container } = render(
      createElement(CanvasSandbox, {
        html: "<div>Hello</div>",
      }),
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandboxAttr = iframe!.getAttribute("sandbox");
    expect(sandboxAttr).toBe("allow-scripts allow-popups");
    expect(sandboxAttr).not.toContain("allow-same-origin");
  });

  it("srcdoc contains Content-Security-Policy meta tag", async () => {
    const CanvasSandbox = await importSandbox();
    const { container } = render(
      createElement(CanvasSandbox, {
        html: "<div>CSP Test</div>",
      }),
    );

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") || "";
    expect(srcdoc).toContain("Content-Security-Policy");
  });

  it("CSP includes only trusted CDN origins", async () => {
    const CanvasSandbox = await importSandbox();
    const { container } = render(
      createElement(CanvasSandbox, {
        html: "<div>CDN Test</div>",
      }),
    );

    const iframe = container.querySelector("iframe");
    const srcdoc = iframe!.getAttribute("srcdoc") || "";

    // Verify all 10 trusted CDN origins are present
    const expectedOrigins = [
      "https://cdn.jsdelivr.net",
      "https://cdnjs.cloudflare.com",
      "https://unpkg.com",
      "https://cdn.tailwindcss.com",
      "https://esm.sh",
      "https://threejs.org",
      "https://d3js.org",
      "https://cdn.plot.ly",
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ];

    for (const origin of expectedOrigins) {
      expect(srcdoc).toContain(origin);
    }

    // Verify CSP directives are present
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain("script-src");
    expect(srcdoc).toContain("style-src");
    expect(srcdoc).toContain("frame-src 'none'");
  });

  it("does not include wildcard CSP origins", async () => {
    const CanvasSandbox = await importSandbox();
    const { container } = render(
      createElement(CanvasSandbox, {
        html: "<div>No wildcards</div>",
      }),
    );

    const iframe = container.querySelector("iframe");
    const srcdoc = iframe!.getAttribute("srcdoc") || "";

    // The CSP content attribute inside the srcdoc uses &quot; for quote escaping
    // Extract the CSP string using either escaped or unescaped quote patterns
    const cspMatch = srcdoc.match(
      /Content-Security-Policy[^>]*content=(?:"|&quot;)([\s\S]*?)(?:"|&quot;)>/,
    );
    expect(cspMatch).not.toBeNull();
    const cspContent = cspMatch![1];

    // Should not contain wildcard origins
    expect(cspContent).not.toContain(" * ");
    expect(cspContent).not.toMatch(/\s\*;/);
    expect(cspContent).not.toMatch(/\s\*$/);
  });

  it("removes iframe and shows message when stopped", async () => {
    const CanvasSandbox = await importSandbox();
    const { container } = render(
      createElement(CanvasSandbox, {
        html: "<div>Stoppable</div>",
      }),
    );

    // Initially should have an iframe
    expect(container.querySelector("iframe")).not.toBeNull();

    // Click the stop button using fireEvent (properly triggers React state update)
    const stopButton = container.querySelector("button");
    expect(stopButton).not.toBeNull();
    fireEvent.click(stopButton!);

    // After stopping, iframe should be removed
    expect(container.querySelector("iframe")).toBeNull();
    // Should show stopped message
    expect(container.textContent).toContain("Sandbox stopped");
  });
});
