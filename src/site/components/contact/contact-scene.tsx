"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark } from "../pages3d/scene-kit";

import type { Channel, ChannelBus } from "./channel-bus";
import { HANDSET_PATH, WHATSAPP_GREEN } from "./whatsapp-icon";

/**
 * The contact hero's live scene: the FlexicaAI core, and the three ways to reach the
 * team orbiting it — chat, email, phone. Messages travel from each channel into the
 * core; the channel whose card is hovered grows, brightens and sends faster.
 */

type Icon = Channel;

function iconTexture(kind: Icon) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#ffffff";
  g.fillStyle = "#ffffff";
  g.lineWidth = 14;
  g.lineJoin = "round";
  g.lineCap = "round";
  if (kind === "whatsapp") {
    // WhatsApp-style mark: round bubble with a tail, handset inside.
    g.save();
    g.scale(8, 8);
    g.lineWidth = 2.4;
    g.stroke(new Path2D("M16 3.5c-6.9 0-12.5 5.5-12.5 12.3 0 2.3.6 4.4 1.8 6.3L3.5 28.5l6.6-1.7c1.8 1 3.8 1.5 5.9 1.5 6.9 0 12.5-5.5 12.5-12.3S22.9 3.5 16 3.5z"));
    g.translate(9.3, 9.2);
    g.scale(0.56, 0.56);
    g.fill(new Path2D(HANDSET_PATH));
    g.restore();
  } else if (kind === "email") {
    g.beginPath();
    g.roundRect(44, 70, 168, 120, 18);
    g.stroke();
    g.beginPath();
    g.moveTo(52, 80);
    g.lineTo(128, 138);
    g.lineTo(204, 80);
    g.stroke();
  } else {
    // A phone handset, drawn as a smartphone with a call wave.
    g.beginPath();
    g.roundRect(84, 40, 88, 176, 22);
    g.stroke();
    g.beginPath();
    g.moveTo(114, 64);
    g.lineTo(142, 64);
    g.stroke();
    g.beginPath();
    g.arc(128, 188, 8, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    [26, 46].forEach((r) => {
      g.beginPath();
      g.arc(172, 90, r, -Math.PI / 3, Math.PI / 3);
      g.stroke();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Each channel circles the core on its own inclined orbit, like an atom: `angle` is the
// orbit's direction on screen (degrees), `incline` how open the ellipse looks.
const CHANNELS: { id: Channel; radius: number; angle: number; incline: number; speed: number; phase: number; color: string }[] = [
  { id: "whatsapp", radius: 2.1, angle: 45, incline: 1.18, speed: 0.24, phase: 0.2, color: WHATSAPP_GREEN },
  { id: "email", radius: 2.45, angle: 130, incline: 1.22, speed: 0.18, phase: 2.3, color: "#ef5350" },
  { id: "phone", radius: 2.8, angle: 80, incline: 1.28, speed: 0.14, phase: 4.2, color: "#7cc7ff" },
];
const PULSES = 5;
const STARS = 700;

type Api = { update: (t: number, focus: Channel | null, px: number, py: number, camera: THREE.Camera) => void; dispose: () => void };

function build(root: THREE.Group, invalidate: () => void): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const world = new THREE.Group();
  root.add(world);

  // ── Core: a hex prism with a teal edge and the logo mark.
  const core = new THREE.Group();
  const prismMat = new THREE.MeshPhysicalMaterial({ color: "#0b2c55", metalness: 0.5, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.2 });
  const prism = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.5, 6, 1), prismMat);
  prism.rotation.x = Math.PI / 2;
  prism.rotation.y = Math.PI / 6;
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.9, toneMapped: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(prism.geometry), edgeMat);
  edges.rotation.copy(prism.rotation);
  core.add(prism, edges);
  const markMat = new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, opacity: 0 });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.45), markMat);
  mark.position.z = 0.26;
  core.add(mark);
  loadLogoMark((tex) => {
    markMat.map = tex;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
    invalidate();
  });
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  coreGlow.scale.set(5, 5, 1);
  coreGlow.position.z = -0.4;
  core.add(coreGlow);
  world.add(core);

  // ── Channels on tilted orbits, stretched sideways into wide ellipses. Only the
  // orbits are stretched; the tiles ride them at their true shape.
  const stretch = new THREE.Group();
  stretch.scale.set(1.95, 1, 1);
  world.add(stretch);
  const ringGeo = new THREE.TorusGeometry(1, 0.006, 6, 160);
  const tileGeo = new RoundedBoxGeometry(0.92, 0.92, 0.16, 4, 0.18);
  const iconGeo = new THREE.PlaneGeometry(0.62, 0.62);
  const pulseGeo = new THREE.SphereGeometry(0.05, 12, 12);
  const nodes = CHANNELS.map((ch) => {
    const orbit = new THREE.Group();
    // Incline the ring first, then turn it to its direction on screen.
    orbit.rotation.order = "ZXY";
    orbit.rotation.set(ch.incline, 0, THREE.MathUtils.degToRad(ch.angle));
    const ringMat = new THREE.MeshBasicMaterial({ color: ch.color, transparent: true, opacity: 0.2, toneMapped: false, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.scale.setScalar(ch.radius);
    orbit.add(ring);
    stretch.add(orbit);

    const node = new THREE.Group();
    const tileMat = new THREE.MeshPhysicalMaterial({ color: ch.color, emissive: ch.color, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.1, clearcoat: 1, transmission: 0, transparent: true });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    const icon = new THREE.Mesh(iconGeo, new THREE.MeshBasicMaterial({ map: iconTexture(ch.id), transparent: true, toneMapped: false }));
    icon.position.z = 0.085;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(ch.color), transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(2.2, 2.2, 1);
    halo.position.z = -0.2;
    node.add(halo, tile, icon);
    world.add(node);

    const pulseMat = new THREE.MeshBasicMaterial({ color: ch.color, transparent: true, toneMapped: false });
    const pulses = Array.from({ length: PULSES }, () => {
      const m = new THREE.Mesh(pulseGeo, pulseMat);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: ch.color, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      s.scale.set(0.45, 0.45, 1);
      m.add(s);
      world.add(m);
      return m;
    });
    return { ch, orbit, ring, ringMat, node, tile, tileMat, halo, pulses, pulseMat, weight: 0, angle: ch.phase };
  });

  // ── Star field.
  const starPos = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const b = Math.sin(i * 78.233) * 12543.123;
    const c = Math.sin(i * 39.425) * 24634.634;
    starPos[i * 3] = ((a - Math.floor(a)) - 0.5) * 30;
    starPos[i * 3 + 1] = ((b - Math.floor(b)) - 0.5) * 18;
    starPos[i * 3 + 2] = -4 - (c - Math.floor(c)) * 12;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.06, map: glow, color: "#9fe9ee", transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  root.add(stars);

  const tmp = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let last = 0;

  return {
    update(t, focus, px, py, camera) {
      const dt = Math.min(0.05, t - last);
      last = t;
      // Gentle parallax toward the pointer.
      world.rotation.y = lerp(world.rotation.y, px * 0.28, 0.05);
      world.rotation.x = lerp(world.rotation.x, -py * 0.16, 0.05);
      stars.rotation.y = t * 0.01;

      core.rotation.z = Math.sin(t * 0.4) * 0.08;
      core.position.y = Math.sin(t * 0.8) * 0.06;
      edgeMat.opacity = 0.7 + 0.3 * Math.sin(t * 2);
      (coreGlow.material as THREE.SpriteMaterial).opacity = 0.45 + 0.15 * Math.sin(t * 1.3) + (focus ? 0.15 : 0);

      for (const n of nodes) {
        const on = focus === n.ch.id;
        const dim = focus !== null && !on;
        n.weight = lerp(n.weight, on ? 1 : dim ? -1 : 0, 0.08);
        const w = n.weight;
        // A focused channel slows to face you; the others keep circling.
        n.angle += dt * n.ch.speed * (on ? 0.25 : 1);
        tmp.set(Math.cos(n.angle) * n.ch.radius, Math.sin(n.angle) * n.ch.radius, 0);
        n.orbit.localToWorld(tmp);
        world.worldToLocal(tmp);
        n.node.position.copy(tmp);
        n.node.quaternion.copy(world.quaternion).invert();
        n.node.scale.setScalar(1 + 0.35 * Math.max(0, w) - 0.15 * Math.max(0, -w));
        n.tileMat.opacity = 1 - 0.45 * Math.max(0, -w);
        n.tileMat.emissiveIntensity = 0.35 + 0.6 * Math.max(0, w) + 0.1 * Math.sin(t * 3 + n.ch.phase);
        n.ringMat.opacity = 0.18 + 0.45 * Math.max(0, w) - 0.1 * Math.max(0, -w);
        (n.halo.material as THREE.SpriteMaterial).opacity = 0.35 + 0.5 * Math.max(0, w) - 0.25 * Math.max(0, -w);

        // Messages: node → core along a gentle arc.
        const rate = on ? 1.1 : dim ? 0.25 : 0.45;
        mid.copy(n.node.position).multiplyScalar(0.5);
        mid.z += 1.0;
        n.pulseMat.opacity = dim ? 0.3 : 1;
        n.pulses.forEach((m, i) => {
          const k = (t * rate + i / PULSES + n.ch.phase) % 1;
          const a = 1 - k;
          // Quadratic Bézier: node → mid → core.
          m.position
            .copy(n.node.position)
            .multiplyScalar(a * a)
            .addScaledVector(mid, 2 * a * k)
            .addScaledVector(origin, k * k);
          m.scale.setScalar(Math.sin(k * Math.PI) * (on ? 1.4 : 1));
        });
      }
      camera.lookAt(0, 0, 0);
    },
    dispose() {
      disposeDeep(root);
      glow.dispose();
    },
  };
}

function Scene({ bus }: { bus: ChannelBus }) {
  const holder = useRef<THREE.Group>(null);
  const api = useRef<Api | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    const built = build(root, invalidate);
    api.current = built;
    return () => {
      api.current = null;
      built.dispose();
      root.clear();
    };
  }, [invalidate]);
  useFrame(({ clock, pointer, camera }) => {
    api.current?.update(clock.elapsedTime, bus.focus, pointer.x, pointer.y, camera);
  });
  return <group ref={holder} />;
}

export default function ContactScene({ bus, active, onReady }: { bus: ChannelBus; active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1, 1.75])}
      camera={{ position: [0, 0, 7.3], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        requestAnimationFrame(() => onReady());
      }}
    >
      <hemisphereLight args={["#bdefff", "#061d3d", 0.9]} />
      <directionalLight position={[4, 6, 8]} intensity={1.6} />
      <pointLight position={[0, 0, 3]} intensity={6} distance={10} color={COLORS.tealGlow} />
      <Scene bus={bus} />
    </Canvas>
  );
}
