"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { loadLogoMark } from "../pages3d/scene-kit";
import { makePanelTexture, PANEL_ASPECT, type PanelKind } from "./panel-textures";

/**
 * The hero: FlexicaAI as the core that connects the clinic.
 *
 * A glass hexagon (the logo's shape) stands on a polar "floor"; five screens of the
 * product float around it — patient, appointment, AI note, WhatsApp, analytics — and
 * data pulses run between each screen and the core. Pointer movement leans the whole
 * scene; hovering a screen lifts it and brightens its connection.
 *
 * Cost control: one canvas, ~40 draw calls, five 768×480 canvas textures, shared
 * materials, everything disposed on unmount, and the loop stops when off screen.
 */

type PanelDef = { kind: PanelKind; pos: [number, number, number]; size: number; phase: number };

const PANELS: PanelDef[] = [
  { kind: "patient", pos: [-2.55, 1.45, 0.2], size: 1.9, phase: 0 },
  { kind: "appointment", pos: [2.2, 1.7, -0.6], size: 1.75, phase: 1.3 },
  { kind: "note", pos: [1.9, -0.6, 0.5], size: 1.85, phase: 2.1 },
  { kind: "whatsapp", pos: [-2.75, -0.55, 0.9], size: 1.8, phase: 3.4 },
  { kind: "analytics", pos: [0.15, 2.85, -1.4], size: 1.7, phase: 4.2 },
];

const pointer = { x: 0, y: 0 };

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function useFontFamily() {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const css = getComputedStyle(document.documentElement).getPropertyValue("--font-geist").trim();
    const fam = css || "system-ui, sans-serif";
    document.fonts.ready.then(() => alive && setFamily(fam));
    return () => {
      alive = false;
    };
  }, []);
  return family;
}

function Core() {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Mesh>(null);
  const rings = useRef<THREE.Group>(null);
  const logo = useRef<THREE.Sprite>(null);
  const [logoTex, setLogoTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let tex: THREE.Texture | null = null;
    loadLogoMark((t) => {
      tex = t;
      if (alive) setLogoTex(t);
      else t.dispose();
    });
    return () => {
      alive = false;
      tex?.dispose();
    };
  }, []);

  const { prism, edges, innerGeo, ring1, ring2 } = useMemo(() => {
    const prism = new THREE.CylinderGeometry(1.05, 1.05, 0.5, 6, 1);
    return {
      prism,
      edges: new THREE.EdgesGeometry(prism),
      innerGeo: new THREE.CylinderGeometry(0.55, 0.55, 0.52, 6, 1),
      ring1: new THREE.TorusGeometry(1.55, 0.008, 6, 128),
      ring2: new THREE.TorusGeometry(1.95, 0.006, 6, 128),
    };
  }, []);
  const mats = useMemo(
    () => ({
      glass: new THREE.MeshPhysicalMaterial({
        color: "#0b3d6b",
        roughness: 0.12,
        metalness: 0.1,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transparent: true,
        opacity: 0.72,
        emissive: "#082957",
        emissiveIntensity: 0.4,
      }),
      edge: new THREE.LineBasicMaterial({ color: "#5fe0e4", transparent: true, opacity: 0.9 }),
      inner: new THREE.MeshBasicMaterial({ color: "#0fb4bb", toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({ color: "#5fe0e4", transparent: true, opacity: 0.45, toneMapped: false }),
    }),
    [],
  );
  useEffect(
    () => () => {
      [prism, edges, innerGeo, ring1, ring2].forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [prism, edges, innerGeo, ring1, ring2, mats],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (group.current) {
      group.current.rotation.y = t * 0.18;
      group.current.position.y = Math.sin(t * 0.8) * 0.06;
    }
    if (inner.current) (inner.current.material as THREE.MeshBasicMaterial).color.setHSL(0.505, 0.85, 0.42 + Math.sin(t * 2) * 0.05);
    if (rings.current) {
      rings.current.children[0].rotation.z = t * 0.25;
      rings.current.children[1].rotation.z = -t * 0.15;
    }
    if (logo.current) logo.current.position.y = 0.95 + Math.sin(t * 1.2) * 0.07;
  });

  return (
    <group>
      <group ref={group} rotation={[0.18, 0, 0]}>
        <mesh geometry={prism} material={mats.glass} />
        <lineSegments geometry={edges} material={mats.edge} />
        <mesh ref={inner} geometry={innerGeo} material={mats.inner} />
      </group>
      {/* The FlexicaAI mark floats over the centre of the hexagon, always facing the viewer. */}
      {logoTex && (
        <sprite ref={logo} position={[0, 0.95, 0]} scale={[1.15, 1.15, 1]}>
          <spriteMaterial map={logoTex} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      )}
      <group ref={rings} rotation={[Math.PI / 2 - 0.25, 0, 0]} position={[0, -0.05, 0]}>
        <mesh geometry={ring1} material={mats.ring} />
        <mesh geometry={ring2} material={mats.ring} />
      </group>
      <pointLight color="#0fb4bb" intensity={6} distance={7} decay={1.6} />
    </group>
  );
}

function Floor() {
  const grid = useMemo(() => {
    const g = new THREE.PolarGridHelper(7, 12, 7, 96, "#1d5a86", "#123f66");
    const mats = Array.isArray(g.material) ? g.material : [g.material];
    mats.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.42;
    });
    return g;
  }, []);
  useEffect(
    () => () => {
      grid.geometry.dispose();
      (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((m) => m.dispose());
    },
    [grid],
  );
  return <primitive object={grid} position={[0, -1.9, 0]} />;
}

