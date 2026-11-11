import * as React from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Float, PerspectiveCamera } from '@react-three/drei';
import { AvatarEngine, type AvatarPose, type AvatarSpec } from '@aura/core/avatar';
import { AvatarModel } from './AvatarModel';
import { cn } from '@/lib/utils';

/**
 * AvatarStage renders a character with the shared AvatarEngine driving the rig.
 * `engine` can be passed in (Live Voice page owns one) or created internally
 * (Character Studio previews, dashboard).
 */
export type AvatarStageProps = {
  spec: AvatarSpec;
  engine?: AvatarEngine;
  height?: number | string;
  className?: string;
  quality?: 'low' | 'medium' | 'high';
  interactive?: boolean;
  mode?: 'full' | 'floating' | 'compact';
  reduceMotion?: boolean;
  onPose?: (pose: AvatarPose) => void;
};

export function AvatarStage({ spec, engine: external, height = 420, className, quality = 'medium', interactive = true, mode = 'full', reduceMotion, onPose }: AvatarStageProps) {
  const [failed, setFailed] = React.useState<string | null>(null);
  const engineRef = React.useRef<AvatarEngine | null>(external ?? null);
  if (!engineRef.current) engineRef.current = new AvatarEngine({ reducedMotion: reduceMotion, random: () => 0 });
  const engine = engineRef.current;
  const poseRef = React.useRef<AvatarPose>(engine.frame(0));

  React.useEffect(() => {
    if (external && external !== engine) {
      engineRef.current = external;
      poseRef.current = external.frame(0);
    }
  }, [external, engine]);

  React.useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pose = engineRef.current!.frame(dt);
      poseRef.current = pose;
      onPose?.(pose);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [onPose]);

  if (failed) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-6 text-center', className)} style={{ height }}>
        <p className="text-sm font-medium text-amber-200">3D preview unavailable in this environment</p>
        <p className="max-w-sm text-xs leading-relaxed text-amber-200/60">{failed}</p>
        <p className="text-[11px] text-slate-500">The character is still fully configured and will render in the desktop app with hardware WebGL.</p>
      </div>
    );
  }

  return (
    <div className={cn('relative overflow-hidden rounded-2xl', className)} style={{ height }}>
      <div className="pointer-events-none absolute inset-0 z-0" style={{ background: backgroundFor(spec.background) }} />
      <Canvas
        shadows
        dpr={quality === 'high' ? [1, 2] : quality === 'medium' ? [1, 1.5] : 1}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: mode === 'compact' ? [0, 0.15, 3.1] : [0, 0.1, 2.35], fov: mode === 'compact' ? 26 : 30 }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
        onError={(err) => setFailed(err instanceof Error ? err.message : 'WebGL could not initialise.')}
        fallback={<div className="flex h-full items-center justify-center text-xs text-slate-500">WebGL is not available in this browser.</div>}
        style={{ touchAction: 'none' }}
      >
        <PerspectiveCamera makeDefault position={mode === 'compact' ? [0, 0.15, 3.1] : [0, 0.1, 2.35]} fov={mode === 'compact' ? 26 : 30} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[2.5, 3.5, 2]} intensity={1.15} castShadow shadow-mapSize={[1024, 1024]} />
        <pointLight position={[-2, 1.2, 1.4]} intensity={1.4} color={spec.palette.accent} distance={7} />
        <pointLight position={[0, -0.4, 2]} intensity={0.6} color={spec.palette.glow} distance={5} />
        <spotLight position={[0, 2.6, 0.6]} angle={0.5} penumbra={0.7} intensity={1.2} color="#dbeafe" />
        <React.Suspense fallback={null}>
          <Float speed={reduceMotion ? 0 : 1.1} rotationIntensity={reduceMotion ? 0 : 0.06} floatIntensity={reduceMotion ? 0 : 0.18}>
            <AvatarModel spec={spec} poseRef={poseRef} quality={quality} />
          </Float>
          <ContactShadows position={[0, -0.92, 0]} opacity={0.35} scale={3.2} blur={2.6} far={2.4} color={spec.palette.accent} />
          <Environment preset="night" environmentIntensity={0.35} />
        </React.Suspense>
        {interactive ? null : null}
      </Canvas>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-950/90 to-transparent" />
    </div>
  );
}

function backgroundFor(kind: AvatarSpec['background']): string {
  switch (kind) {
    case 'holo-room':
      return 'radial-gradient(120% 90% at 50% 5%, rgba(56,189,248,0.16), transparent 55%), linear-gradient(rgba(56,189,248,0.05) 1px, transparent 1px) 0 0 / 40px 40px, linear-gradient(90deg, rgba(56,189,248,0.05) 1px, transparent 1px) 0 0 / 40px 40px, radial-gradient(circle at 50% 100%, rgba(29,78,216,0.25), transparent 60%)';
    case 'gradient':
      return 'radial-gradient(90% 80% at 50% 10%, rgba(255,255,255,0.07), transparent 60%), linear-gradient(180deg, rgba(15,23,42,0.2), rgba(2,6,23,0.85))';
    default:
      return 'radial-gradient(90% 80% at 50% 20%, rgba(255,255,255,0.04), transparent 60%)';
  }
}
