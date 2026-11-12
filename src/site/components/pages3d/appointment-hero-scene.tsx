"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { capDpr } from "../story/webgl";
import { COLORS, NarrowFit, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont } from "./scene-kit";
import { canvas2d, pill, texOf, tileGeometry, type Tone } from "./scene-ui";

/**
 * Appointment management hero: one availability check in front of the diary.
 * A dark glass diary of raised 3D tiles shows two doctors' real hours — a leave block,
 * a lunch break, booked and free slots. Requests arrive from the front desk and from WhatsApp, pass
 * through the FlexicaAI check, and only then drop into a free slot. One WhatsApp request
 * asks for a time the doctor is on leave: the check turns amber, the next free slot is
 * offered instead, and that is where it lands. Loops every CYCLE seconds. Sample data.
 */

const CYCLE = 12.6;

// ── The diary board texture layout (in texture pixels, drawn at 2×).
const TW = 1408;
const TH = 992;
const BW = 4.4; // board width in world units
const BH = (BW * TH) / TW;
const COL_X = (c: number) => 200 + c * 596;
const COL_W = 580;
const ROW_Y = (r: number) => 240 + r * 122;
const ROW_H = 122;
const TIMES = ["9:00", "10:00", "11:00", "12:00", "1:00", "2:00"];
const DOCTORS = ["Dr. Sana Malik", "Dr. Omar Rafiq"];
const HOURS = ["9:00 – 3:00", "11:00 – 3:00 today"];

type Cell =
  | { kind: "booked"; name: string; sub: string }
  | { kind: "free" }
  | { kind: "leave"; rows: number }
  | { kind: "break" }
  | { kind: "skip" };

// [doctor][row]
const DIARY: Cell[][] = [
  [
    { kind: "booked", name: "Hamza A.", sub: "Check-up" },
    { kind: "free" },
    { kind: "booked", name: "Sara N.", sub: "Review" },
    { kind: "free" },
    { kind: "break" },
    { kind: "free" },
  ],
  [
    { kind: "leave", rows: 2 },
    { kind: "skip" },
    { kind: "free" },
    { kind: "booked", name: "Usman T.", sub: "Dressing" },
    { kind: "break" },
    { kind: "free" },
  ],
];

type Source = "desk" | "wa";
type Req = {
  src: Source;
  start: number;
  ask: string;
  /** Text shown when the requested time is not available (the check fails first). */
  fail?: string;
  ok: string;
  col: number;
  row: number;
  name: string;
  sub: string;
  reply?: string;
};

const REQS: Req[] = [
  { src: "desk", start: 0.3, ask: "10:00 with Dr. Sana", ok: "Free · inside working hours", col: 0, row: 1, name: "Ayesha K.", sub: "Follow-up" },
  {
    src: "wa",
    start: 3.8,
    ask: "10am with Dr. Omar?",
    fail: "Dr. Omar is on leave till 11:00",
    ok: "Next free slot: 11:00",
    col: 1,
    row: 2,
    name: "Bilal R.",
    sub: "via WhatsApp",
    reply: "Booked for 11:00 ✓✓",
  },
  { src: "desk", start: 8.0, ask: "12:00 with Dr. Sana", ok: "Free · inside working hours", col: 0, row: 3, name: "Zainab M.", sub: "New patient" },
];

// Per-request timings, relative to its start.
const T_FLY_A = [0.35, 1.3];
const T_CHECK = 1.3;
const STEP = 0.75;
const T_DROP = 0.85;
const timing = (r: Req) => {
  const verdict = r.start + T_CHECK + 0.6;
  const okAt = r.fail ? verdict + STEP + 0.15 : verdict;
  const dropFrom = okAt + 0.4;
  return { verdict, okAt, dropFrom, land: dropFrom + T_DROP };
};

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const pulse = (t: number, a: number, b: number) => win(t, a, a + 0.25) * (1 - win(t, b - 0.25, b));

// ── Textures

