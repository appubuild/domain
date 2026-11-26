/**
 * React bindings for the content loader.
 *
 * `useContentState()` subscribes a component to the load state, and
 * `useContentReady()` is the gate the public site uses: nothing renders until
 * the API datasets have been applied, so a visitor never sees a bundled copy
 * and a service created a minute ago is already there on first paint.
 */
import { useSyncExternalStore } from 'react'
import { API_ENABLED } from './client'
import {
  getContentState,
  reloadContent,
  subscribeContent,
  type ContentState,
} from './bootstrapContent'

export const useContentState = (): ContentState =>
  useSyncExternalStore(subscribeContent, getContentState, getContentState)

export type ContentStatus = 'loading' | 'ready' | 'offline' | 'bundled'

export const useContentStatus = (): ContentStatus => {
  const state = useContentState()

  if (!API_ENABLED) return 'bundled'
  if (state.source === 'loading') return 'loading'
  if (state.source === 'fallback') return 'offline'
  return 'ready'
}

export const retryContent = (): void => {
  void reloadContent()
}
