import * as React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { AvatarPose, AvatarSpec } from '@aura/core/avatar';
import { VISEME_SHAPES, lerp } from '@aura/core/avatar';

/**
 * Procedural character rig. Every visible feature comes from the character's AvatarSpec:
 * head/eye/hair/body/accessory geometry families, palette, materials and hologram flags.
 * Animation is driven by `AvatarPose` (state machine + expression + visemes), so the
 * body cannot animate independently of the voice pipeline.
 *
 * This is a real rig (a hierarchy of meshes with per-frame transforms and morph-like
 * blends), not a moving picture. Imported VRM characters use `VrmModel` instead.
 */
export type AvatarModelProps = {
  spec: AvatarSpec;
  poseRef: React.MutableRefObject<AvatarPose>;
  quality?: 'low' | 'medium' | 'high';
};

const HAIR_SEGMENTS = 7;

export function AvatarModel({ spec, poseRef, quality = 'medium' }: AvatarModelProps) {
  const root = React.useRef<THREE.Group>(null);
  const torso = React.useRef<THREE.Group>(null);
  const head = React.useRef<THREE.Group>(null);
  const jaw = React.useRef<THREE.Mesh>(null);
  const mouth = React.useRef<THREE.Mesh>(null);
  const eyeL = React.useRef<THREE.Mesh>(null);
  const eyeR = React.useRef<THREE.Mesh>(null);
  const browL = React.useRef<THREE.Mesh>(null);
  const browR = React.useRef<THREE.Mesh>(null);
  const halo = React.useRef<THREE.Mesh>(null);
  const hairGroup = React.useRef<THREE.Group>(null);
  const visor = React.useRef<THREE.Mesh>(null);

  const segments = quality === 'low' ? 16 : quality === 'medium' ? 28 : 40;

  const palette = React.useMemo(
    () => ({
      primary: new THREE.Color(spec.palette.primary),
      secondary: new THREE.Color(spec.palette.secondary),
      accent: new THREE.Color(spec.palette.accent),
      glow: new THREE.Color(spec.palette.glow),
      skin: new THREE.Color(spec.palette.skin),
      hair: new THREE.Color(spec.palette.hair),
      eye: new THREE.Color(spec.palette.eye),
    }),
    [spec.palette],
  );

  const materials = React.useMemo(() => {
    const isWire = spec.head.material === 'wireframe';
    return {
      skin: new THREE.MeshStandardMaterial({
        color: palette.skin,
        roughness: spec.head.material === 'toon' ? 0.85 : 0.45,
        metalness: spec.head.material === 'glass' ? 0.35 : 0.08,
        transparent: spec.head.material === 'glass' || isWire,
        opacity: isWire ? 0.55 : spec.head.material === 'glass' ? 0.82 : 1,
      }),
      hair: new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.55, metalness: 0.15 }),
      hairAccent: new THREE.MeshStandardMaterial({
        color: spec.hair.accentStrand ? new THREE.Color(spec.hair.accentStrand) : palette.accent,
        emissive: palette.glow,
        emissiveIntensity: 0.25,
        roughness: 0.4,
      }),
      body: new THREE.MeshStandardMaterial({
        color: spec.body.style === 'hologram' ? palette.secondary : palette.primary,
        roughness: spec.body.style === 'techsuit' ? 0.25 : 0.7,
        metalness: spec.body.style === 'hologram' ? 0.6 : 0.2,
        transparent: spec.body.style === 'hologram',
        opacity: spec.body.style === 'hologram' ? 0.72 : 1,
        emissive: palette.accent,
        emissiveIntensity: spec.body.style === 'hologram' ? 0.22 : 0.05,
      }),
      trim: new THREE.MeshStandardMaterial({ color: palette.accent, emissive: palette.accent, emissiveIntensity: 0.9, roughness: 0.3 }),
      eyeWhite: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.3 }),
      iris: new THREE.MeshStandardMaterial({
        color: palette.eye,
        emissive: palette.eye,
        emissiveIntensity: spec.eyes.emissive,
        roughness: 0.15,
        metalness: 0.2,
      }),
      mouth: new THREE.MeshStandardMaterial({ color: '#4c1d1d', roughness: 0.8 }),
      teeth: new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.25 }),
      wire: new THREE.MeshBasicMaterial({ color: palette.glow, wireframe: true, transparent: true, opacity: 0.4 }),
      glassDark: new THREE.MeshStandardMaterial({ color: '#0b1220', roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.75 }),
    };
  }, [palette, spec]);

  React.useEffect(() => {
    return () => {
      for (const mat of Object.values(materials)) mat.dispose();
    };
  }, [materials]);

  const headGeom = React.useMemo(() => {
    const w = spec.head.width;
    const h = spec.head.height;
    const base = new THREE.SphereGeometry(0.5, segments, segments);
    const pos = base.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Jaw taper: narrow the lower third, sharper for angular faces.
      const lower = Math.max(0, -y / 0.5);
      const taper = 1 - Math.pow(lower, 1.6) * spec.head.jawTaper * 0.55;
      let nx = x * w * taper;
      const ny = y * h;
      let nz = z * Math.max(0.75, w) * (spec.head.shape === 'crystalline' ? 1.02 : 1);
      if (spec.head.shape === 'angular') {
        nx = Math.sign(nx) * Math.pow(Math.abs(nx), 0.86);
        nz = Math.sign(nz) * Math.pow(Math.abs(nz), 0.86);
      }
      if (spec.head.shape === 'rounded' || spec.head.shape === 'soft') {
        nx *= 1.04;
        nz *= 1.04;
      }
      pos.setXYZ(i, nx, ny, nz);
    }
    base.computeVertexNormals();
    return base;
  }, [spec.head, segments]);

  const eyePositions = React.useMemo(() => {
    const spread = spec.eyes.shape === 'sharp' ? 0.19 : spec.eyes.shape === 'almond' ? 0.2 : 0.21;
    return { x: spread * spec.head.width, y: 0.1 * spec.head.height, z: 0.44 * Math.max(0.75, spec.head.width) };
  }, [spec]);

  // Animation loop: single source of truth = poseRef (written by the avatar store).
  useFrame(() => {
    const p = poseRef.current;
    if (!p) return;
    if (root.current) {
      root.current.position.y = -0.92 + (p.breath - 0.5) * 0.012;
    }
    if (torso.current) {
      torso.current.scale.y = 1 + (p.breath - 0.5) * 0.016;
      torso.current.rotation.z = Math.sin(p.head.yaw * 0.6) * 0.02;
    }
    if (head.current) {
      head.current.rotation.set(p.head.pitch, p.head.yaw, p.head.roll);
    }
    // Eyes: blink via scale.y, gaze via small translation.
    const eyeScaleY = Math.max(0.04, p.face.eyeOpen);
    for (const eye of [eyeL.current, eyeR.current]) {
      if (!eye) continue;
      eye.scale.y = eyeScaleY;
      eye.scale.x = spec.eyes.scale * (1 - p.face.eyeSquint * 0.08);
      eye.position.x = (eye === eyeL.current ? 1 : -1) * eyePositions.x + p.gaze.x * 0.035;
      eye.position.y = eyePositions.y + p.gaze.y * 0.02;
    }
    if (browL.current && browR.current) {
      browL.current.position.y = 0.22 + p.face.browRaise * 0.045;
      browR.current.position.y = 0.22 + p.face.browRaise * 0.045;
      browL.current.rotation.z = -0.12 + p.face.browTilt * 0.3;
      browR.current.rotation.z = 0.12 - p.face.browTilt * 0.3;
    }
    // Mouth: viseme blends → jaw drop + mouth mesh scale + teeth reveal.
    const m = p.mouth;
    if (mouth.current) {
      const open = Math.max(0.02, m.openness);
      mouth.current.scale.set(0.09 + m.wide * 0.05 - m.round * 0.02, open * 0.17, 1);
      (mouth.current.material as THREE.MeshStandardMaterial).color.setRGB(0.24 + m.teeth * 0.55, 0.1 + m.teeth * 0.55, 0.12 + m.teeth * 0.5);
      mouth.current.position.y = 0.1 - open * 0.035;
    }
    if (jaw.current) {
      jaw.current.rotation.x = p.mouth.openness * 0.22;
    }
    if (halo.current) {
      halo.current.rotation.z += 0.006 + p.emphasis * 0.02;
      halo.current.rotation.x = Math.PI / 2 + Math.sin(performance.now() / 2400) * 0.1;
      halo.current.visible = spec.halo;
      const mat = halo.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.22 + p.emphasis * 0.35 + (p.speaking ? 0.12 : 0);
    }
    if (hairGroup.current) {
      hairGroup.current.rotation.z = p.head.roll * 0.4;
      hairGroup.current.position.y = Math.sin(performance.now() / 1800) * 0.004;
    }
    if (visor.current) {
      const mat = visor.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + p.emphasis * 1.4;
    }
  });

  const skinMat = spec.head.material === 'wireframe' ? materials.wire : materials.skin;

  return (
    <group ref={root} position={[0, -0.92, 0]} rotation={[0, 0, 0]}>
      {/* body */}
      <group ref={torso} position={[0, 0.5, 0]}>
        <mesh castShadow receiveShadow material={materials.body} geometry={undefined}>
          <capsuleGeometry args={[0.31 * spec.body.shoulderWidth, 0.62, 10, segments / 2]} />
        </mesh>
        {/* collar + tie / neckline accents */}
        <mesh position={[0, 0.42, 0.02]} material={materials.trim}>
          <torusGeometry args={[0.17, 0.018, 8, 32]} />
        </mesh>
        {spec.body.collar === 'tie' && (
          <mesh position={[0, 0.24, 0.245]} material={materials.trim}>
            <boxGeometry args={[0.05, 0.26, 0.02]} />
          </mesh>
        )}
        {spec.body.collar === 'high' && (
          <mesh position={[0, 0.46, 0]} material={materials.body}>
            <cylinderGeometry args={[0.16, 0.17, 0.2, segments]} />
          </mesh>
        )}
        {/* arms */}
        <mesh position={[0.36 * spec.body.shoulderWidth, 0.18, 0]} rotation={[0, 0, -0.18]} material={materials.body}>
          <capsuleGeometry args={[0.075, 0.5, 6, 18]} />
        </mesh>
        <mesh position={[-0.36 * spec.body.shoulderWidth, 0.18, 0]} rotation={[0, 0, 0.18]} material={materials.body}>
          <capsuleGeometry args={[0.075, 0.5, 6, 18]} />
        </mesh>
        {spec.body.style === 'techsuit' && (
          <>
            <mesh position={[0, 0.1, 0.235]} material={materials.trim}>
              <boxGeometry args={[0.1, 0.1, 0.02]} />
            </mesh>
            <mesh position={[0.36 * spec.body.shoulderWidth, 0.3, 0]} material={materials.trim}>
              <sphereGeometry args={[0.045, 12, 12]} />
            </mesh>
          </>
        )}
        {/* neck */}
        <mesh position={[0, 0.54, 0]} material={skinMat}>
          <cylinderGeometry args={[0.075, 0.09, 0.16, 18]} />
        </mesh>
      </group>

      {/* head */}
      <group ref={head} position={[0, 0.98, 0]}>
        <mesh castShadow geometry={headGeom} material={skinMat} />
        {spec.head.material === 'wireframe' && <mesh geometry={headGeom} material={materials.wire} scale={1.002} />}

        {/* brows */}
        <mesh ref={browL} position={[eyePositions.x, 0.22, eyePositions.z + 0.01]} rotation={[0, 0, -0.12]} material={materials.hair}>
          <boxGeometry args={[0.11, 0.012, 0.02]} />
        </mesh>
        <mesh ref={browR} position={[-eyePositions.x, 0.22, eyePositions.z + 0.01]} rotation={[0, 0, 0.12]} material={materials.hair}>
          <boxGeometry args={[0.11, 0.012, 0.02]} />
        </mesh>

        {/* eyes: white + iris + emissive pupil */}
        {[1, -1].map((side) => (
          <group key={side} position={[side * eyePositions.x, eyePositions.y, eyePositions.z]}>
            <mesh ref={side === 1 ? eyeL : eyeR} material={spec.eyes.shape === 'glow' ? materials.iris : materials.eyeWhite}>
              <sphereGeometry args={[0.062 * spec.eyes.scale, 20, 16]} />
            </mesh>
            <mesh position={[side * 0.004, 0, 0.035]} material={materials.iris}>
              <sphereGeometry args={[0.036 * spec.eyes.scale, 16, 14]} />
            </mesh>
          </group>
        ))}

        {/* nose */}
        <mesh position={[0, 0.02, eyePositions.z + 0.006]} material={skinMat}>
          <coneGeometry args={[0.022, 0.055, 10]} />
        </mesh>

        {/* mouth cavity + teeth indicator */}
        <group ref={jaw} position={[0, 0.1, 0]}>
          <mesh ref={mouth} position={[0, -0.1, 0.4]} material={materials.mouth}>
            <sphereGeometry args={[0.1, 16, 12]} />
          </mesh>
        </group>

        <Hair spec={spec} materials={materials} groupRef={hairGroup} segments={segments} />

        <Accessory spec={spec} materials={materials} visorRef={visor} />

        {/* halo */}
        <mesh ref={halo} position={[0, 0.58, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.3, 0.012, 8, 64]} />
          <meshBasicMaterial color={palette.glow} transparent opacity={0.3} />
        </mesh>
      </group>

      {spec.gridFloor && <GridFloor color={spec.palette.accent} opacity={spec.glowIntensity * 0.5} />}
    </group>
  );
}

