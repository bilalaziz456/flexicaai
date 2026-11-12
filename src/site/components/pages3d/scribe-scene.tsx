"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { SAMPLE } from "../mockups/frame";
import { DICTATION, NOTE_SECTIONS } from "../mockups/scribe";
import {
  COLORS,
  FrameOffset,
  Imperative,
  StoryCanvas,
  StudioLights,
  clamp01,
  disposeDeep,
  glowTexture,
  lerp,
  siteFont,
  sstep,
  window01,
  type Built,
  type StorySceneProps,
} from "./scene-kit";

/**
 * Voice → transcript → structured draft → approved note.
 *
 *  0.00–0.25  Record: a microphone, a ring of live level bars and sound ripples.
 *  0.25–0.50  Transcribe: light streams from the mic into a glass panel where the
 *             dictation types itself out — the unclear word is highlighted amber.
 *  0.50–0.75  Structure: the panel turns over into the draft note; its sections fill
 *             one by one, and the unclear item lands as a flag for the doctor.
 *  0.75–1.00  Review and approve: the flag is resolved, a teal seal stamps the note
 *             and it turns Approved.
 */

const MIC = new THREE.Vector3(-0.3, 0.1, 0);
const PANEL = new THREE.Vector3(3.0, 0.05, 0);
const BARS = 72;
const PARTICLES = 520;

// The note rows shown on the card (a subset of the sample note, in order).
const ROWS = NOTE_SECTIONS.filter((s) =>
  ["Chief complaint", "Medical history", "Examination", "Diagnosis", "Medicines", "Needs your review", "Next visit"].includes(s.k),
);
const RESOLVED = "Confirmed by doctor: no second medicine.";

// ─── Canvas drawing ──────────────────────────────────────────────────────────

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, text: string, fg: string, bg: string, font: string) {
  g.font = `700 26px ${font}`;
  const w = g.measureText(text).width + 44;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(x - w, y, w, 46, 23);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x - w / 2, y + 24);
  g.textAlign = "left";
}

/** Transcript panel: the dictation typed out to `chars` characters. Returns the cursor (uv). */
function drawTranscript(c: HTMLCanvasElement, chars: number) {
  const g = c.getContext("2d")!;
  const font = siteFont();
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "rgba(8,41,87,0.78)";
  g.beginPath();
  g.roundRect(4, 4, W - 8, H - 8, 44);
  g.fill();
  g.strokeStyle = "rgba(95,224,228,0.45)";
  g.lineWidth = 4;
  g.stroke();

  g.fillStyle = COLORS.tealGlow;
  g.font = `700 24px ${font}`;
  g.textBaseline = "alphabetic";
  g.fillText("TRANSCRIPT", 56, 76);
  pill(g, W - 48, 44, chars < DICTATION.length ? "● Transcribing" : "Transcribed", "#bff7f8", "rgba(15,180,187,0.22)", font);

  g.font = `500 33px ${font}`;
  const lines = wrap(g, DICTATION, W - 112);
  let left = chars;
  let y = 142;
  let cx = 56;
  let cy = y;
  for (const line of lines) {
    if (left <= 0) break;
    const shown = line.slice(0, left);
    left -= line.length + 1;
    // Draw word by word so "[unclear]" can be marked.
    let x = 56;
    for (const word of shown.split(" ")) {
      const ww = g.measureText(word).width;
      if (word.includes("[unclear]")) {
        g.fillStyle = "rgba(245,165,36,0.28)";
        g.beginPath();
        g.roundRect(x - 6, y - 32, ww + 12, 44, 10);
        g.fill();
        g.fillStyle = "#fde3a7";
      } else g.fillStyle = "#e6eef8";
      g.fillText(word, x, y);
      x += ww + g.measureText(" ").width;
    }
    cx = x;
    cy = y;
    y += 50;
  }
  // Cursor
  if (chars < DICTATION.length) {
    g.fillStyle = COLORS.tealGlow;
    g.fillRect(cx - 4, cy - 30, 4, 38);
  }
  return [cx / W, cy / H] as const;
}

type NoteStage = { rows: number; status: "draft" | "editing" | "approved" };

