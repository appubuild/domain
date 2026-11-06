/** The vitest setup file: the one thing every test needs and no test should say.
 *
 * Cleanup is the whole of it for now. `@testing-library/react` only registers
 * its automatic cleanup when vitest runs with globals enabled, and globals are
 * off — a test that says `expect` without importing it is a test whose
 * dependencies are invisible. So cleanup is wired here instead, and a component
 * test cannot leak its DOM into the next one.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
