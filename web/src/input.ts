export interface FlipperInput {
  left: boolean;
  right: boolean;
}

const FLIPPER_KEYS: Record<string, keyof FlipperInput> = {
  ArrowLeft: "left", a: "left", A: "left", z: "left", Z: "left",
  ArrowRight: "right", d: "right", D: "right", "/": "right",
};
const LAUNCH_KEYS = new Set([" ", "Enter", "ArrowUp", "w", "W"]);

/**
 * Bind flipper keys to `input`. Launch keys call `onLaunch`, which returns
 * true when it launched (the key is then consumed). Losing window focus
 * drops both flippers, since the matching keyup never arrives. Returns the cleanup.
 */
export function bindKeyboard(input: FlipperInput, onLaunch: () => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    const side = FLIPPER_KEYS[e.key];
    if (side) {
      input[side] = true;
      e.preventDefault();
    } else if (LAUNCH_KEYS.has(e.key) && onLaunch()) {
      e.preventDefault();
    }
  };
  const up = (e: KeyboardEvent) => {
    const side = FLIPPER_KEYS[e.key];
    if (side) input[side] = false;
  };
  const blur = () => {
    input.left = false;
    input.right = false;
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
  };
}