/** Locks the character's rendered geometry to that family's signature hair silhouette. */
function Hair({ spec, materials, groupRef, segments }: { spec: AvatarSpec; materials: Record<string, THREE.Material>; groupRef: React.RefObject<THREE.Group | null>; segments: number }) {
  const hairMat = materials.hair as THREE.MeshStandardMaterial;
  const accentMat = materials.hairAccent as THREE.MeshStandardMaterial;
  const v = spec.hair.volume;
  switch (spec.hair.style) {
    case 'slick':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.16, -0.02]} scale={[1.03, 0.9, 1.04]} material={hairMat}>
            <sphereGeometry args={[0.52, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          </mesh>
          <mesh position={[0, 0.3, 0.12]} rotation={[-0.5, 0, 0]} material={hairMat}>
            <coneGeometry args={[0.18 * v, 0.5, 3]} />
          </mesh>
        </group>
      );
    case 'short':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.14, -0.02]} scale={[1.06, 0.95, 1.06]} material={hairMat}>
            <sphereGeometry args={[0.53, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
          {Array.from({ length: HAIR_SEGMENTS }).map((_, i) => (
            <mesh key={i} position={[Math.sin((i / HAIR_SEGMENTS) * Math.PI) * 0.34 - 0.17, 0.28, -0.15 + (i % 2) * 0.02]} rotation={[0, 0, (i / HAIR_SEGMENTS - 0.5) * 0.9]} material={hairMat}>
              <coneGeometry args={[0.07 * v, 0.22, 6]} />
            </mesh>
          ))}
        </group>
      );
    case 'long-straight':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.14, -0.03]} scale={[1.05, 0.98, 1.07]} material={hairMat}>
            <sphereGeometry args={[0.54, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          </mesh>
          <mesh position={[0, -0.42, -0.22]} material={hairMat}>
            <capsuleGeometry args={[0.3 * v, 0.85, 8, 24]} />
          </mesh>
          <mesh position={[0.34, -0.28, 0.02]} rotation={[0.1, 0, -0.12]} material={hairMat}>
            <capsuleGeometry args={[0.075 * v, 0.9, 6, 14]} />
          </mesh>
          <mesh position={[-0.34, -0.28, 0.02]} rotation={[0.1, 0, 0.12]} material={hairMat}>
            <capsuleGeometry args={[0.075 * v, 0.9, 6, 14]} />
          </mesh>
          <mesh position={[0.2, 0.06, 0.4]} rotation={[0.2, 0, 0.3]} material={accentMat}>
            <capsuleGeometry args={[0.012, 0.3, 4, 8]} />
          </mesh>
        </group>
      );
    case 'twin-tail':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.14, -0.02]} scale={[1.04, 0.92, 1.05]} material={hairMat}>
            <sphereGeometry args={[0.53, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          </mesh>
          <mesh position={[0.36, 0.18, -0.06]} rotation={[0, 0, -0.5]} material={accentMat}>
            <torusGeometry args={[0.05, 0.016, 8, 16]} />
          </mesh>
          <mesh position={[-0.36, 0.18, -0.06]} rotation={[0, 0, 0.5]} material={accentMat}>
            <torusGeometry args={[0.05, 0.016, 8, 16]} />
          </mesh>
          <mesh position={[0.44, -0.1, -0.12]} rotation={[0, 0, -0.35]} material={hairMat}>
            <capsuleGeometry args={[0.1 * v, 0.7, 6, 16]} />
          </mesh>
          <mesh position={[-0.44, -0.1, -0.12]} rotation={[0, 0, 0.35]} material={hairMat}>
            <capsuleGeometry args={[0.1 * v, 0.7, 6, 16]} />
          </mesh>
        </group>
      );
    case 'bob-curly':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.12, -0.02]} scale={[1.08, 0.95, 1.08]} material={hairMat}>
            <sphereGeometry args={[0.56, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          </mesh>
          {Array.from({ length: 9 }).map((_, i) => {
            const angle = (i / 9) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(angle) * 0.4 * v, -0.1 + Math.sin(angle * 2) * 0.05, Math.sin(angle) * 0.38 * v]} material={hairMat}>
                <sphereGeometry args={[0.11 * v, 12, 10]} />
              </mesh>
            );
          })}
        </group>
      );
    case 'spiky':
      return (
        <group ref={groupRef}>
          <mesh position={[0, 0.14, -0.02]} scale={[1.04, 0.9, 1.05]} material={hairMat}>
            <sphereGeometry args={[0.52, segments, segments, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
          {Array.from({ length: 10 }).map((_, i) => {
            const angle = (i / 10) * Math.PI * 2;
            return (
              <mesh
                key={i}
                position={[Math.cos(angle) * 0.3 * v, 0.34 + (i % 3) * 0.06, Math.sin(angle) * 0.3 * v]}
                rotation={[Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5]}
                material={hairMat}
              >
                <coneGeometry args={[0.09 * v, 0.28 + (i % 3) * 0.05, 5]} />
              </mesh>
            );
          })}
        </group>
      );
    default:
      return null;
  }
}

