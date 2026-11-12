"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont, NarrowFit } from "./scene-kit";

/**
 * AI Scribe hero: sound through a prism. The doctor's dictation (a live 3D waveform)
 * flows into a glass prism — the AI — and leaves it split, like light, into the
 * sections of a clinical note. The note is a draft: the doctor checks each section,
 * then approves it. Loops every CYCLE seconds. Sample content only.
 */

const CYCLE = 11;
const PRISM = new THREE.Vector3(-0.55, 0, 0);
const BARS = 46;
const BAR_X0 = -4.1;
const BAR_X1 = -1.55;
const STRIP_W = 2.5;
const STRIP_H = 0.56;
const STRIP_X = 2.2;

// Shortened from the sample note (NOTE_SECTIONS) so each fits one line.
const SECTIONS: [string, string][] = [
  ["Chief complaint", "Sore throat and fever, 3 days"],
  ["Medical history", "Penicillin allergy"],
  ["Examination", "Temp 38.4 °C · tonsils enlarged"],
  ["Diagnosis", "Acute tonsillitis"],
  ["Medicines", "Azithromycin 500 mg × 3 days"],
];

const tex = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

function stripTexture(k: string, v: string) {
  const c = document.createElement("canvas");
  c.width = 1100;
  c.height = 224;
  const g = c.getContext("2d")!;
  const font = siteFont();
  g.fillStyle = "rgba(9,36,74,0.92)";
  g.beginPath();
  g.roundRect(4, 4, 1092, 216, 34);
  g.fill();
  g.strokeStyle = "rgba(95,224,228,0.45)";
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = COLORS.tealGlow;
  g.beginPath();
  g.roundRect(28, 44, 10, 136, 5);
  g.fill();
  g.textBaseline = "middle";
  g.fillStyle = COLORS.tealGlow;
  g.font = `700 30px ${font}`;
  g.fillText(k.toUpperCase(), 72, 78);
  g.fillStyle = "#f1f5f9";
  g.font = `500 46px ${font}`;
  g.fillText(v, 72, 146);
  return tex(c);
}

function badgeTexture(text: string, fg: string, bg: string, ring: string) {
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 120;
  const g = c.getContext("2d")!;
  const font = siteFont();
  g.font = `700 44px ${font}`;
  const w = g.measureText(text).width + 120;
  const x = (900 - w) / 2;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x, 10, w, 100, 50);
  g.fill();
  g.strokeStyle = ring;
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = fg;
  g.beginPath();
  g.arc(x + 52, 60, 11, 0, Math.PI * 2);
  g.fill();
  g.textBaseline = "middle";
  g.fillText(text, x + 80, 62);
  return tex(c);
}

function tickTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#22c55e";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 13;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(36, 66);
  g.lineTo(56, 86);
  g.lineTo(92, 44);
  g.stroke();
  return tex(c);
}

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

