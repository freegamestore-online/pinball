import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { FlipperButton } from "./App";

beforeEach(() => {
  // jsdom lacks these; layout and pointer capture are irrelevant here.
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("pauses and resumes from the topbar while a ball is in play", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
      render(<App />);
      expect(screen.queryByLabelText("Pause")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Start"));
      fireEvent.click(screen.getByText("Launch"));
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.click(screen.getByLabelText("Pause"));
      expect(screen.getByText("PAUSED")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Resume"));
      expect(screen.queryByText("PAUSED")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  }, 30_000);
});

describe("FlipperButton", () => {
  it("keeps the flipper up when the finger drifts off the button", () => {
    const inputRef = { current: { left: false, right: false } };
    render(<FlipperButton label="FLIP" align="left" inputRef={inputRef} side="left" />);
    const btn = screen.getByLabelText("left flipper");
    fireEvent.pointerDown(btn, { pointerId: 1 });
    expect(inputRef.current.left).toBe(true);
    fireEvent.pointerLeave(btn, { pointerId: 1 });
    expect(inputRef.current.left).toBe(true);
    fireEvent.pointerUp(btn, { pointerId: 1 });
    expect(inputRef.current.left).toBe(false);
  });
});
