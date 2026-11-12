"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont } from "./scene-kit";

/**
 * About hero: the clinic as one connected model. A floating miniature clinic — front
 * desk, doctor's room, billing and the owner's office — on one glass floor, every area
 * wired to the FlexicaAI core at its centre. It assembles itself, then data pulses run
 * between the rooms and the core: one source of truth instead of registers and memory.
 */

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

type Zone = { key: string; title: string; sub: string; x: number; z: number; delay: number };
const ZONES: Zone[] = [
  { key: "desk", title: "Front desk", sub: "Bookings & arrivals", x: -1.75, z: 1.05, delay: 0.15 },
  { key: "doctor", title: "Doctor", sub: "Records & notes", x: -1.75, z: -1.05, delay: 0.35 },
  { key: "billing", title: "Billing", sub: "Invoices & payments", x: 1.75, z: 1.05, delay: 0.55 },
  { key: "owner", title: "Owner", sub: "Sales & P&L", x: 1.75, z: -1.05, delay: 0.75 },
];

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, siteFont());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function labelTex(title: string, sub: string) {
  return canvasTex(560, 170, (g, font) => {
    g.fillStyle = "rgba(9,36,74,0.9)";
    g.beginPath();
    g.roundRect(4, 4, 552, 162, 34);
    g.fill();
    g.strokeStyle = "rgba(95,224,228,0.55)";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = COLORS.tealGlow;
    g.beginPath();
    g.arc(52, 64, 11, 0, Math.PI * 2);
    g.fill();
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `700 46px ${font}`;
    g.fillText(title, 80, 66);
    g.fillStyle = "#94a3b8";
    g.font = `500 34px ${font}`;
    g.fillText(sub, 40, 124);
  });
}

function screenTex(kind: "list" | "chart" | "note" | "bill") {
  return canvasTex(256, 160, (g) => {
    g.fillStyle = "#0b2f5c";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = COLORS.tealGlow;
    if (kind === "chart") {
      [50, 70, 62, 88, 104, 128].forEach((h, i) => {
        g.globalAlpha = i === 5 ? 1 : 0.6;
        g.fillRect(24 + i * 36, 140 - h, 24, h);
      });
    } else {
      for (let i = 0; i < 5; i++) {
        g.globalAlpha = i === 0 ? 1 : 0.5;
        g.fillRect(22, 22 + i * 26, kind === "note" ? 200 - (i % 2) * 60 : 140, 12);
        if (kind !== "note") g.fillRect(190, 22 + i * 26, 44, 12);
      }
    }
  });
}