/** The board's printed layer: date, doctors and times, on a transparent sheet. */
function boardTexture() {
  const { c, g } = canvas2d(TW, TH);
  const font = siteFont();
  g.textBaseline = "middle";
  g.fillStyle = "#ffffff";
  g.font = `700 46px ${font}`;
  g.fillText("Thursday, 14 Nov", 48, 82);
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.fillRect(40, 140, TW - 80, 2);

  DOCTORS.forEach((d, i) => {
    const x = COL_X(i);
    const grd = g.createLinearGradient(x, 166, x + 60, 214);
    grd.addColorStop(0, i === 0 ? COLORS.tealGlow : "#7dd3fc");
    grd.addColorStop(1, i === 0 ? COLORS.teal : "#2563eb");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x + 30, 190, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#04152e";
    g.font = `800 22px ${font}`;
    g.textAlign = "center";
    g.fillText(d.split(" ")[1][0] + d.split(" ")[2][0], x + 30, 191);
    g.textAlign = "left";
    g.fillStyle = "#ffffff";
    g.font = `700 32px ${font}`;
    g.fillText(d, x + 72, 176);
    g.fillStyle = "#94a3b8";
    g.font = `500 23px ${font}`;
    g.fillText(HOURS[i], x + 72, 210);
  });

  TIMES.forEach((tm, r) => {
    const y = ROW_Y(r);
    g.fillStyle = "rgba(255,255,255,0.05)";
    g.fillRect(40, y, TW - 80, 2);
    g.fillStyle = "#94a3b8";
    g.font = `600 30px ${font}`;
    g.fillText(tm, 52, y + ROW_H / 2);
  });
  return texOf(c);
}

type TileStyle = "booked" | "free" | "leave" | "break" | "new";
const TILE_TEX_W = 600;
const TILE_TEX_H = 112;
const TILE_D = 0.07;