function Dust({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    // Seeded so it is the same every visit (and no Math.random during render).
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const r = 1.5 + rnd() * 6;
      const a = rnd() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -1.8 + rnd() * 5.5;
      pos[i * 3 + 2] = Math.sin(a) * r - 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#5fe0e4", size: 0.035, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false });
    return { geo, mat };
  }, [count]);
  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.02;
  });
  return <points ref={ref} geometry={geo} material={mat} />;
}

const SEGMENTS = 40;

function Panels({ font, introRef }: { font: string; introRef: React.RefObject<number> }) {
  const { gl } = useThree();
  const [hovered, setHovered] = useState(-1);
  const panelRefs = useRef<(THREE.Group | null)[]>([]);
  const pulseRefs = useRef<(THREE.Mesh | null)[]>([]);
  const hoverAmt = useRef(PANELS.map(() => 0));

  const textures = useMemo(
    () => PANELS.map((p) => makePanelTexture(p.kind, font, gl.capabilities.getMaxAnisotropy())),
    [font, gl],
  );
  const { plane, panelMats, lineMats, lineGeos, pulseGeo, pulseMat } = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1 / PANEL_ASPECT);
    return {
      plane,
      panelMats: textures.map((map) => new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, side: THREE.DoubleSide, opacity: 0 })),
      lineMats: PANELS.map(() => new THREE.LineBasicMaterial({ color: "#0fb4bb", transparent: true, opacity: 0.35, toneMapped: false })),
      lineGeos: PANELS.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
        return g;
      }),
      pulseGeo: new THREE.SphereGeometry(0.045, 12, 8),
      pulseMat: new THREE.MeshBasicMaterial({ color: "#9ff4f6", toneMapped: false }),
    };
  }, [textures]);
  useEffect(
    () => () => {
      textures.forEach((t) => t.dispose());
      plane.dispose();
      panelMats.forEach((m) => m.dispose());
      lineMats.forEach((m) => m.dispose());
      lineGeos.forEach((g) => g.dispose());
      pulseGeo.dispose();
      pulseMat.dispose();
    },
    [textures, plane, panelMats, lineMats, lineGeos, pulseGeo, pulseMat],
  );

  const lines = useMemo(() => lineGeos.map((g, i) => new THREE.Line(g, lineMats[i])), [lineGeos, lineMats]);
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const start = useMemo(() => new THREE.Vector3(0, 0.1, 0), []);

  useFrame(({ clock, camera }, delta) => {
    const t = clock.elapsedTime;
    const k = introRef.current ?? 1;
    PANELS.forEach((p, i) => {
      const g = panelRefs.current[i];
      if (!g) return;
      const appear = ease((k - 0.25 - i * 0.1) / 0.5);
      hoverAmt.current[i] += ((hovered === i ? 1 : 0) - hoverAmt.current[i]) * Math.min(1, delta * 8);
      const h = hoverAmt.current[i];
      g.position.set(p.pos[0], p.pos[1] + Math.sin(t * 0.7 + p.phase) * 0.12 + h * 0.15, p.pos[2] + h * 0.35);
      const s = p.size * (0.86 + appear * 0.14) * (1 + h * 0.06);
      g.scale.setScalar(s);
      // Face the camera, softly.
      tmp.copy(camera.position);
      g.lookAt(tmp);
      g.rotation.z += Math.sin(t * 0.5 + p.phase) * 0.02;
      panelMats[i].opacity = appear;

      // Connection: core → panel, bowed upward.
      const end = g.position;
      curve.v0.copy(start);
      curve.v1.set((start.x + end.x) * 0.5, Math.max(start.y, end.y) + 0.9, (start.z + end.z) * 0.5);
      curve.v2.copy(end);
      const line = lines[i];
      {
        const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let j = 0; j <= SEGMENTS; j++) {
          curve.getPoint(j / SEGMENTS, tmp);
          attr.setXYZ(j, tmp.x, tmp.y, tmp.z);
        }
        attr.needsUpdate = true;
        line.geometry.computeBoundingSphere();
        lineMats[i].opacity = (0.22 + h * 0.5) * appear;
      }
      const pulse = pulseRefs.current[i];
      if (pulse) {
        // Alternate direction: data flowing in and out of the core.
        const u = (t * 0.32 + p.phase * 0.21) % 1;
        curve.getPoint(i % 2 ? u : 1 - u, tmp);
        pulse.position.copy(tmp);
        pulse.scale.setScalar(appear * (0.7 + h * 0.8));
      }
    });
  });

  const over = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(i);
  };

  return (
    <>
      {PANELS.map((p, i) => (
        <group key={p.kind}>
          <group
            ref={(el) => {
              panelRefs.current[i] = el;
            }}
            onPointerOver={over(i)}
            onPointerOut={() => setHovered((h) => (h === i ? -1 : h))}
          >
            <mesh geometry={plane} material={panelMats[i]} />
          </group>
          <primitive object={lines[i]} />
          <mesh
            ref={(el) => {
              pulseRefs.current[i] = el;
            }}
            geometry={pulseGeo}
            material={pulseMat}
          />
        </group>
      ))}
    </>
  );
}