function drawNote(c: HTMLCanvasElement, s: NoteStage) {
  const g = c.getContext("2d")!;
  const font = siteFont();
  const W = c.width;
  const H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#0b2547";
  g.beginPath();
  g.roundRect(0, 0, W, H, 48);
  g.fill();

  // Header
  g.fillStyle = "#ffffff";
  g.font = `700 38px ${font}`;
  g.textBaseline = "alphabetic";
  g.fillText(`Clinical note · ${SAMPLE.patient}`, 56, 92);
  g.fillStyle = "#94a3b8";
  g.font = `500 25px ${font}`;
  g.fillText("Structured by AI from the doctor's dictation", 56, 134);
  if (s.status === "draft") pill(g, W - 48, 62, "Draft · awaiting review", "#fde3a7", "rgba(245,165,36,0.2)", font);
  if (s.status === "editing") pill(g, W - 48, 62, "Doctor reviewing", "#bae6fd", "rgba(56,189,248,0.2)", font);
  if (s.status === "approved") pill(g, W - 48, 62, "✓ Approved", "#bbf7d0", "rgba(34,197,94,0.22)", font);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(56, 170, W - 112, 2);

  let y = 222;
  ROWS.forEach((row, i) => {
    if (i >= s.rows) return;
    const flagged = !!row.flag && s.status !== "approved";
    const resolved = !!row.flag && s.status === "approved";
    g.font = `500 27px ${font}`;
    const lines = wrap(g, resolved ? RESOLVED : row.v, W - 112 - 270);
    const h = Math.max(1, lines.length) * 38 + 26;
    if (flagged) {
      g.fillStyle = "rgba(245,165,36,0.16)";
      g.beginPath();
      g.roundRect(40, y - 40, W - 80, h + 8, 18);
      g.fill();
      g.strokeStyle = "rgba(245,165,36,0.55)";
      g.lineWidth = 3;
      g.stroke();
    }
    g.fillStyle = flagged ? "#fcd34d" : resolved ? "#86efac" : "#94a3b8";
    g.font = `600 25px ${font}`;
    g.fillText(flagged ? "⚠ Needs review" : resolved ? "✓ Reviewed" : row.k, 56, y);
    g.fillStyle = flagged ? "#fef3c7" : resolved ? "#dcfce7" : "#f1f5f9";
    g.font = `500 27px ${font}`;
    lines.forEach((l, k) => g.fillText(l, 56 + 270, y + k * 38));
    y += h;
  });

  if (s.status === "approved") {
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(56, H - 108, W - 112, 2);
    g.fillStyle = "#86efac";
    g.font = `600 26px ${font}`;
    g.fillText(`Approved by ${SAMPLE.doctor} — now part of the record`, 56, H - 56);
  }
}

// ─── Scene ───────────────────────────────────────────────────────────────────

