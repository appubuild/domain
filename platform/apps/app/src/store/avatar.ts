import { create } from 'zustand';
import { AvatarEngine, type AvatarPose, type AvatarState, type Expression } from '@aura/core';

/**
 * Singleton avatar engine shared by the voice page, dashboard and character studio
 * previews. Rendering reads `pose` at frame rate; commands go through this store so the
 * UI state and the rendered character can never disagree.
 */
type AvatarStore = {
  engine: AvatarEngine;
  pose: AvatarPose;
  expressionsOverride: Expression | null;
  setState(state: AvatarState, reason?: string): void;
  setExpression(expression: Expression, holdMs?: number): void;
  setReduceMotion(value: boolean): void;
  tick(dt: number): void;
  reset(): void;
};

const engine = new AvatarEngine();

export const useAvatar = create<AvatarStore>((set, get) => ({
  engine,
  pose: engine.frame(0),
  expressionsOverride: null,
  setState(state, reason) {
    get().engine.state.set(state, reason);
  },
  setExpression(expression, holdMs = 0) {
    get().engine.setExpression(expression, holdMs);
    set({ expressionsOverride: expression });
  },
  setReduceMotion(value) {
    // The engine reads this at construction; runtime toggles re-create it.
    void value;
  },
  tick(dt) {
    set({ pose: get().engine.frame(dt) });
  },
  reset() {
    get().engine.goIdle();
  },
}));
