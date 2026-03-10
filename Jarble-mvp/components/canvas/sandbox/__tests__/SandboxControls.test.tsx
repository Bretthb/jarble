import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SandboxControlBar, SandboxStoppedOverlay, SandboxShell } from "../SandboxControls";

describe("SandboxControlBar", () => {
  it("shows Stop button when not stopped", () => {
    render(<SandboxControlBar stopped={false} onToggle={() => {}} />);
    expect(screen.getByText("Stop")).toBeDefined();
  });

  it("shows Restart button when stopped", () => {
    render(<SandboxControlBar stopped={true} onToggle={() => {}} />);
    expect(screen.getByText("Restart")).toBeDefined();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<SandboxControlBar stopped={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("Stop"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders SVG icon", () => {
    const { container } = render(<SandboxControlBar stopped={false} onToggle={() => {}} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("SandboxStoppedOverlay", () => {
  it("shows stopped message", () => {
    render(<SandboxStoppedOverlay />);
    expect(screen.getByText(/Sandbox stopped/)).toBeDefined();
  });

  it("mentions restart in message", () => {
    render(<SandboxStoppedOverlay />);
    expect(screen.getByText(/Restart to resume/)).toBeDefined();
  });
});

describe("SandboxShell", () => {
  it("shows children when not stopped", () => {
    render(
      <SandboxShell stopped={false} onToggle={() => {}}>
        <div data-testid="iframe-content">Active Content</div>
      </SandboxShell>
    );
    expect(screen.getByTestId("iframe-content")).toBeDefined();
  });

  it("shows stopped overlay when stopped", () => {
    render(
      <SandboxShell stopped={true} onToggle={() => {}}>
        <div data-testid="iframe-content">Active Content</div>
      </SandboxShell>
    );
    expect(screen.queryByTestId("iframe-content")).toBeNull();
    expect(screen.getByText(/Sandbox stopped/)).toBeDefined();
  });

  it("always shows control bar", () => {
    render(
      <SandboxShell stopped={false} onToggle={() => {}}>
        <div>Content</div>
      </SandboxShell>
    );
    expect(screen.getByText("Stop")).toBeDefined();
  });

  it("passes onToggle to control bar", () => {
    const onToggle = vi.fn();
    render(
      <SandboxShell stopped={false} onToggle={onToggle}>
        <div>Content</div>
      </SandboxShell>
    );
    fireEvent.click(screen.getByText("Stop"));
    expect(onToggle).toHaveBeenCalled();
  });
});
