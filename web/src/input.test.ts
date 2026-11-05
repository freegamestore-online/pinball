import { describe, expect, it, vi } from "vitest";
import { bindKeyboard, type FlipperInput } from "./input";

const press = (type: "keydown" | "keyup", key: string) => {
  const e = new KeyboardEvent(type, { key, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

describe("bindKeyboard", () => {
  it("raises and drops flippers", () => {
    const input: FlipperInput = { left: false, right: false };
    const unbind = bindKeyboard(input, () => false);
    press("keydown", "z");
    press("keydown", "ArrowRight");
    expect(input).toEqual({ left: true, right: true });
    press("keyup", "z");
    expect(input).toEqual({ left: false, right: true });
    unbind();
  });

  it("drops both flippers when the window loses focus", () => {
    const input: FlipperInput = { left: false, right: false };
    const unbind = bindKeyboard(input, () => false);
    press("keydown", "a");
    press("keydown", "d");
    window.dispatchEvent(new Event("blur"));
    expect(input).toEqual({ left: false, right: false });
    unbind();
  });

  it("only consumes launch keys when a ball was launched", () => {
    const launch = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const unbind = bindKeyboard({ left: false, right: false }, launch);
    expect(press("keydown", " ").defaultPrevented).toBe(true);
    expect(press("keydown", "Enter").defaultPrevented).toBe(false);
    expect(launch).toHaveBeenCalledTimes(2);
    unbind();
  });
});
