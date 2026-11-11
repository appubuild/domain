import * as React from 'react';

export type ServerEvent = { type: string; at?: number; [key: string]: unknown };

/**
 * Subscribes to the server's `/ws/events` broadcast (task progress, character changes,
 * skill logs, emergency stop…). Reconnects with exponential backoff and reports the real
 * connection state so pages can show "live" vs "polling" honestly.
 */
export function useEventStream(onEvent: (event: ServerEvent) => void, enabled = true): { connected: boolean } {
  const [connected, setConnected] = React.useState(false);
  const handler = React.useRef(onEvent);
  handler.current = onEvent;

  React.useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws/events`);
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
        ping = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25_000);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as ServerEvent;
          handler.current(data);
        } catch {
          /* non-JSON frames are ignored rather than crashing the UI */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (ping) clearInterval(ping);
        if (closed) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(15_000, 800 * 2 ** attempt));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [enabled]);

  return { connected };
}