function Rig({ introRef }: { introRef: React.RefObject<number> }) {
  const { camera } = useThree();

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    // Entrance: 0 → 1 over ~2.4s.
    introRef.current = Math.min(1, (introRef.current ?? 0) + delta / 2.4);
    const k = ease(introRef.current);
    // Camera: dolly in on arrival, then a slow breathing drift.
    camera.position.set(Math.sin(t * 0.12) * 0.35, 1.0 + Math.sin(t * 0.17) * 0.15, 16 - k * 2.6);
    camera.lookAt(0, 0.55, 0);
  });

  return null;
}

function Scene({ dust, onReady }: { dust: number; onReady: () => void }) {
  const font = useFontFamily();
  const introRef = useRef(0);
  const { size } = useThree();
  const wide = size.width >= 1024;

  useEffect(() => {
    if (font) onReady();
  }, [font, onReady]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 6, 5]} intensity={1.4} color="#cfefff" />
      <Rig introRef={introRef} />
      {/* On wide screens the scene sits to the right of the headline. */}
      <group position={[wide ? 3.9 : 0, wide ? 0 : -0.3, 0]}>
        <ParallaxGroup>
          <Floor />
          <Core />
          {font && <Panels font={font} introRef={introRef} />}
          <Dust count={dust} />
        </ParallaxGroup>
      </group>
    </>
  );
}

/** Leans everything inside it toward the pointer. */
function ParallaxGroup({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!g.current) return;
    const f = Math.min(1, delta * 2.5);
    g.current.rotation.y += (pointer.x * 0.22 - g.current.rotation.y) * f;
    g.current.rotation.x += (-pointer.y * 0.07 - g.current.rotation.x) * f;
  });
  return <group ref={g}>{children}</group>;
}

export default function HeroScene({
  tier,
  active,
  onReady,
}: {
  tier: "low" | "high";
  active: boolean;
  onReady: () => void;
}) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr(tier === "high" ? [1, 1.75] : [1, 1.25])}
      camera={{ fov: 34, near: 0.1, far: 60, position: [0, 1, 16] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      aria-hidden
    >
      <Scene dust={tier === "high" ? 420 : 180} onReady={onReady} />
    </Canvas>
  );
}
