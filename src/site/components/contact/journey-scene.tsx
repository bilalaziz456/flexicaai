"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont } from "../pages3d/scene-kit";

/**
 * Home "book a demo" scene: how a clinic gets started. Three floating hexagon
 * platforms — a conversation, your setup, your first day — joined by a path of light.
 * A pulse travels the path; each platform lights up as it arrives, and at the end the
 * FlexicaAI mark rises over the clinic that is now ready. Loops every LOOP seconds.
 */

const LOOP = 7.5;
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

type StepDef = { title: string; sub: string; icon: string[]; circles?: [number, number, number][]; pos: THREE.Vector3; at: number };

// Lucide icon paths (24-unit grid), drawn onto canvas.
const STEPS: StepDef[] = [
  {
    title: "A conversation",
    sub: "Book a demo or message us",
    icon: ["M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z", "M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"],
    pos: new THREE.Vector3(-2.5, -1.0, 0.5),
    at: 0.08,
  },
  {
    title: "Your setup",
    sub: "Doctors, hours, services, access",
    icon: ["M14 17H5", "M19 7h-9"],
    circles: [
      [17, 17, 3],
      [7, 7, 3],
    ],
    pos: new THREE.Vector3(0, -0.1, -0.5),
    at: 0.48,
  },
  {
    title: "Your first day",
    sub: "Your team logs in to your clinic",
    icon: [
      "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
      "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
      "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
      "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
    ],
    pos: new THREE.Vector3(2.35, 0.75, 0.4),
    at: 0.86,
  },
];

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, siteFont());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The icon tile's face: navy-to-teal gradient with a white line icon. */
function iconFace(s: StepDef) {
  return tex(256, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 256, 256);
    grd.addColorStop(0, "#0b3d6b");
    grd.addColorStop(0.55, "#082957");
    grd.addColorStop(1, "#0a6f86");
    g.fillStyle = grd;
    g.beginPath();
    g.roundRect(0, 0, 256, 256, 56);
    g.fill();
    const hl = g.createRadialGradient(80, 50, 0, 80, 50, 170);
    hl.addColorStop(0, "rgba(95,224,228,0.55)");
    hl.addColorStop(1, "rgba(95,224,228,0)");
    g.fillStyle = hl;
    g.fill();
    g.save();
    g.translate(56, 56);
    g.scale(6, 6);
    g.strokeStyle = "#ffffff";
    g.lineWidth = 1.8;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const d of s.icon) g.stroke(new Path2D(d));
    for (const [x, y, r] of s.circles ?? []) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  });
}

