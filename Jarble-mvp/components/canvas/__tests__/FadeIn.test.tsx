import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FadeIn } from "../FadeIn";

describe("FadeIn", () => {
  it("renders children", () => {
    render(<FadeIn>Hello World</FadeIn>);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("applies animate-fadeIn class by default", () => {
    render(<FadeIn>Content</FadeIn>);
    const el = screen.getByText("Content");
    expect(el.className).toContain("animate-fadeIn");
  });

  it("accepts and appends a custom className", () => {
    render(<FadeIn className="my-custom-class">Styled</FadeIn>);
    const el = screen.getByText("Styled");
    expect(el.className).toContain("animate-fadeIn");
    expect(el.className).toContain("my-custom-class");
  });

  it("sets animationDelay style when delay > 0", () => {
    render(<FadeIn delay={200}>Delayed</FadeIn>);
    const el = screen.getByText("Delayed");
    expect(el.style.animationDelay).toBe("200ms");
  });

  it("does not set animationDelay when delay is 0", () => {
    render(<FadeIn delay={0}>No Delay</FadeIn>);
    const el = screen.getByText("No Delay");
    expect(el.style.animationDelay).toBe("");
  });

  it("does not set animationDelay when delay is omitted", () => {
    render(<FadeIn>Default</FadeIn>);
    const el = screen.getByText("Default");
    expect(el.style.animationDelay).toBe("");
  });

  it("merges inline style with animationDelay", () => {
    render(
      <FadeIn delay={300} style={{ color: "red" }}>
        Merged
      </FadeIn>,
    );
    const el = screen.getByText("Merged");
    expect(el.style.color).toBe("red");
    expect(el.style.animationDelay).toBe("300ms");
  });

  it("passes through extra HTML attributes", () => {
    render(
      <FadeIn data-testid="fade-wrapper" role="region">
        Accessible
      </FadeIn>,
    );
    const el = screen.getByTestId("fade-wrapper");
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("role")).toBe("region");
  });

  it("renders complex children", () => {
    render(
      <FadeIn>
        <div data-testid="child-1">One</div>
        <div data-testid="child-2">Two</div>
      </FadeIn>,
    );
    expect(screen.getByTestId("child-1")).toBeInTheDocument();
    expect(screen.getByTestId("child-2")).toBeInTheDocument();
  });
});