type Piece = { obj: THREE.Object3D; base: THREE.Vector3; delay: number };
type Api = { update: (t: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const pieces: Piece[] = [];
  const add = (parent: THREE.Object3D, obj: THREE.Object3D, delay: number) => {
    parent.add(obj);
    pieces.push({ obj, base: obj.position.clone(), delay });
    return obj;
  };

  const model = new THREE.Group();
  model.rotation.set(0.62, -0.62, 0);
  root.add(model);

  // Materials
  const furn = new THREE.MeshPhysicalMaterial({ color: "#e8f0f8", roughness: 0.45, clearcoat: 0.6 });
  const furnDark = new THREE.MeshPhysicalMaterial({ color: "#16457c", roughness: 0.4, clearcoat: 0.6 });
  const tealMat = new THREE.MeshPhysicalMaterial({ color: COLORS.teal, emissive: COLORS.teal, emissiveIntensity: 0.25, roughness: 0.35, clearcoat: 0.8 });
  const wallMat = new THREE.MeshPhysicalMaterial({ color: "#7fd8e6", transparent: true, opacity: 0.16, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.7 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, r = 0.03) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) - 0.001), mat);

  // Floor
  const floor = box(6.2, 0.16, 4.5, new THREE.MeshPhysicalMaterial({ color: "#0d3466", roughness: 0.3, metalness: 0.2, clearcoat: 1 }), 0.08);
  floor.position.y = -0.08;
  add(model, floor, 0);
  const floorEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6.2, 0.16, 4.5)), edgeMat);
  floor.add(floorEdge);
  const grid = new THREE.GridHelper(6, 24, COLORS.teal, "#1c4f86");
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.25;
  grid.position.y = 0.005;
  grid.scale.z = 4.3 / 6;
  floor.add(grid);

  // Glass partitions between the four rooms.
  const wallX = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 0.7), wallMat);
  wallX.position.set(0, 0.35, 0);
  const wallZ = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.7), wallMat);
  wallZ.rotation.y = Math.PI / 2;
  wallZ.position.set(0, 0.35, 0);
  for (const w of [wallX, wallZ]) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(w.geometry), edgeMat);
    w.add(e);
    add(model, w, 0.1);
  }

  // ── Rooms
  const screens: THREE.Texture[] = [];
  const monitor = (kind: "list" | "chart" | "note" | "bill") => {
    const g = new THREE.Group();
    const t = screenTex(kind);
    screens.push(t);
    const frame = box(0.5, 0.34, 0.04, furnDark, 0.02);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    scr.position.z = 0.022;
    const stand = box(0.06, 0.16, 0.06, furnDark, 0.02);
    stand.position.y = -0.24;
    g.add(frame, scr, stand);
    return g;
  };

  ZONES.forEach((z) => {
    const g = new THREE.Group();
    g.position.set(z.x, 0, z.z);
    model.add(g);
    const d = z.delay;
    if (z.key === "desk") {
      const counter = box(1.3, 0.42, 0.36, furn);
      counter.position.set(0.2, 0.21, -0.35);
      add(g, counter, d);
      const top = box(1.36, 0.05, 0.42, tealMat, 0.02);
      top.position.set(0.2, 0.44, -0.35);
      add(g, top, d + 0.05);
      const m = monitor("list");
      m.position.set(0.2, 0.72, -0.4);
      add(g, m, d + 0.1);
      for (let i = 0; i < 3; i++) {
        const chair = new THREE.Group();
        const seat = box(0.32, 0.08, 0.32, furnDark);
        seat.position.y = 0.22;
        const back = box(0.32, 0.34, 0.06, furnDark);
        back.position.set(0, 0.4, 0.14);
        const leg = box(0.26, 0.2, 0.26, furn);
        leg.position.y = 0.1;
        chair.add(leg, seat, back);
        chair.position.set(-0.55 + i * 0.45, 0, 0.55);
        add(g, chair, d + 0.12 + i * 0.04);
      }
    } else if (z.key === "doctor") {
      const bed = box(1.0, 0.4, 0.46, furn);
      bed.position.set(-0.45, 0.2, 0.1);
      add(g, bed, d);
      const pad = box(0.96, 0.08, 0.44, tealMat);
      pad.position.set(-0.45, 0.44, 0.1);
      add(g, pad, d + 0.05);
      const pillow = box(0.22, 0.08, 0.36, furn);
      pillow.position.set(-0.85, 0.52, 0.1);
      add(g, pillow, d + 0.08);
      const desk = box(0.8, 0.4, 0.4, furnDark);
      desk.position.set(0.6, 0.2, -0.35);
      add(g, desk, d + 0.08);
      const m = monitor("note");
      m.position.set(0.6, 0.66, -0.4);
      add(g, m, d + 0.12);
    } else if (z.key === "billing") {
      const counter = box(1.1, 0.46, 0.4, furn);
      counter.position.set(-0.2, 0.23, -0.3);
      add(g, counter, d);
      const m = monitor("bill");
      m.position.set(-0.4, 0.74, -0.35);
      add(g, m, d + 0.06);
      const printer = box(0.24, 0.12, 0.2, furnDark);
      printer.position.set(0.15, 0.52, -0.3);
      add(g, printer, d + 0.1);
      for (let i = 0; i < 3; i++) {
        const shelf = box(0.9, 0.05, 0.3, furnDark, 0.015);
        shelf.position.set(0.25, 0.25 + i * 0.32, 0.65);
        add(g, shelf, d + 0.12 + i * 0.04);
        for (let k = 0; k < 4; k++) {
          const item = box(0.12, 0.18, 0.12, k % 2 ? tealMat : furn, 0.02);
          item.position.set(-0.05 + k * 0.2, 0.37 + i * 0.32, 0.65);
          add(g, item, d + 0.16 + i * 0.04);
        }
      }
    } else {
      const desk = box(1.1, 0.4, 0.5, furnDark);
      desk.position.set(0, 0.2, -0.3);
      add(g, desk, d);
      const m = monitor("chart");
      m.scale.setScalar(1.3);
      m.position.set(0, 0.76, -0.38);
      add(g, m, d + 0.06);
      const chair = box(0.36, 0.5, 0.36, tealMat);
      chair.position.set(0, 0.25, 0.25);
      add(g, chair, d + 0.1);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.18, 16), furn);
      pot.position.set(-0.8, 0.09, 0.6);
      add(g, pot, d + 0.12);
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshStandardMaterial({ color: "#22c55e", roughness: 0.8, flatShading: true }));
      plant.position.set(-0.8, 0.34, 0.6);
      add(g, plant, d + 0.14);
    }
  });

  // ── The core: a glowing pillar with the mark floating above it.
  const core = new THREE.Group();
  model.add(core);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 6), tealMat);
  pillar.position.y = 0.25;
  add(core, pillar, 0.9);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 12, 72), new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  add(core, ring, 0.95);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  coreGlow.scale.set(2.2, 2.2, 1);
  coreGlow.position.y = 1.0;
  core.add(coreGlow);
  const markMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mark = new THREE.Sprite(markMat);
  mark.scale.set(0.8, 0.8, 1);
  mark.position.y = 1.0;
  core.add(mark);
  loadLogoMark((t) => {
    markMat.map = t;
    markMat.needsUpdate = true;
  });

  // ── Light paths from each room to the core, with pulses both ways.
  const paths = ZONES.map((z, i) => {
    const from = new THREE.Vector3(z.x * 0.55, 0.03, z.z * 0.55);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(z.x, 0.03, z.z * 0.4),
      from,
      new THREE.Vector3(z.x * 0.2, 0.03, z.z * 0.15),
      new THREE.Vector3(0, 0.03, 0),
    ]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, 0.02, 6, false),
      new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false }),
    );
    model.add(tube);
    const pulses = [0, 1].map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      s.scale.set(0.3, 0.3, 1);
      model.add(s);
      return s;
    });
    // Floating label above the room.
    const lt = labelTex(z.title, z.sub);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    label.scale.set(1.3, (1.3 * 170) / 560, 1);
    label.position.set(z.x, 1.5, z.z);
    model.add(label);
    return { curve, tube, pulses, label, i };
  });

  const tmp = new THREE.Vector3();

  return {
    update(t, px, py) {
      // Assemble: each piece drops in and settles.
      for (const p of pieces) {
        const k = ease((t - 0.2 - p.delay * 1.6) / 0.7);
        p.obj.position.copy(p.base);
        p.obj.position.y += (1 - k) * 2.2;
        p.obj.scale.setScalar(Math.max(0.001, k));
      }
      const live = ease((t - 2.4) / 0.8);
      markMat.opacity = live;
      (coreGlow.material as THREE.SpriteMaterial).opacity = live * (0.55 + 0.2 * Math.sin(t * 2.5));
      mark.position.y = 1.0 + Math.sin(t * 1.4) * 0.06;
      ring.scale.setScalar(1 + 0.08 * Math.sin(t * 2));

      for (const path of paths) {
        (path.tube.material as THREE.MeshBasicMaterial).opacity = 0.55 * live;
        path.pulses.forEach((s, k) => {
          // One pulse runs into the core, the other back out to the room.
          const u = (t * 0.35 + path.i * 0.25 + k * 0.5) % 1;
          path.curve.getPointAt(k === 0 ? u : 1 - u, tmp);
          s.position.copy(tmp);
          s.position.y += 0.04;
          (s.material as THREE.SpriteMaterial).opacity = live * Math.sin(u * Math.PI);
        });
        const lk = ease((t - 2.6 - path.i * 0.15) / 0.5);
        (path.label.material as THREE.SpriteMaterial).opacity = lk;
        path.label.position.y = 1.45 + Math.sin(t * 1.2 + path.i) * 0.05;
      }

      // Slow turn and pointer parallax.
      model.rotation.y = lerp(model.rotation.y, -0.62 + Math.sin(t * 0.18) * 0.18 + px * 0.25, 0.04);
      model.rotation.x = lerp(model.rotation.x, 0.62 - py * 0.08, 0.04);
      model.position.y = Math.sin(t * 0.7) * 0.05 - 0.1;
    },
    dispose() {
      disposeDeep(root);
      glow.dispose();
      screens.forEach((s) => s.dispose());
    },
  };
}

function Scene({ onReady }: { onReady: () => void }) {
  const holder = useRef<THREE.Group>(null);
  const api = useRef<Api | null>(null);
  const start = useRef<number | null>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    const built = build(root);
    api.current = built;
    requestAnimationFrame(() => readyRef.current());
    return () => {
      api.current = null;
      built.dispose();
      root.clear();
    };
  }, []);
  useFrame(({ clock, pointer }) => {
    if (start.current === null) start.current = clock.elapsedTime;
    api.current?.update(clock.elapsedTime - start.current, pointer.x, pointer.y);
  });
  return <group ref={holder} />;
}

export default function AboutHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.5, 2])}
      camera={{ position: [0, 0.6, 11.2], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#e0f7ff", "#06203f", 1.3]} />
      <directionalLight position={[4, 8, 6]} intensity={1.8} />
      <pointLight position={[0, 1.5, 0]} intensity={6} distance={6} color={COLORS.tealGlow} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