/** The words printed on a tile. Transparent background: the tile itself is 3D. */
function tileText(style: TileStyle, title: string, sub = "", wa = false) {
  const h = TILE_TEX_H;
  const { c, g } = canvas2d(TILE_TEX_W, h);
  const font = siteFont();
  const cy = h / 2;
  g.textBaseline = "middle";
  const colors: Record<TileStyle, [string, string]> = {
    booked: ["#ffffff", "#9fb3c8"],
    free: ["rgba(95,224,228,0.85)", "#64748b"],
    leave: ["#fcd34d", "#fbbf24"],
    break: ["#94a3b8", "#64748b"],
    new: ["#04152e", "#0b3d4a"],
  };
  const [fg, sg] = colors[style];
  const accent = style === "booked" || style === "new";
  if (accent) {
    g.fillStyle = style === "new" ? "#04152e" : COLORS.tealGlow;
    g.beginPath();
    g.roundRect(22, cy - 26, 7, 52, 4);
    g.fill();
  }
  const x = accent ? 48 : 30;
  if (sub) {
    g.fillStyle = fg;
    g.font = `700 36px ${font}`;
    g.fillText(title, x, cy - 17);
    if (wa) {
      g.fillStyle = "#15803d";
      g.beginPath();
      g.arc(x + 9, cy + 21, 8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = sg;
    g.font = `600 26px ${font}`;
    g.fillText(sub, wa ? x + 26 : x, cy + 21);
  } else {
    g.fillStyle = fg;
    g.font = `${style === "free" ? 600 : 700} 32px ${font}`;
    g.fillText(title, x, cy + 1);
  }
  if (style === "new") {
    // The confirmed tick.
    const tx = TILE_TEX_W - 52;
    g.fillStyle = "#04152e";
    g.beginPath();
    g.arc(tx, cy, 24, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = COLORS.tealGlow;
    g.lineWidth = 6;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(tx - 11, cy + 1);
    g.lineTo(tx - 3, cy + 9);
    g.lineTo(tx + 11, cy - 8);
    g.stroke();
  }
  return texOf(c);
}

// ── The scene

type Api = { update: (time: number, px: number, py: number) => void; dispose: () => void };

const GATE = new THREE.Vector3(0, 1.62, 0.45);
const SRC: Record<Source, THREE.Vector3> = {
  desk: new THREE.Vector3(-2.2, 1.9, 0),
  wa: new THREE.Vector3(2.2, 1.9, 0),
};

/** Texture pixel → board-local position. */
const boardPos = (px: number, py: number, z = 0) => new THREE.Vector3((px / TW - 0.5) * BW, (0.5 - py / TH) * BH, z);
const cellCenter = (col: number, row: number) => boardPos(COL_X(col) + COL_W / 2, ROW_Y(row) + ROW_H / 2, 0.012);

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = root) => (parent.add(o), o);
  const spriteMat = (map: THREE.Texture, opacity = 1, additive = false) =>
    new THREE.SpriteMaterial({
      map,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
  const glowSprite = (color: string, size: number, opacity = 1) => {
    const s = new THREE.Sprite(spriteMat(glow, opacity, true));
    s.material.color.set(color);
    s.scale.set(size, size, 1);
    return s;
  };
  const label = (text: string, tone: Tone, h: number, weight = 700) => {
    const p = pill(text, tone, weight);
    const s = new THREE.Sprite(spriteMat(p.tex, 0));
    s.scale.set(h * p.aspect, h, 1);
    s.renderOrder = 5;
    return s;
  };

  // ── The diary: a dark glass slab, tilted back like a desk diary, with raised tiles.
  const board = add(new THREE.Group());
  board.position.set(0, -0.62, -0.2);
  board.rotation.x = -0.36;
  const slabGeo = new THREE.BoxGeometry(BW + 0.2, BH + 0.2, 0.1);
  const slab = add(
    new THREE.Mesh(
      slabGeo,
      new THREE.MeshStandardMaterial({ color: "#0a2547", metalness: 0.2, roughness: 0.6, transparent: true, opacity: 0.95 }),
    ),
    board,
  );
  slab.position.z = -0.06;
  const slabEdges = add(
    new THREE.LineSegments(new THREE.EdgesGeometry(slabGeo), new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.7, toneMapped: false })),
    board,
  );
  slabEdges.position.z = -0.06;
  // A soft teal sheen across the top of the slab.
  const sheen = add(glowSprite(COLORS.teal, 1, 0.18), board);
  sheen.position.set(0, BH * 0.32, 0.01);
  sheen.scale.set(BW * 1.1, BH * 0.7, 1);
  add(new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: boardTexture(), transparent: true, toneMapped: false, depthWrite: false })), board);

  const cellW = BW * ((COL_W - 14) / TW);
  const cellH = BH * ((ROW_H - 20) / TH);
  const rowGap = BH * (20 / TH);
  const STYLE_MAT = {
    booked: () => new THREE.MeshStandardMaterial({ color: "#123f70", metalness: 0.35, roughness: 0.35, emissive: "#0b2a55", emissiveIntensity: 0.4, transparent: true }),
    free: () => new THREE.MeshStandardMaterial({ color: "#0f3a63", metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.38 }),
    leave: () => new THREE.MeshStandardMaterial({ color: "#3a2a10", metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.85, emissive: "#f59e0b", emissiveIntensity: 0.18 }),
    break: () => new THREE.MeshStandardMaterial({ color: "#1b2c44", metalness: 0.1, roughness: 0.7, transparent: true, opacity: 0.75 }),
  };
  /** A tile — 3D body plus its printed words — centred on board-local `at`. */
  const makeTile = (style: TileStyle, at: THREE.Vector3, rows: number, words: THREE.Texture, mat: THREE.MeshStandardMaterial) => {
    const h = cellH * rows + (rows - 1) * rowGap;
    const grp = add(new THREE.Group(), board);
    grp.position.copy(at).setZ(0);
    const geo = tileGeometry(cellW, h);
    add(new THREE.Mesh(geo, mat), grp);
    const wordMat = new THREE.MeshBasicMaterial({ map: words, transparent: true, toneMapped: false, depthWrite: false });
    const face = add(new THREE.Mesh(new THREE.PlaneGeometry(cellW, cellW * (TILE_TEX_H / TILE_TEX_W)), wordMat), grp);
    face.position.z = TILE_D + 0.016;
    let edgeMat: THREE.LineBasicMaterial | null = null;
    if (style === "free") {
      edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.45, toneMapped: false });
      add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat), grp);
    }
    return { grp, mat, wordMat, edgeMat };
  };
  const freeTiles = new Map<string, ReturnType<typeof makeTile>>();
  DIARY.forEach((col, ci) =>
    col.forEach((cell, ri) => {
      if (cell.kind === "skip") return;
      const rows = cell.kind === "leave" ? cell.rows : 1;
      const at = cellCenter(ci, ri);
      if (rows > 1) at.y -= ((rows - 1) * BH * (ROW_H / TH)) / 2;
      const words =
        cell.kind === "booked"
          ? tileText("booked", cell.name, cell.sub)
          : cell.kind === "free"
            ? tileText("free", "Free")
            : cell.kind === "leave"
              ? tileText("leave", "On leave", "Back at 11:00")
              : tileText("break", "Lunch break");
      const tile = makeTile(cell.kind, at, rows, words, STYLE_MAT[cell.kind]());
      if (cell.kind === "free") freeTiles.set(`${ci}-${ri}`, tile);
    }),
  );

  const BASE_BOOKED = DIARY.flat().filter((c) => c.kind === "booked").length;
  const counts = Array.from({ length: REQS.length + 1 }, (_, i) => pill(`${BASE_BOOKED + i} booked · no clashes`, "teal", 600));
  const counterMat = spriteMat(counts[0].tex, 1);
  const counter = add(new THREE.Sprite(counterMat), board);
  const COUNTER_H = 0.24;
  counter.scale.set(COUNTER_H * counts[0].aspect, COUNTER_H, 1);
  counter.position.copy(boardPos(TW - 48, 82, 0.08));
  counter.center.set(1, 0.5);
  counter.renderOrder = 10;
  counterMat.depthTest = false;
  const underGlow = add(glowSprite(COLORS.teal, 1, 0.4));
  underGlow.position.set(0, -1.2, -1.2);
  underGlow.scale.set(7, 2.8, 1);

  // ── The availability check: a ring with the mark inside.
  const gate = add(new THREE.Group());
  gate.position.copy(GATE);
  const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false, transparent: true, opacity: 0.95 });
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.028, 16, 96), ringMat), gate);
  const ring2Mat = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false, transparent: true, opacity: 0.35 });
  const ring2 = add(new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.01, 8, 96), ring2Mat), gate);
  const disc = add(
    new THREE.Mesh(new THREE.CircleGeometry(0.42, 64), new THREE.MeshBasicMaterial({ color: "#082957", transparent: true, opacity: 0.92, toneMapped: false })),
    gate,
  );
  disc.position.z = -0.01;
  const gateGlow = add(glowSprite(COLORS.tealGlow, 1.9, 0.4), gate);
  gateGlow.position.z = -0.05;
  const markMat = spriteMat(glow, 0);
  const mark = add(new THREE.Sprite(markMat), gate);
  mark.scale.set(0.52, 0.52, 1);
  mark.position.z = 0.02;
  loadLogoMark((t) => {
    markMat.map = t;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
  });
  // Its name sits under the ring (never at the frame's top edge), and steps aside
  // while a verdict is showing in the same place.
  const gateTitle = add(label("Availability check", "teal", 0.22, 600));
  gateTitle.position.set(GATE.x, GATE.y - 0.66, GATE.z + 0.2);

  // ── The two ways in.
  const desk = add(label("Front desk", "desk", 0.34));
  desk.position.copy(SRC.desk);
  const wa = add(label("WhatsApp", "wa", 0.34));
  wa.position.copy(SRC.wa);
  for (const s of [desk, wa]) (s.material as THREE.SpriteMaterial).opacity = 1;

  // ── Each request: its ask, the verdicts, a travelling token and the booked block.
  const tealCol = new THREE.Color(COLORS.tealGlow);
  const okCol = new THREE.Color("#4ade80");
  const warnCol = new THREE.Color("#fbbf24");
  const reqs = REQS.map((r) => {
    const ask = add(label(r.ask, r.src === "wa" ? "waBubble" : "bubble", 0.27, 600));
    ask.position.copy(SRC[r.src]).add(new THREE.Vector3(r.src === "wa" ? -0.1 : 0.1, -0.46, 0.1));
    const checking = add(label("Checking hours, leave & slots…", "teal", 0.24, 600));
    const fail = r.fail ? add(label(r.fail, "warn", 0.24, 600)) : null;
    const ok = add(label(r.ok, "ok", 0.24, 600));
    for (const s of [checking, fail, ok]) s?.position.set(GATE.x, GATE.y - 0.66, GATE.z + 0.25);
    const reply = r.reply ? add(label(r.reply, "waBubble", 0.27, 600)) : null;
    reply?.position.copy(ask.position);
    const newMat = new THREE.MeshStandardMaterial({
      color: COLORS.tealGlow,
      emissive: COLORS.teal,
      emissiveIntensity: 0.55,
      metalness: 0.2,
      roughness: 0.3,
      transparent: true,
      opacity: 0,
    });
    const tile = makeTile("new", cellCenter(r.col, r.row), 1, tileText("new", r.name, r.sub, r.src === "wa"), newMat);
    tile.wordMat.opacity = 0;
    const block = tile.grp;
    const free = freeTiles.get(`${r.col}-${r.row}`);
    const flash = add(glowSprite(COLORS.tealGlow, 1, 0), board);
    flash.position.copy(block.position).setZ(0.2);
    flash.scale.set(2.6, 1, 1);
    const token = add(glowSprite(COLORS.tealGlow, 0.42, 0));
    const core = add(glowSprite("#ffffff", 0.14, 0));
    const trail = Array.from({ length: 7 }, (_, k) => add(glowSprite(COLORS.tealGlow, 0.3 * (1 - k / 8), 0)));
    return { r, tm: timing(r), ask, checking, fail, ok, reply, block, tile, free, flash, token, core, trail };
  });

  // Drifting dust.
  const dust = Array.from({ length: 26 }, (_, i) => {
    const s = add(glowSprite(COLORS.tealGlow, 0.07 + (i % 3) * 0.03, 0.5));
    return { s, x: ((i * 0.618) % 1) * 7 - 3.5, y: ((i * 0.371) % 1) * 4.6 - 2.2, z: ((i * 0.53) % 1) * 2 - 1.5, sp: 0.08 + (i % 5) * 0.02 };
  });

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ctrl = new THREE.Vector3();
  const slot = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const bez = (p0: THREE.Vector3, c: THREE.Vector3, p1: THREE.Vector3, u: number, out: THREE.Vector3) => {
    const v = 1 - u;
    return out.set(
      v * v * p0.x + 2 * v * u * c.x + u * u * p1.x,
      v * v * p0.y + 2 * v * u * c.y + u * u * p1.y,
      v * v * p0.z + 2 * v * u * c.z + u * u * p1.z,
    );
  };
  /** Where request `q`'s token is at cycle time `t`, or null when it is not travelling. */
  const tokenAt = (q: (typeof reqs)[number], t: number, out: THREE.Vector3) => {
    const s = q.r.start;
    if (t >= s + T_FLY_A[0] && t <= s + T_FLY_A[1]) {
      const u = ease(win(t, s + T_FLY_A[0], s + T_FLY_A[1]));
      a.copy(SRC[q.r.src]);
      ctrl.set(a.x * 0.45, a.y + 0.75, 0.6);
      return bez(a, ctrl, GATE, u, out);
    }
    if (t > s + T_FLY_A[1] && t < q.tm.dropFrom) return out.copy(GATE).setZ(GATE.z + 0.1);
    if (t >= q.tm.dropFrom && t <= q.tm.land) {
      const u = win(t, q.tm.dropFrom, q.tm.land);
      const k = u * u * (3 - 2 * u);
      slot.copy(q.block.position);
      board.localToWorld(slot);
      ctrl.set(lerp(GATE.x, slot.x, 0.6), GATE.y + 0.1, slot.z + 1.2);
      return bez(GATE, ctrl, slot, k, out);
    }
    return null;
  };

  return {
    update(time, px, py) {
      const t = time % CYCLE;
      const fadeAll = 1 - win(t, CYCLE - 1.1, CYCLE - 0.3);
      board.updateMatrixWorld();

      let checkingNow = 0;
      let okNow = 0;
      let warnNow = 0;
      for (const q of reqs) {
        const { r, tm } = q;
        // The ask appears by its source, then fades as the token leaves.
        (q.ask.material as THREE.SpriteMaterial).opacity = pulse(t, r.start, r.start + 1.9);
        q.ask.position.y = SRC[r.src].y - 0.46 - 0.05 * ease(win(t, r.start, r.start + 0.4));
        // Verdicts under the ring.
        const chk = pulse(t, r.start + T_CHECK - 0.05, tm.verdict + 0.05);
        (q.checking.material as THREE.SpriteMaterial).opacity = chk;
        checkingNow = Math.max(checkingNow, chk);
        if (q.fail) {
          const f = pulse(t, tm.verdict, tm.okAt);
          (q.fail.material as THREE.SpriteMaterial).opacity = f;
          q.fail.position.x = GATE.x + Math.sin(time * 40) * 0.02 * win(t, tm.verdict, tm.verdict + 0.15) * (1 - win(t, tm.verdict + 0.35, tm.verdict + 0.5));
          warnNow = Math.max(warnNow, f);
        }
        const o = pulse(t, tm.okAt, tm.land + 0.2);
        (q.ok.material as THREE.SpriteMaterial).opacity = o;
        q.ok.scale.y = 0.24 * (0.92 + 0.08 * ease(win(t, tm.okAt, tm.okAt + 0.3)));
        okNow = Math.max(okNow, o);
        if (q.reply) (q.reply.material as THREE.SpriteMaterial).opacity = win(t, tm.land, tm.land + 0.4) * (1 - win(t, tm.land + 2.6, tm.land + 3.1));

        // The token and its trail.
        const p = tokenAt(q, t, tmp);
        const tokOn = p ? 1 : 0;
        if (p) {
          q.token.position.copy(p);
          q.core.position.copy(p);
        }
        const tokenCol = t > tm.verdict && t < tm.okAt && r.fail ? warnCol : t >= tm.okAt ? okCol : tealCol;
        q.token.material.color.copy(tokenCol);
        (q.token.material as THREE.SpriteMaterial).opacity = tokOn * (0.85 + 0.15 * Math.sin(time * 12));
        (q.core.material as THREE.SpriteMaterial).opacity = tokOn;
        q.trail.forEach((s, k) => {
          const tp = tokenAt(q, t - (k + 1) * 0.045, b);
          s.material.color.copy(tokenCol);
          if (tp && p) {
            s.position.copy(tp);
            (s.material as THREE.SpriteMaterial).opacity = 0.55 * (1 - k / q.trail.length);
          } else (s.material as THREE.SpriteMaterial).opacity = 0;
        });

        // The booking lands in its slot.
        const landed = win(t, tm.land - 0.05, tm.land + 0.35) * fadeAll;
        q.tile.mat.opacity = landed;
        q.tile.wordMat.opacity = landed;
        q.block.scale.setScalar(0.88 + 0.12 * ease(landed));
        q.block.position.z = 0.5 * (1 - ease(win(t, tm.land - 0.05, tm.land + 0.5)));
        if (q.free) {
          const keep = 1 - landed;
          q.free.mat.opacity = 0.38 * keep;
          q.free.wordMat.opacity = keep;
          if (q.free.edgeMat) q.free.edgeMat.opacity = 0.45 * keep;
        }
        (q.flash.material as THREE.SpriteMaterial).opacity = 0.9 * pulse(t, tm.land - 0.05, tm.land + 0.9) * fadeAll;
      }

      const landedCount = fadeAll < 1 ? 0 : reqs.filter((q) => t >= q.tm.land + 0.1).length;
      if (counterMat.map !== counts[landedCount].tex) {
        counterMat.map = counts[landedCount].tex;
        counterMat.needsUpdate = true;
      }
      const bump = 1 + 0.1 * Math.max(0, ...reqs.map((q) => pulse(t, q.tm.land, q.tm.land + 0.6)));
      counter.scale.set(COUNTER_H * counts[landedCount].aspect * bump, COUNTER_H * bump, 1);

      // The ring: teal while checking, amber when the asked time is unavailable, green when it fits.
      ring.rotation.z = time * 0.6;
      ring2.rotation.z = -time * 0.35;
      const col = tmp.set(tealCol.r, tealCol.g, tealCol.b);
      ringMat.color.setRGB(col.x, col.y, col.z).lerp(warnCol, warnNow).lerp(okCol, okNow * (1 - warnNow));
      ring2Mat.color.copy(ringMat.color);
      gateGlow.material.color.copy(ringMat.color);
      const busy = Math.max(checkingNow, okNow, warnNow);
      (gateTitle.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - Math.min(1, busy * 1.6));
      (gateGlow.material as THREE.SpriteMaterial).opacity = 0.32 + 0.4 * busy * (0.8 + 0.2 * Math.sin(time * 9));
      const s2 = 1 + 0.12 * checkingNow * (0.5 + 0.5 * Math.sin(time * 10));
      ring2.scale.setScalar(s2);
      gate.position.y = GATE.y + Math.sin(time * 1.1) * 0.04;

      // Sources breathe when they send.
      for (const [s, src] of [
        [desk, "desk"],
        [wa, "wa"],
      ] as const) {
        const sending = Math.max(0, ...reqs.filter((q) => q.r.src === src).map((q) => pulse(t, q.r.start, q.r.start + 0.8)));
        s.scale.setScalar(1);
        const base = (s.material as THREE.SpriteMaterial).map!.image as HTMLCanvasElement;
        s.scale.set((0.34 * base.width) / base.height * (1 + 0.06 * sending), 0.34 * (1 + 0.06 * sending), 1);
      }

      for (const d of dust) {
        d.s.position.set(d.x + Math.sin(time * d.sp * 3 + d.y) * 0.15, ((d.y + time * d.sp + 2.3) % 4.6) - 2.3, d.z);
      }

      // Pointer parallax.
      root.rotation.y = lerp(root.rotation.y, px * 0.14, 0.05);
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

export default function AppointmentHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.25, 2])}
      camera={{ position: [0, 0.4, 7.8], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} />
      <Scene onReady={onReady} />
      <NarrowFit span={1.18} />
    </Canvas>
  );
}
