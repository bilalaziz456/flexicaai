"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  COLORS,
  FrameOffset,
  Imperative,
  StoryCanvas,
  StudioLights,
  disposeDeep,
  glowTexture,
  labelTexture,
  lerp,
  siteFont,
  sstep,
  type Built,
} from "./scene-kit";
import type { StorySceneProps } from "./story-stage";

/**
 * ABOUT — "From paper to one source of truth".
 *  0.00–0.25  a cloud of registers, spreadsheets, sticky notes and receipts drifts
 *  0.25–0.55  it swirls into a vortex and is pulled to the centre
 *  0.52–0.75  it collapses into one glowing patient record (sample), rows filling in
 *  0.75–1.00  threads reach out from the record to the chain:
 *             WhatsApp → Appointment → Visit → Note → Bill → P&L
 */

const CENTER = new THREE.Vector3(1.5, 0.7, 0);
const CARD = 1.3;
const PAPERS = 46;
const CHAIN = ["WhatsApp message", "Appointment", "Visit", "Clinical note", "Bill", "Profit & loss"];

/** Deterministic pseudo-random numbers, so the cloud is the same on every visit. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Handwriting-ish strokes. */
function scribble(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, maxW: number, color: string) {
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  let cx = x;
  const end = x + maxW * (0.45 + r() * 0.55);
  g.moveTo(cx, y);
  while (cx < end) {
    const step = 6 + r() * 8;
    g.quadraticCurveTo(cx + step / 2, y - 4 - r() * 6, cx + step, y + (r() - 0.5) * 3);
    cx += step;
  }
  g.stroke();
}

function registerTexture() {
  const [c, g] = canvas(256, 330);
  const r = rng(11);
  g.fillStyle = "#f3ead3";
  g.fillRect(0, 0, 256, 330);
  g.strokeStyle = "#9fb7d6";
  g.lineWidth = 1.5;
  for (let y = 40; y < 330; y += 20) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.strokeStyle = "#d9534f";
  g.beginPath();
  g.moveTo(36, 0);
  g.lineTo(36, 330);
  g.stroke();
  for (let y = 56; y < 320; y += 20) if (r() > 0.2) scribble(g, r, 46, y - 6, 190, "#33415c");
  return tex(c);
}

function sheetTexture() {
  const [c, g] = canvas(300, 300);
  const r = rng(23);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 300, 300);
  g.fillStyle = "#d8eee0";
  g.fillRect(0, 0, 300, 26);
  g.fillStyle = "#eef2f6";
  g.fillRect(0, 0, 40, 300);
  g.strokeStyle = "#c4ccd6";
  g.lineWidth = 1;
  for (let x = 40; x < 300; x += 52) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 300);
    g.stroke();
  }
  for (let y = 26; y < 300; y += 22) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(300, y);
    g.stroke();
  }
  g.fillStyle = "#7b8798";
  for (let y = 32; y < 290; y += 22)
    for (let x = 46; x < 290; x += 52) if (r() > 0.3) g.fillRect(x, y + 4, 12 + r() * 30, 6);
  return tex(c);
}

function stickyTexture(color: string, seed: number) {
  const [c, g] = canvas(220, 220);
  const r = rng(seed);
  g.fillStyle = color;
  g.fillRect(0, 0, 220, 220);
  g.fillStyle = "rgba(0,0,0,0.06)";
  g.fillRect(0, 0, 220, 26);
  for (let y = 62; y < 200; y += 32) scribble(g, r, 22, y, 170, "#3b3b52");
  return tex(c);
}

function receiptTexture() {
  const [c, g] = canvas(150, 330);
  const r = rng(37);
  g.fillStyle = "#fbfbf8";
  g.fillRect(0, 0, 150, 330);
  g.fillStyle = "#5b6576";
  g.fillRect(35, 20, 80, 10);
  for (let y = 54; y < 250; y += 18) {
    g.fillRect(14, y, 40 + r() * 40, 5);
    g.fillRect(110 + r() * 10, y, 24, 5);
  }
  g.setLineDash([6, 5]);
  g.strokeStyle = "#8a94a6";
  g.beginPath();
  g.moveTo(10, 268);
  g.lineTo(140, 268);
  g.stroke();
  g.fillRect(14, 282, 60, 8);
  g.fillRect(100, 282, 36, 8);
  return tex(c);
}