function build(root: THREE.Group): Built {
  const glow = glowTexture(COLORS.tealGlow);
  const mat = {
    navy: new THREE.MeshStandardMaterial({ color: "#0d2f57", roughness: 0.35, metalness: 0.4 }),
    grille: new THREE.MeshStandardMaterial({ color: "#1d4a7a", roughness: 0.25, metalness: 0.7 }),
    teal: new THREE.MeshStandardMaterial({ color: COLORS.teal, emissive: COLORS.teal, emissiveIntensity: 0.9, roughness: 0.3 }),
    bar: new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false, transparent: true }),
  };

  // Microphone on a short stand.
  const mic = new THREE.Group();
  mic.position.copy(MIC);
  const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 8, 24), mat.grille);
  head.position.y = 0.35;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 12, 48), mat.teal);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.18;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 16), mat.navy);
  neck.position.y = -0.5;
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 10, 40, Math.PI), mat.navy);
  yoke.rotation.z = Math.PI;
  yoke.position.y = 0.15;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.08, 40), mat.navy);
  base.position.y = -0.86;
  mic.add(head, band, neck, yoke, base);
  root.add(mic);

  // Level bars around the mic.
  const barGeo = new THREE.BoxGeometry(0.045, 1, 0.045);
  barGeo.translate(0, 0.5, 0);
  const bars = new THREE.InstancedMesh(barGeo, mat.bar, BARS);
  bars.position.copy(MIC).add(new THREE.Vector3(0, 0.35, 0));
  root.add(bars);
  const dummy = new THREE.Object3D();

  // Ripples.
  const rippleGeo = new THREE.TorusGeometry(1, 0.012, 8, 96);
  const ripples = [0, 1, 2].map(() => {
    const r = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    r.position.copy(bars.position);
    root.add(r);
    return r;
  });

  // Transcript panel (glass) and the note card share a pivot so one can turn into the other.
  const pivot = new THREE.Group();
  pivot.position.copy(PANEL);
  root.add(pivot);

  const tCanvas = document.createElement("canvas");
  tCanvas.width = 1024;
  tCanvas.height = 760;
  const tTex = new THREE.CanvasTexture(tCanvas);
  tTex.colorSpace = THREE.SRGBColorSpace;
  tTex.anisotropy = 8;
  const panelW = 3.5;
  const panelH = (panelW * tCanvas.height) / tCanvas.width;
  const transcript = new THREE.Mesh(
    new THREE.PlaneGeometry(panelW, panelH),
    new THREE.MeshBasicMaterial({ map: tTex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
  );
  pivot.add(transcript);

  const nCanvas = document.createElement("canvas");
  nCanvas.width = 1024;
  nCanvas.height = 1180;
  const nTex = new THREE.CanvasTexture(nCanvas);
  nTex.colorSpace = THREE.SRGBColorSpace;
  nTex.anisotropy = 8;
  const cardW = 3.3;
  const cardH = (cardW * nCanvas.height) / nCanvas.width;
  const card = new THREE.Group();
  const slab = new THREE.Mesh(new RoundedBoxGeometry(cardW + 0.08, cardH + 0.08, 0.06, 4, 0.06), mat.navy);
  slab.position.z = -0.04;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), new THREE.MeshBasicMaterial({ map: nTex, toneMapped: false }));
  face.position.z = 0.002;
  const rimMat = new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false });
  const rim = new THREE.Mesh(new RoundedBoxGeometry(cardW + 0.12, cardH + 0.12, 0.02, 4, 0.08), rimMat);
  rim.position.z = -0.09;
  card.add(rim, slab, face);
  pivot.add(card);

  // Approval seal.
  const seal = new THREE.Group();
  const sealMat = new THREE.MeshStandardMaterial({ color: COLORS.green, emissive: COLORS.green, emissiveIntensity: 0.7, roughness: 0.3, transparent: true });
  seal.add(new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 16, 64), sealMat));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 48), new THREE.MeshBasicMaterial({ color: "#0b3b2a", transparent: true, toneMapped: false }));
  disc.position.z = -0.01;
  seal.add(disc);
  const tick1 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.2, 0.05, 2, 0.02), sealMat);
  tick1.position.set(-0.07, -0.03, 0.02);
  tick1.rotation.z = 0.75;
  const tick2 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.38, 0.05, 2, 0.02), sealMat);
  tick2.position.set(0.07, 0.04, 0.02);
  tick2.rotation.z = -0.6;
  seal.add(tick1, tick2);
  seal.position.set(cardW / 2 - 0.35, cardH / 2 - 0.35, 0.3);
  card.add(seal);
  const pulse = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: COLORS.green, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
  pulse.position.copy(seal.position);
  card.add(pulse);

  // Light particles: mic → typing cursor.
  const seeds = new Float32Array(PARTICLES * 4);
  for (let i = 0; i < PARTICLES; i++) {
    const h = Math.sin(i * 12.9898) * 43758.5453;
    const r1 = h - Math.floor(h);
    const h2 = Math.sin(i * 78.233) * 12543.123;
    const r2 = h2 - Math.floor(h2);
    seeds[i * 4] = r1;
    seeds[i * 4 + 1] = r2;
    seeds[i * 4 + 2] = (r1 + r2 * 7) % 1;
    seeds[i * 4 + 3] = (r2 * 3 + r1 * 5) % 1;
  }
  const pos = new Float32Array(PARTICLES * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.11, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0 });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  root.add(points);

  // Background halo.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
  halo.scale.set(9, 9, 1);
  halo.position.set(1.6, 0, -3);
  root.add(halo);

  let lastChars = -1;
  let lastNote = "";
  let cursorU = 0;
  let cursorV = 0;
  const cursorWorld = new THREE.Vector3();
  const look = new THREE.Vector3();

  return {
    update(p, camera) {
      const t = p * 80;

      // ── Record
      const recording = 1 - sstep(0.3, 0.42, p);
      const level = 0.35 + 0.65 * window01(0.02, 0.48, p, 0.06);
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2;
        const amp = 0.12 + 0.55 * Math.abs(Math.sin(i * 0.61 + t * 1.3) * Math.sin(i * 0.17 + t * 0.7)) * level;
        dummy.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0);
        dummy.rotation.set(0, 0, a - Math.PI / 2);
        dummy.scale.set(1, Math.max(0.001, amp * recording), 1);
        dummy.updateMatrix();
        bars.setMatrixAt(i, dummy.matrix);
      }
      bars.instanceMatrix.needsUpdate = true;
      mat.bar.opacity = 0.9 * recording;
      ripples.forEach((r, i) => {
        const k = (t * 0.25 + i / 3) % 1;
        r.scale.setScalar(1.2 + k * 1.6);
        (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.5 * recording * sstep(0.0, 0.05, p);
      });
      mic.scale.setScalar(lerp(1, 0.75, sstep(0.45, 0.6, p)));
      mic.position.x = lerp(MIC.x, MIC.x - 0.4, sstep(0.45, 0.6, p));
      mat.teal.emissiveIntensity = 0.5 + 0.7 * recording * (0.5 + 0.5 * Math.sin(t * 2));

      // ── Transcribe: the dictation types out over 0.27–0.48.
      const typed = sstep(0.27, 0.48, p);
      const chars = Math.round((DICTATION.length * typed) / 3) * 3;
      if (chars !== lastChars) {
        [cursorU, cursorV] = drawTranscript(tCanvas, Math.min(DICTATION.length, chars));
        tTex.needsUpdate = true;
        lastChars = chars;
      }
      const turn = sstep(0.5, 0.58, p); // panel turns over into the note
      const tVis = sstep(0.24, 0.29, p) * (1 - sstep(0.5, 0.54, p));
      (transcript.material as THREE.MeshBasicMaterial).opacity = tVis;
      transcript.visible = tVis > 0.001;
      transcript.position.y = lerp(-0.3, 0, sstep(0.24, 0.3, p));

      // Particles flow while typing.
      const flow = window01(0.24, 0.5, p, 0.03);
      pMat.opacity = flow;
      cursorWorld.set(PANEL.x + (cursorU - 0.5) * panelW, PANEL.y + (0.5 - cursorV) * panelH, 0.05);
      const from = bars.position;
      for (let i = 0; i < PARTICLES; i++) {
        const s0 = seeds[i * 4];
        const s1 = seeds[i * 4 + 1];
        const k = (t * 0.06 + s0) % 1; // position along the stream
        const arc = Math.sin(k * Math.PI);
        const spread = 0.35 * (1 - k) + 0.05;
        pos[i * 3] = lerp(from.x, cursorWorld.x, k) + (s1 - 0.5) * spread;
        pos[i * 3 + 1] = lerp(from.y, cursorWorld.y, k) + arc * (0.9 + s1 * 0.6) * (seeds[i * 4 + 2] > 0.5 ? 1 : -0.6) + (seeds[i * 4 + 3] - 0.5) * spread;
        pos[i * 3 + 2] = arc * (s0 - 0.5) * 0.8;
      }
      pGeo.attributes.position.needsUpdate = true;
      points.visible = flow > 0.001;

      // ── Structure: card turns in; rows fill 0.56–0.74.
      const rows = Math.floor(clamp01((p - 0.56) / 0.18) * ROWS.length + 0.0001);
      const status: NoteStage["status"] = p >= 0.9 ? "approved" : p >= 0.78 ? "editing" : "draft";
      const key = `${rows}|${status}`;
      if (key !== lastNote) {
        drawNote(nCanvas, { rows: Math.min(rows, ROWS.length), status });
        nTex.needsUpdate = true;
        lastNote = key;
      }
      card.visible = turn > 0.001;
      card.rotation.y = lerp(-Math.PI / 2, 0, turn) + 0.12 * Math.sin(p * 4) * (1 - sstep(0.8, 0.9, p));
      card.position.z = lerp(-0.6, 0, turn);
      card.scale.setScalar(lerp(0.85, 1, turn));

      // Rim: amber while a flag is open, teal while editing, green once approved.
      const approved = sstep(0.88, 0.92, p);
      rimMat.color.set(p >= 0.9 ? COLORS.green : p >= 0.78 ? COLORS.teal : COLORS.amber);
      rimMat.opacity = (0.16 + 0.1 * Math.sin(t * 1.5) * (1 - approved) + 0.2 * approved) * turn;

      // ── Approve: the seal drops and stamps.
      const drop = sstep(0.86, 0.9, p);
      seal.visible = drop > 0.001;
      seal.position.z = lerp(2.2, 0.08, drop);
      seal.scale.setScalar(lerp(2.2, 1, drop));
      seal.rotation.z = lerp(-0.8, 0, drop);
      sealMat.opacity = drop;
      const pk = clamp01((p - 0.9) / 0.06);
      pulse.scale.setScalar(0.4 + pk * 1.4);
      (pulse.material as THREE.MeshBasicMaterial).opacity = p > 0.9 ? (1 - pk) * 0.8 : 0;

      // ── Camera: close on the mic, then across to the note.
      const toCard = sstep(0.3, 0.62, p);
      camera.position.set(lerp(0.4, 2.0, toCard), lerp(0.6, 0.2, toCard), lerp(9.4, 8.6, toCard) - 0.5 * sstep(0.84, 0.95, p));
      look.set(lerp(0.9, 2.4, toCard), 0, 0);
      camera.lookAt(look);
      halo.position.x = lerp(0.2, 2.8, toCard);
    },
    dispose() {
      disposeDeep(root);
      glow.dispose();
    },
  };
}

export default function ScribeScene({ bus, onReady }: StorySceneProps) {
  return (
    <StoryCanvas onReady={onReady} camera={{ position: [0.4, 0.6, 9.4], fov: 36 }}>
      <FrameOffset x={0.1} />
      <StudioLights dark />
      <Imperative bus={bus} build={build} />
    </StoryCanvas>
  );
}
