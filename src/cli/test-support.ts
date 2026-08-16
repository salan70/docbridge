import type { CliIo } from "./index";

export type Captured = {
  readonly out: string;
  readonly err: string;
  io: CliIo;
};

export function capture(): Captured {
  const state = { out: "", err: "" };
  return {
    get out() {
      return state.out;
    },
    get err() {
      return state.err;
    },
    io: {
      stdout: (text) => {
        state.out += text;
      },
      stderr: (text) => {
        state.err += text;
      },
    },
  };
}