/** The single sample record; `rows` controls how many sections have filled in. */
function recordTexture(rows: number) {
  const W = 1024;
  const H = 660;
  const [c, g] = canvas(W, H);
  const font = siteFont();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.roundRect(0, 0, W, H, 44);
  g.fill();
  // Header
  g.fillStyle = "#e6f7f8";
  g.beginPath();
  g.roundRect(0, 0, W, 170, [44, 44, 0, 0]);
  g.fill();
  g.fillStyle = COLORS.teal;
  g.beginPath();
  g.arc(110, 86, 52, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ffffff";
  g.font = `700 40px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("AK", 110, 88);
  g.textAlign = "left";
  g.fillStyle = COLORS.ink;
  g.font = `700 50px ${font}`;
  g.fillText("Ayesha Khan", 190, 66);
  g.fillStyle = "#5b6b80";
  g.font = `500 30px ${font}`;
  g.fillText("MRN FA-100248 · one record for the whole clinic", 190, 116);
  g.fillStyle = "#f5a524";
  g.font = `600 22px ${font}`;
  g.textAlign = "right";
  g.fillText("SAMPLE", W - 48, 46);
  g.textAlign = "left";

  const items: [string, string][] = [
    ["WhatsApp", "Booking request · confirmed"],
    ["Appointments", "Thu, 14 Nov · 10:30 am · Dr. Sana Malik"],
    ["Clinical notes", "Acute tonsillitis · approved by doctor"],
    ["Bills", "Consultation · invoice & receipt"],
  ];
  items.forEach(([k, v], i) => {
    const y = 210 + i * 108;
    const on = i < rows;
    g.fillStyle = on ? "#f2f7fb" : "#f7f9fb";
    g.beginPath();
    g.roundRect(40, y, W - 80, 88, 22);
    g.fill();
    if (!on) {
      g.fillStyle = "#e3e9f0";
      g.fillRect(80, y + 30, 220, 26);
      g.fillRect(360, y + 30, 360, 26);
      return;
    }
    g.fillStyle = COLORS.teal;
    g.beginPath();
    g.arc(84, y + 44, 12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = COLORS.ink;
    g.font = `650 32px ${font}`;
    g.fillText(k, 116, y + 46);
    g.fillStyle = "#4a5a70";
    g.font = `500 28px ${font}`;
    g.fillText(v, 380, y + 46);
  });
  return tex(c);
}

type Paper = {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  spin: THREE.Vector3;
  rot0: THREE.Euler;
  angle0: number;
  radius0: number;
  speed: number;
  phase: number;
  scale: number;
};

function build(root: THREE.Group): Built {
  const r = rng(7);
  const disposables: THREE.Texture[] = [];

  // ── The paper cloud
  const kinds = [
    { t: registerTexture(), w: 0.78, h: 1.0 },
    { t: sheetTexture(), w: 0.95, h: 0.95 },
    { t: stickyTexture("#fde68a", 51), w: 0.5, h: 0.5 },
    { t: stickyTexture("#fbcfe8", 52), w: 0.5, h: 0.5 },
    { t: stickyTexture("#a7f3d0", 53), w: 0.5, h: 0.5 },
    { t: receiptTexture(), w: 0.42, h: 0.92 },
  ];
  const kindMats = kinds.map(
    (k) =>
      new THREE.MeshStandardMaterial({ map: k.t, emissiveMap: k.t, emissive: "#ffffff", emissiveIntensity: 0.45, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }),
  );
  const kindGeos = kinds.map((k) => new THREE.PlaneGeometry(k.w, k.h));
  const cloud = new THREE.Group();
  root.add(cloud);
  const papers: Paper[] = [];
  for (let i = 0; i < PAPERS; i++) {
    const k = i % kinds.length === 1 && r() > 0.5 ? 0 : i % kinds.length;
    const mesh = new THREE.Mesh(kindGeos[k], kindMats[k]);
    const angle0 = r() * Math.PI * 2;
    const radius0 = 1.4 + r() * 2.8;
    const start = new THREE.Vector3(
      CENTER.x + Math.cos(angle0) * radius0 * 1.15,
      CENTER.y + (r() - 0.5) * 4.2,
      Math.sin(angle0) * radius0 * 0.9 - 0.6,
    );
    papers.push({
      mesh,
      start,
      spin: new THREE.Vector3((r() - 0.5) * 7, (r() - 0.5) * 7, (r() - 0.5) * 5),
      rot0: new THREE.Euler(r() * 6, r() * 6, r() * 6),
      angle0,
      radius0,
      speed: 0.7 + r() * 0.6,
      phase: r() * 10,
      scale: 0.75 + r() * 0.5,
    });
    cloud.add(mesh);
  }

  // ── The flash where the paper collapses
  const glowTex = glowTexture(COLORS.tealGlow);
  disposables.push(glowTex);
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  flash.position.copy(CENTER);
  root.add(flash);

  // ── The record
  const record = new THREE.Group();
  record.position.copy(CENTER);
  root.add(record);
  const slab = new THREE.Mesh(
    new RoundedBoxGeometry(2.86, 1.86, 0.08, 4, 0.07),
    new THREE.MeshStandardMaterial({ color: "#0b2f5c", roughness: 0.35, metalness: 0.2, emissive: COLORS.teal, emissiveIntensity: 0.25 }),
  );
  record.add(slab);
  const faces = [0, 1, 2, 3, 4].map((n) => recordTexture(n));
  disposables.push(...faces);
  const faceMat = new THREE.MeshBasicMaterial({ map: faces[0], toneMapped: false, transparent: true });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.72, 1.753), faceMat);
  face.position.z = 0.045;
  record.add(face);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  halo.scale.set(5.2, 3.8, 1);
  halo.position.z = -0.2;
  record.add(halo);

  // ── The chain: labels on a gentle arc below the record, threads from the record
  const chain = new THREE.Group();
  root.add(chain);
  const threadMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.85, toneMapped: false });
  const labels: { mesh: THREE.Mesh; thread: THREE.Line; curve: THREE.QuadraticBezierCurve3; pulse: THREE.Sprite; target: THREE.Vector3 }[] = [];
  const pulseMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  CHAIN.forEach((name, i) => {
    const u = i / (CHAIN.length - 1);
    const x = lerp(-0.75, 4.4, u);
    const y = -1.75 - Math.sin(u * Math.PI) * 0.45 - (i % 2) * 0.48;
    const t = labelTexture(name, { w: 640, h: 144, bg: "#0b2f5c", fg: "#ffffff", border: COLORS.teal, size: 52, radius: 72 });
    disposables.push(t);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.27), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, opacity: 0 }));
    const target = new THREE.Vector3(x, y, 0.2);
    mesh.position.copy(target);
    chain.add(mesh);
    const from = new THREE.Vector3(CENTER.x + (u - 0.5) * 2.2, CENTER.y - 0.93 * CARD, 0.05);
    const to = new THREE.Vector3(x, y + 0.14, 0.2);
    const mid = new THREE.Vector3((from.x + to.x) / 2, (from.y + to.y) / 2 + 0.05, 0.6);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    geo.setDrawRange(0, 0);
    const thread = new THREE.Line(geo, threadMat);
    chain.add(thread);
    const pulse = new THREE.Sprite(pulseMat);
    pulse.scale.setScalar(0.22);
    pulse.visible = false;
    chain.add(pulse);
    labels.push({ mesh, thread, curve, pulse, target });
  });
  // Small chevrons between consecutive labels: the order of the chain.
  const chevGeo = new THREE.ConeGeometry(0.05, 0.12, 3);
  const chevMat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false });
  const chevrons: THREE.Mesh[] = [];
  for (let i = 0; i < CHAIN.length - 1; i++) {
    const a = labels[i].target;
    const b = labels[i + 1].target;
    const m = new THREE.Mesh(chevGeo, chevMat);
    m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0.2);
    m.rotation.z = -Math.PI / 2 + Math.atan2(b.y - a.y, b.x - a.x);
    chain.add(m);
    chevrons.push(m);
  }

  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let lastFace = -1;

  return {
    update(p, camera) {
      // Camera: a slow push-in as the paper collapses, then eases back to show the chain.
      const push = sstep(0.2, 0.62, p);
      const back = sstep(0.72, 0.9, p);
      camera.position.set(lerp(0.4, 0.9, push), lerp(1.0, 0.7, push) - 0.3 * back, lerp(11.5, 8.4, push) + 1.6 * back);
      look.set(lerp(1.2, CENTER.x, push), lerp(0.4, CENTER.y, push) - 0.85 * back, 0);
      camera.lookAt(look);

      // Paper: drift → vortex → absorbed.
      const swirl = sstep(0.25, 0.56, p);
      const absorb = sstep(0.46, 0.58, p);
      for (const pp of papers) {
        const drift = p * 2.2 * pp.speed + pp.phase;
        if (swirl <= 0) {
          pp.mesh.position.set(
            pp.start.x + Math.sin(drift) * 0.25,
            pp.start.y + Math.cos(drift * 0.8) * 0.2,
            pp.start.z + Math.sin(drift * 0.6) * 0.2,
          );
        } else {
          const ang = pp.angle0 + swirl * swirl * 7 * pp.speed + Math.sin(drift) * 0.1 * (1 - swirl);
          const rad = pp.radius0 * Math.pow(1 - swirl, 1.4) * 1.15;
          tmp.set(CENTER.x + Math.cos(ang) * rad, lerp(pp.start.y, CENTER.y, swirl), CENTER.z + Math.sin(ang) * rad * 0.8 - 0.6 * (1 - swirl));
          // Blend from the drift position so the vortex starts without a jump.
          const b = sstep(0, 0.25, swirl);
          pp.mesh.position.set(
            lerp(pp.start.x + Math.sin(drift) * 0.25, tmp.x, b),
            lerp(pp.start.y + Math.cos(drift * 0.8) * 0.2, tmp.y, b),
            lerp(pp.start.z + Math.sin(drift * 0.6) * 0.2, tmp.z, b),
          );
        }
        const tumble = 1 - swirl * 0.6;
        pp.mesh.rotation.set(
          pp.rot0.x + pp.spin.x * p * tumble,
          pp.rot0.y + pp.spin.y * p * tumble + swirl * 4,
          pp.rot0.z + pp.spin.z * p * tumble,
        );
        const s = pp.scale * (1 - absorb);
        pp.mesh.scale.setScalar(Math.max(0.0001, s));
        pp.mesh.visible = s > 0.002;
      }

      // Flash + record.
      const flashT = sstep(0.5, 0.56, p) * (1 - sstep(0.58, 0.68, p));
      (flash.material as THREE.SpriteMaterial).opacity = 0.75 * flashT;
      flash.scale.setScalar(0.8 + flashT * 2.4);
      const born = sstep(0.53, 0.65, p);
      record.visible = born > 0.001;
      record.scale.setScalar(Math.max(0.001, lerp(0.15, CARD, born)));
      record.rotation.set(lerp(0.35, 0.06, born), lerp(-0.6, -0.12, born) + Math.sin(p * 9) * 0.03, 0);
      faceMat.opacity = sstep(0.58, 0.66, p);
      (halo.material as THREE.SpriteMaterial).opacity = 0.55 * born;
      const rows = Math.min(4, Math.floor(sstep(0.62, 0.76, p) * 4.999));
      if (rows !== lastFace) {
        faceMat.map = faces[rows];
        faceMat.needsUpdate = true;
        lastFace = rows;
      }

      // Chain: threads draw out one after another, then labels appear; pulses travel.
      labels.forEach((l, i) => {
        const a = 0.76 + i * 0.028;
        const grow = sstep(a, a + 0.05, p);
        l.thread.geometry.setDrawRange(0, Math.floor(grow * 41));
        const show = sstep(a + 0.035, a + 0.07, p);
        (l.mesh.material as THREE.MeshBasicMaterial).opacity = show;
        l.mesh.scale.setScalar(lerp(0.85, 1, show));
        const live = sstep(0.93, 0.96, p);
        l.pulse.visible = live > 0.01;
        if (l.pulse.visible) {
          const t = (p * 18 + i * 0.17) % 1;
          l.curve.getPoint(t, l.pulse.position);
          (l.pulse.material as THREE.SpriteMaterial).opacity = live;
        }
      });
      chevMat.opacity = sstep(0.92, 0.96, p);
    },
    dispose() {
      disposeDeep(root);
      disposables.forEach((t) => t.dispose());
      kinds.forEach((k) => k.t.dispose());
    },
  };
}

export default function AboutScene({ bus, onReady }: StorySceneProps) {
  return (
    <StoryCanvas onReady={onReady} camera={{ position: [0.4, 1, 11.5], fov: 38 }}>
      <StudioLights dark />
      <FrameOffset x={0.12} narrowZoom={1.15} />
      <Imperative bus={bus} build={build} />
    </StoryCanvas>
  );
}