function labelTex(i: number, s: StepDef) {
  return tex(640, 190, (g, font) => {
    g.fillStyle = "rgba(6,28,59,0.88)";
    g.beginPath();
    g.roundRect(4, 4, 632, 182, 40);
    g.fill();
    g.strokeStyle = "rgba(95,224,228,0.45)";
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = COLORS.teal;
    g.beginPath();
    g.arc(70, 95, 38, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `700 36px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(i + 1), 70, 97);
    g.textAlign = "left";
    g.font = `700 46px ${font}`;
    g.fillText(s.title, 130, 72);
    g.fillStyle = "#94a3b8";
    g.font = `500 32px ${font}`;
    g.fillText(s.sub, 130, 128, 480);
  });
}

type Api = { update: (t: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const textures: THREE.Texture[] = [glow];
  const world = new THREE.Group();
  world.position.set(-0.15, -0.45, 0);
  root.add(world);

  // ── The path of light through the three platforms.
  const pts = [
    new THREE.Vector3(-4.2, -1.6, 0.9),
    STEPS[0].pos.clone().setY(STEPS[0].pos.y + 0.2),
    new THREE.Vector3(-1.2, 0.2, 0.4),
    STEPS[1].pos.clone().setY(STEPS[1].pos.y + 0.2),
    new THREE.Vector3(1.3, 0.1, -0.3),
    STEPS[2].pos.clone().setY(STEPS[2].pos.y + 0.2),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.4);
  const tubeMat = new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.35, toneMapped: false });
  world.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.018, 8, false), tubeMat));
  // The lit part of the path grows behind the pulse.
  const litGeo = new THREE.TubeGeometry(curve, 160, 0.032, 8, false);
  const litMat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false });
  const lit = new THREE.Mesh(litGeo, litMat);
  const litCount = litGeo.index!.count;
  world.add(lit);

  const pulse = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
  );
  pulse.scale.setScalar(0.7);
  world.add(pulse);
  const trail = Array.from({ length: 8 }, (_, i) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.5 * (1 - i / 8), depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    s.scale.setScalar(0.35 * (1 - i / 10));
    world.add(s);
    return s;
  });

  // ── Platforms.
  const hexGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.22, 6);
  const hexEdges = new THREE.EdgesGeometry(hexGeo);
  const platforms = STEPS.map((s, i) => {
    const g = new THREE.Group();
    g.position.copy(s.pos);
    world.add(g);
    const mat = new THREE.MeshPhysicalMaterial({
      color: "#0b3d6b",
      emissive: COLORS.teal,
      emissiveIntensity: 0.05,
      roughness: 0.2,
      metalness: 0.2,
      clearcoat: 1,
      transparent: true,
      opacity: 0.85,
    });
    const hex = new THREE.Mesh(hexGeo, mat);
    const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.5 });
    const edges = new THREE.LineSegments(hexEdges, edgeMat);
    g.add(hex, edges);
    // Ripple ring when the pulse arrives.
    const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.96, 6), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    g.add(ring);
    // Icon tile floating above.
    const face = iconFace(s);
    textures.push(face);
    const tile = new THREE.Group();
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(0.86, 0.86, 0.14, 4, 0.06),
      new THREE.MeshPhysicalMaterial({ color: "#0a3460", roughness: 0.3, clearcoat: 1, emissive: "#082957", emissiveIntensity: 0.4 }),
    );
    const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.84), new THREE.MeshBasicMaterial({ map: face, transparent: true, toneMapped: false }));
    faceMesh.position.z = 0.072;
    tile.add(body, faceMesh);
    tile.position.y = 0.95;
    g.add(tile);
    const beamMat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.0, toneMapped: false, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.3, 0.75, 6, 1, true), beamMat);
    beam.position.y = 0.48;
    g.add(beam);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    halo.scale.setScalar(2.2);
    halo.position.y = 0.6;
    g.add(halo);
    // Label card.
    const lt = labelTex(i, s);
    textures.push(lt);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt, transparent: true, depthWrite: false, toneMapped: false }));
    label.scale.set(1.75, (1.75 * 190) / 640, 1);
    label.position.set(0, -0.62, 0.4);
    g.add(label);
    return { g, mat, edgeMat, ringMat, ring, tile, beamMat, halo, label, at: s.at };
  });

  // ── The mark that rises over the finished clinic.
  const markMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mark = new THREE.Sprite(markMat);
  mark.scale.setScalar(1.1);
  world.add(mark);
  loadLogoMark((t) => {
    textures.push(t);
    markMat.map = t;
    markMat.needsUpdate = true;
  });
  const markGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  markGlow.scale.setScalar(2.6);
  world.add(markGlow);
  const MARK_AT = STEPS[2].pos.clone().add(new THREE.Vector3(0, 2.6, 0));

  // ── Drifting hexagon outlines in the background.
  const hexLine = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 7 }, (_, k) => new THREE.Vector3(Math.cos((k / 6) * Math.PI * 2), Math.sin((k / 6) * Math.PI * 2), 0)),
  );
  const drift = Array.from({ length: 14 }, (_, i) => {
    const m = new THREE.LineBasicMaterial({ color: i % 3 ? COLORS.teal : "#5fe0e4", transparent: true, opacity: 0.08 + (i % 4) * 0.04 });
    const l = new THREE.Line(hexLine, m);
    const r = 0.15 + ((i * 37) % 10) / 22;
    l.scale.setScalar(r);
    l.position.set(-5 + ((i * 53) % 100) / 10, -2.5 + ((i * 29) % 50) / 10, -2.5 - (i % 4) * 0.6);
    l.userData = { speed: 0.1 + (i % 5) * 0.04, spin: (i % 2 ? 1 : -1) * (0.1 + (i % 3) * 0.08), y0: l.position.y };
    root.add(l);
    return l;
  });

  const tmp = new THREE.Vector3();

  return {
    update(t, px, py) {
      const u = (t % LOOP) / LOOP;
      // Pulse runs 0 → 0.86 of the loop, rests on the last platform, then fades.
      const run = ease(u / 0.86) * 0.999;
      curve.getPointAt(run, tmp);
      pulse.position.copy(tmp);
      const fadeOut = 1 - Math.min(1, Math.max(0, (u - 0.94) / 0.06));
      (pulse.material as THREE.SpriteMaterial).opacity = fadeOut;
      pulse.scale.setScalar(0.6 + Math.sin(t * 8) * 0.08);
      trail.forEach((s, i) => {
        curve.getPointAt(Math.max(0, run - (i + 1) * 0.012), tmp);
        s.position.copy(tmp);
        s.visible = run > (i + 1) * 0.012;
      });
      lit.geometry.setDrawRange(0, Math.floor((litCount * run) / 3) * 3);
      litMat.opacity = fadeOut;
      litMat.transparent = true;

      platforms.forEach((p, i) => {
        const on = run >= p.at ? fadeOut : 0;
        const since = (run - p.at) * LOOP;
        p.mat.emissiveIntensity = lerp(p.mat.emissiveIntensity, 0.05 + on * 0.55, 0.12);
        p.edgeMat.opacity = 0.4 + on * 0.6;
        p.beamMat.opacity = lerp(p.beamMat.opacity, on * 0.22, 0.12);
        (p.halo.material as THREE.SpriteMaterial).opacity = lerp((p.halo.material as THREE.SpriteMaterial).opacity, on * 0.55, 0.1);
        const r = since > 0 && since < 1.2 ? since / 1.2 : 0;
        p.ring.scale.setScalar(1 + r * 0.9);
        p.ringMat.opacity = r > 0 ? (1 - r) * 0.8 : 0;
        p.tile.position.y = 0.95 + Math.sin(t * 1.4 + i) * 0.07 + on * 0.12;
        p.tile.rotation.y = Math.sin(t * 0.6 + i * 1.7) * 0.35;
        p.tile.scale.setScalar(1 + on * 0.08);
        p.g.position.y = STEPS[i].pos.y + Math.sin(t * 0.8 + i * 2) * 0.05;
        (p.label.material as THREE.SpriteMaterial).opacity = 0.55 + on * 0.45;
      });

      // The mark rises once the last platform lights.
      const m = Math.min(1, Math.max(0, (u - 0.86) / 0.06)) * fadeOut;
      markMat.opacity = m;
      mark.position.copy(MARK_AT).setY(MARK_AT.y - (1 - m) * 0.5 + Math.sin(t * 1.5) * 0.05);
      mark.scale.setScalar(0.8 + m * 0.35);
      (markGlow.material as THREE.SpriteMaterial).opacity = m * 0.7;
      markGlow.position.copy(mark.position);

      for (const l of drift) {
        l.rotation.z += 0.004 * l.userData.spin * 10;
        l.position.y = l.userData.y0 + Math.sin(t * l.userData.speed + l.position.x) * 0.3;
      }

      world.rotation.y = lerp(world.rotation.y, -0.12 + px * 0.18, 0.05);
      world.rotation.x = lerp(world.rotation.x, 0.12 - py * 0.08, 0.05);
    },
    dispose() {
      disposeDeep(root);
      textures.forEach((x) => x.dispose());
    },
  };
}

function Scene({ onReady }: { onReady: () => void }) {
  const holder = useRef<THREE.Group>(null);
  const api = useRef<Api | null>(null);
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
  useFrame(({ clock, pointer }) => api.current?.update(clock.elapsedTime, pointer.x, pointer.y));
  return <group ref={holder} />;
}

export default function JourneyScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.5, 2])}
      camera={{ position: [0, 0.4, 11], fov: 40 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#dff6ff", "#06203f", 1.2]} />
      <directionalLight position={[3, 6, 5]} intensity={1.6} />
      <pointLight position={[0, 2, 2]} intensity={5} distance={9} color={COLORS.tealGlow} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
