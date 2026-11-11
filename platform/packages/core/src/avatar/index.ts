/**
 * Browser-safe avatar surface.
 *
 * The package root also exports the SQLite drivers (Node-only). Browser clients must
 * import from `@aura/core/avatar` so no `node:` builtin is ever pulled into a bundle.
 */
export { AVATAR_STATES, CharacterStateMachine } from './state.js';
export type { AvatarState, StateChange } from './state.js';
export { EXPRESSIONS, FACE_PRESETS, STATE_EXPRESSION, ExpressionController, blendFace, inferExpressionFromText, lerp } from './expressions.js';
export type { Expression, FaceParams, EmotionCue } from './expressions.js';
export { VISEMES, VISEME_SHAPES, LipSyncEngine, textToVisemeFrames, shapeToMouth, smoothMouth, rmsFromFrequencyData } from './visemes.js';
export type { Viseme, MouthShape, MouthFrame, VisemeFrame, LipSyncMode } from './visemes.js';
export { AvatarEngine } from './engine.js';
export type { AvatarPose, AvatarEngineOptions } from './engine.js';
export { EnergyVad, DEFAULT_VAD, rmsTimeDomain, zeroCrossingRate } from './vad.js';
export type { VadConfig, VadDecision } from './vad.js';
export { avatarSpecSchema } from '../characters/types.js';
export type { AvatarSpec } from '../characters/types.js';