function Accessory({ spec, materials, visorRef }: { spec: AvatarSpec; materials: Record<string, THREE.Material>; visorRef: React.RefObject<THREE.Mesh | null> }) {
  const trim = materials.trim as THREE.MeshStandardMaterial;
  switch (spec.accessory) {
    case 'headset':
      return (
        <group>
          <mesh position={[0, 0.1, 0]} rotation={[0, 0, Math.PI / 2]} material={trim}>
            <torusGeometry args={[0.5, 0.014, 8, 40, Math.PI]} />
          </mesh>
          <mesh position={[0.28, 0.08, 0.28]} rotation={[0.3, 0, 0]} material={trim}>
            <capsuleGeometry args={[0.015, 0.22, 4, 8]} />
          </mesh>
          <mesh position={[0.42, 0.05, 0.05]} material={trim}>
            <sphereGeometry args={[0.045, 12, 12]} />
          </mesh>
        </group>
      );
    case 'visor':
      return (
        <mesh ref={visorRef} position={[0, 0.1, 0.3]} material={materials.iris}>
          <boxGeometry args={[0.5, 0.09, 0.16]} />
        </mesh>
      );
    case 'hairpin':
      return (
        <group position={[0.22, 0.3, 0.22]} rotation={[0, 0, -0.6]}>
          <mesh material={trim}>
            <torusGeometry args={[0.05, 0.012, 6, 16]} />
          </mesh>
          <mesh position={[0.02, -0.04, 0]} material={trim}>
            <sphereGeometry args={[0.02, 8, 8]} />
          </mesh>
        </group>
      );
    case 'earpiece':
      return (
        <group>
          <mesh position={[0.44, 0.02, 0.04]} material={trim}>
            <sphereGeometry args={[0.035, 12, 12]} />
          </mesh>
          <mesh position={[0.4, -0.16, 0.1]} rotation={[0.3, 0, 0.2]} material={trim}>
            <capsuleGeometry args={[0.008, 0.24, 4, 6]} />
          </mesh>
        </group>
      );
    case 'glasses':
      return (
        <group>
          <mesh position={[0.2, 0.1, 0.38]} material={materials.glassDark}>
            <boxGeometry args={[0.2, 0.12, 0.02]} />
          </mesh>
          <mesh position={[-0.2, 0.1, 0.38]} material={materials.glassDark}>
            <boxGeometry args={[0.2, 0.12, 0.02]} />
          </mesh>
          <mesh position={[0, 0.11, 0.39]} material={trim}>
            <boxGeometry args={[0.18, 0.01, 0.01]} />
          </mesh>
        </group>
      );
    case 'antenna':
      return (
        <group position={[0.18, 0.4, 0]}>
          <mesh material={trim}>
            <capsuleGeometry args={[0.008, 0.3, 4, 6]} />
          </mesh>
          <mesh position={[0, 0.18, 0]} material={materials.iris}>
            <sphereGeometry args={[0.03, 10, 10]} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

function GridFloor({ color, opacity }: { color: string; opacity: number }) {
  const grid = React.useMemo(() => {
    const g = new THREE.GridHelper(4, 16, new THREE.Color(color), new THREE.Color(color));
    const mat = g.material as THREE.Material | THREE.Material[];
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      m.transparent = true;
      m.opacity = Math.max(0.05, Math.min(0.6, opacity));
    }
    return g;
  }, [color, opacity]);
  React.useEffect(() => {
    return () => {
      grid.geometry.dispose();
      const mat = grid.material as THREE.Material | THREE.Material[];
      (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose());
    };
  }, [grid]);
  return <primitive object={grid} position={[0, 0.02, 0]} />;
}

/** Exposed for tests: verifies the pose→rig mapping is deterministic. */
export function mouthFromVisemes(aa: number, teeth: number): { openness: number; teeth: number } {
  const shape = VISEME_SHAPES.AA;
  return { openness: lerp(0, shape.aa, aa), teeth: teeth };
}
