import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AvatarState } from '@aura/core/avatar';

/**
 * Lightweight canvas avatar indicator. Used where a WebGL canvas would be wasteful
 * (sidebar, list rows, compact mode). It renders real state: pulsing ring frequency and
 * colour follow the character state; the bars show live audio level when speaking.
 *
 * This is an *indicator*, not the animated character — the full rig lives in AvatarStage.
 */
export function AvatarOrb({ state, accent = '#38bdf8', level = 0, size = 44, className, label }: { state: AvatarState; accent?: string; level?: number; size?: number; className?: string; label?: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const levelRef = React.useRef(level);
  levelRef.current = level;
  const stateRef = React.useRef(state);
  stateRef.current = state;

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    let raf = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const s = stateRef.current;
      const baseR = size * 0.26;
      const pulse = s === 'LISTENING' ? Math.sin(t * 4) * 0.08 + 1 : s === 'THINKING' || s === 'PROCESSING' ? 1 + Math.sin(t * 1.6) * 0.03 : 1 + Math.sin(t * 1.1) * 0.02;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
      glow.addColorStop(0, hexA(accent, 0.55));
      glow.addColorStop(0.6, hexA(accent, 0.08));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hexA(accent, s === 'ERROR' ? 0.9 : 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * pulse, 0, Math.PI * 2);
      ctx.stroke();

      if (s === 'SPEAKING') {
        const bars = 9;
        ctx.fillStyle = accent;
        for (let i = 0; i < bars; i++) {
          const h = (0.12 + Math.abs(Math.sin(t * 7 + i * 0.7)) * 0.55) * (0.35 + levelRef.current) * size * 0.22;
          const x = cx - (bars * 3.2) / 2 + i * 3.2;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x, cy - h / 2, 1.6, h);
        }
        ctx.globalAlpha = 1;
      } else if (s === 'THINKING' || s === 'PROCESSING') {
        for (let i = 0; i < 3; i++) {
          const a = 0.25 + 0.65 * Math.abs(Math.sin(t * 2 - i * 0.6));
          ctx.fillStyle = hexA(accent, a);
          ctx.beginPath();
          ctx.arc(cx - 6 + i * 6, cy, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (s === 'LISTENING') {
        ctx.strokeStyle = hexA(accent, 0.35 + levelRef.current);
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, baseR + i * 5 + Math.sin(t * 3 + i) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (s === 'ERROR') {
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 4);
        ctx.lineTo(cx + 4, cy + 4);
        ctx.moveTo(cx + 4, cy - 4);
        ctx.lineTo(cx - 4, cy + 4);
        ctx.stroke();
      }
      ctx.fillStyle = hexA(accent, 0.95);
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.07 * (1 + levelRef.current * 0.5), 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [accent, size]);

  return <canvas ref={ref} style={{ width: size, height: size }} className={cn('shrink-0', className)} role="img" aria-label={label ?? `Character state: ${state}`} />;
}

function hexA(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