type Api = { update: (time: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);
  root.position.x = -0.85;
  const add = <T extends THREE.Object3D>(o: T) => (root.add(o), o);
  const glowSprite = (color: string, size: number, opacity = 1) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    s.scale.set(size, size, 1);
    return s;
  };

  // ── The dictation: a mirrored 3D waveform.
  const barGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  const barMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const bars = add(new THREE.InstancedMesh(barGeo, barMat, BARS));
  const dummy = new THREE.Object3D();
  const cA = new THREE.Color(COLORS.teal);
  const cB = new THREE.Color(COLORS.tealGlow);
  const col = new THREE.Color();
  for (let i = 0; i < BARS; i++) bars.setColorAt(i, col.copy(cA).lerp(cB, i / BARS));
  const waveGlow = add(glowSprite(COLORS.teal, 4, 0.35));
  waveGlow.position.set((BAR_X0 + BAR_X1) / 2, 0, -0.3);
  waveGlow.scale.set(4.2, 2.2, 1);

  // Sound particles flowing into the prism.
  const motes = Array.from({ length: 22 }, (_, i) => {
    const s = add(glowSprite(COLORS.tealGlow, 0.16));
    return { s, phase: (i * 0.618) % 1, y: ((i * 0.37) % 1) - 0.5 };
  });

  // ── The prism (the AI), with the mark floating inside.
  const prism = add(new THREE.Group());
  prism.position.copy(PRISM);
  const pGeo = new THREE.CylinderGeometry(0.78, 0.78, 2.1, 3, 1);
  const glass = new THREE.Mesh(
    pGeo,
    new THREE.MeshPhysicalMaterial({
      color: "#5fd6e0",
      emissive: COLORS.teal,
      emissiveIntensity: 0.18,
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.9, toneMapped: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(pGeo), edgeMat);
  const turn = new THREE.Group();
  turn.add(glass, edges);
  turn.rotation.x = 0.12;
  prism.add(turn);
  const core = glowSprite(COLORS.tealGlow, 2.2, 0.55);
  prism.add(core);
  const markMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mark = new THREE.Sprite(markMat);
  mark.scale.set(0.62, 0.62, 1);
  mark.position.z = 0.05;
  prism.add(mark);
  loadLogoMark((t) => {
    markMat.map = t;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
  });

  // ── The note: five sections fanned out to the right, with beams back to the prism.
  const note = add(new THREE.Group());
  note.rotation.y = -0.28;
  const tickTex = tickTexture();
  const strips = SECTIONS.map(([k, v], i) => {
    const target = new THREE.Vector3(STRIP_X, 1.32 - i * 0.66, 0);
    const mat = new THREE.MeshBasicMaterial({ map: stripTexture(k, v), transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_W, STRIP_H), mat);
    note.add(mesh);
    const tick = new THREE.Sprite(new THREE.SpriteMaterial({ map: tickTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    tick.scale.set(0.26, 0.26, 1);
    note.add(tick);
    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const beamMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false });
    const beam = add(new THREE.Line(beamGeo, beamMat));
    const spark = add(glowSprite(COLORS.tealGlow, 0.3, 0));
    return { mesh, mat, tick, target, beam, beamMat, spark };
  });
  const scan = glowSprite(COLORS.tealGlow, 1, 0);
  scan.scale.set(STRIP_W * 1.2, 0.5, 1);
  note.add(scan);

  const badgeMat = (t: THREE.Texture) => new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const draft = new THREE.Sprite(badgeMat(badgeTexture("Draft · awaiting doctor review", "#fcd34d", "rgba(120,72,6,0.55)", "rgba(252,211,77,0.6)")));
  const approved = new THREE.Sprite(badgeMat(badgeTexture("Approved by the doctor", "#86efac", "rgba(10,90,48,0.6)", "rgba(134,239,172,0.7)")));
  for (const b of [draft, approved]) {
    b.scale.set(2.6, 0.35, 1);
    b.position.set(STRIP_X, 2.12, 0.05);
    note.add(b);
  }

  const world = new THREE.Vector3();
  const exit = new THREE.Vector3();

  return {
    update(time, px, py) {
      const t = time % CYCLE;
      // Phases: speak 0–4.6 · split 1.6–5 · review 5.6–8 · approved 8.2–10.4 · fade out.
      const speaking = win(t, 0, 0.5) * (1 - win(t, 4.3, 5));
      const fadeOut = 1 - win(t, 10.2, 10.9);

      // Waveform: speech-like bursts travelling along the bars.
      for (let i = 0; i < BARS; i++) {
        const u = i / (BARS - 1);
        const syll = Math.abs(Math.sin(time * 7.3 + i * 0.55)) * (0.55 + 0.45 * Math.sin(time * 2.1 + i * 0.21));
        const env = Math.sin(u * Math.PI) ** 0.6;
        const h = 0.06 + speaking * env * (0.3 + 1.7 * syll * (0.6 + 0.4 * Math.sin(time * 1.3 - u * 5)));
        dummy.position.set(lerp(BAR_X0, BAR_X1, u), 0, 0);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
      }
      bars.instanceMatrix.needsUpdate = true;
      (waveGlow.material as THREE.SpriteMaterial).opacity = 0.12 + 0.3 * speaking;

      for (const m of motes) {
        const u = (time * 0.42 + m.phase) % 1;
        m.s.position.set(lerp(BAR_X1 - 0.6, PRISM.x - 0.15, u), m.y * 1.3 * (1 - u), 0.05);
        m.s.scale.setScalar(0.18 * Math.sin(u * Math.PI) + 0.02);
        (m.s.material as THREE.SpriteMaterial).opacity = speaking * Math.sin(u * Math.PI);
      }

      // Prism: turns slowly, brightens while it is working.
      const working = win(t, 0.8, 1.6) * (1 - win(t, 5, 6));
      turn.rotation.y = time * 0.35;
      edgeMat.opacity = 0.55 + 0.45 * working;
      (core.material as THREE.SpriteMaterial).opacity = (0.3 + 0.5 * working) * (0.85 + 0.15 * Math.sin(time * 5));
      prism.position.y = Math.sin(time * 0.9) * 0.06;

      // Sections leave the prism one by one.
      note.updateMatrixWorld();
      strips.forEach((s, i) => {
        const k = ease(win(t, 1.6 + i * 0.62, 2.4 + i * 0.62)) * fadeOut;
        s.mesh.position.set(lerp(-0.4, s.target.x, k), lerp(0, s.target.y, k), 0);
        // Relative to the note group: the prism sits left of it.
        s.mesh.scale.setScalar(lerp(0.25, 1, k));
        s.mat.opacity = k;
        // Beam from the prism's face to the section's left edge.
        world.set(s.mesh.position.x - (STRIP_W / 2) * s.mesh.scale.x, s.mesh.position.y, 0);
        note.localToWorld(world);
        exit.set(PRISM.x + 0.38, prism.position.y + (2 - i) * 0.16, 0);
        const pos = s.beam.geometry.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(0, exit.x, exit.y, exit.z);
        pos.setXYZ(1, world.x, world.y, world.z);
        pos.needsUpdate = true;
        const beamOn = win(t, 1.4 + i * 0.62, 1.8 + i * 0.62) * fadeOut;
        s.beamMat.opacity = 0.65 * beamOn * (0.7 + 0.3 * Math.sin(time * 4 + i));
        const u = (time * 0.7 + i * 0.2) % 1;
        s.spark.position.lerpVectors(exit, world, u);
        (s.spark.material as THREE.SpriteMaterial).opacity = beamOn * Math.sin(u * Math.PI);

        // Review: the doctor checks each section, top to bottom.
        const checked = win(t, 5.9 + i * 0.42, 6.15 + i * 0.42) * fadeOut;
        s.tick.position.set(s.mesh.position.x + STRIP_W / 2 - 0.22, s.mesh.position.y + 0.02, 0.02);
        (s.tick.material as THREE.SpriteMaterial).opacity = checked;
        s.tick.scale.setScalar(0.26 * (0.6 + 0.4 * ease(checked)));
      });

      // The review highlight sweeps down the note.
      const sweep = win(t, 5.6, 8);
      scan.position.set(STRIP_X, lerp(1.6, -1.6, sweep), 0.01);
      (scan.material as THREE.SpriteMaterial).opacity = Math.sin(sweep * Math.PI) * 0.45;

      (draft.material as THREE.SpriteMaterial).opacity = win(t, 4.6, 5.2) * (1 - win(t, 8.1, 8.4));
      const ok = win(t, 8.2, 8.6) * fadeOut;
      (approved.material as THREE.SpriteMaterial).opacity = ok;
      approved.scale.set(2.6 * (0.9 + 0.1 * ease(ok)), 0.35 * (0.9 + 0.1 * ease(ok)), 1);

      // Pointer parallax.
      root.rotation.y = lerp(root.rotation.y, px * 0.12, 0.05);
      root.rotation.x = lerp(root.rotation.x, -py * 0.06, 0.05);
    },
    dispose() {
      disposeDeep(root);
      glow.dispose();
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

export default function ScribeHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1, 1.75])}
      camera={{ position: [0, 0.15, 8.3], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} />
      <Scene onReady={onReady} />
      <NarrowFit span={1.85} />
    </Canvas>
  );
}
