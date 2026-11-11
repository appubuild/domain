/**
 * Character state machine shared by UI, audio and avatar renderer.
 * Exactly one state is active; transitions are validated so the avatar can never
 * "speak while erroring" or get stuck in PROCESSING.
 */
export const AVATAR_STATES = ['IDLE', 'LISTENING', 'PROCESSING', 'THINKING', 'SPEAKING', 'INTERRUPTED', 'ERROR'] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

const TRANSITIONS: Record<AvatarState, readonly AvatarState[]> = {
  IDLE: ['LISTENING', 'PROCESSING', 'THINKING', 'SPEAKING', 'ERROR'],
  LISTENING: ['PROCESSING', 'THINKING', 'IDLE', 'INTERRUPTED', 'ERROR'],
  PROCESSING: ['THINKING', 'SPEAKING', 'IDLE', 'INTERRUPTED', 'ERROR'],
  THINKING: ['PROCESSING', 'SPEAKING', 'IDLE', 'INTERRUPTED', 'ERROR'],
  SPEAKING: ['IDLE', 'LISTENING', 'INTERRUPTED', 'ERROR'],
  INTERRUPTED: ['LISTENING', 'IDLE', 'ERROR'],
  ERROR: ['IDLE', 'LISTENING'],
};

export type StateChange = { from: AvatarState; to: AvatarState; at: number; reason?: string };
export type StateListener = (change: StateChange) => void;

export class CharacterStateMachine {
  private state: AvatarState = 'IDLE';
  private readonly listeners = new Set<StateListener>();
  private history: StateChange[] = [];

  get current(): AvatarState {
    return this.state;
  }

  canTransition(to: AvatarState): boolean {
    return to === this.state || TRANSITIONS[this.state].includes(to);
  }

  set(to: AvatarState, reason?: string): boolean {
    if (to === this.state) return false;
    if (!this.canTransition(to)) return false;
    const change: StateChange = { from: this.state, to, at: Date.now(), reason };
    this.state = to;
    this.history.push(change);
    if (this.history.length > 100) this.history.shift();
    for (const l of this.listeners) l(change);
    return true;
  }

  /** Force a state (error recovery / session reset). Always allowed, always announced. */
  reset(reason = 'reset'): void {
    this.set('IDLE', reason);
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recentChanges(): readonly StateChange[] {
    return this.history;
  }
}
