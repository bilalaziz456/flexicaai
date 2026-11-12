"use client";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BOOKING_CHAT } from "../mockups/chat";
import { SAMPLE } from "../mockups/frame";
import {
  COLORS,
  FrameOffset,
  Imperative,
  StoryCanvas,
  StudioLights,
  disposeDeep,
  glowTexture,
  lerp,
  loadLogoMark,
  sstep,
  siteFont,
  window01,
  type Built,
} from "./scene-kit";
import type { StorySceneProps } from "./story-stage";

/**
 * "From message to diary": a WhatsApp booking request leaves the patient's phone,
 * passes the three checks (working hours, daily limit, leave), is acknowledged with a
 * token number, and lands in the doctor's week as a confirmed appointment — then the
 * reminder goes back to the phone. Sample people and times throughout.
 */

const WA_GREEN = "#d9fdd3";
const WA_BG = "#efeae2";

// Layout (world units)
const PHONE = new THREE.Vector3(-1.0, 0.05, 0.4);
const GATE = new THREE.Vector3(0.85, 1.5, 0.3);
const BOARD = new THREE.Vector3(3.2, -1.05, -0.2);
const BOARD_SCALE = 0.9;

// Week board geometry
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMES = ["09:00", "10:00", "11:00", "12:00", "13:00"];
const BW = 3.6;
const BH = 2.7;
const COL0 = -BW / 2 + 0.52; // first day column centre (x, board-local)
const COLW = (BW - 0.72) / DAYS.length;
const ROW0 = BH / 2 - 0.74; // first time row centre (y, board-local)
const ROWH = (BH - 0.96) / TIMES.length;
const slotPos = (day: number, hour: number) => [COL0 + day * COLW, ROW0 - hour * ROWH] as const;

// ─── Canvas helpers ──────────────────────────────────────────────────────────

type Bubble = { mine: boolean; text: string; time: string };

function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function makeTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, siteFont());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Double blue ticks, WhatsApp style. */
function ticks(g: CanvasRenderingContext2D, x: number, y: number, s = 1) {
  g.save();
  g.strokeStyle = "#53bdeb";
  g.lineWidth = 3 * s;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const dx of [0, 9 * s]) {
    g.beginPath();
    g.moveTo(x + dx, y);
    g.lineTo(x + dx + 6 * s, y + 6 * s);
    g.lineTo(x + dx + 17 * s, y - 6 * s);
    g.stroke();
  }
  g.restore();
}

/** A WhatsApp-style bubble with a tail. */
function bubblePath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, mine: boolean, r = 18) {
  g.beginPath();
  g.roundRect(x, y, w, h, [mine ? r : 4, mine ? 4 : r, r, r]);
  if (mine) {
    g.moveTo(x + w - 2, y);
    g.lineTo(x + w + 14, y);
    g.lineTo(x + w - 2, y + 18);
  } else {
    g.moveTo(x + 2, y);
    g.lineTo(x - 14, y);
    g.lineTo(x + 2, y + 18);
  }
}

// ─── Phone screen ────────────────────────────────────────────────────────────

const SCREEN_W = 600;
const SCREEN_H = 1260;

function drawScreen(g: CanvasRenderingContext2D, bubbles: Bubble[]) {
  const W = SCREEN_W;
  const H = SCREEN_H;
  const font = siteFont();
  g.clearRect(0, 0, W, H);
  g.save();
  g.beginPath();
  g.roundRect(0, 0, W, H, 70);
  g.clip();

  // Wallpaper with a faint doodle grid.
  g.fillStyle = WA_BG;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(120,100,80,0.07)";
  for (let y = 260; y < H; y += 46)
    for (let x = (y / 46) % 2 ? 20 : 43; x < W; x += 46) {
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }

  // Status bar + header (WhatsApp green).
  g.fillStyle = "#008069";
  g.fillRect(0, 0, W, 210);
  g.fillStyle = "#ffffff";
  g.font = `600 26px ${font}`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText("10:06", 58, 48);
  g.textAlign = "right";
  g.fillText("4G", W - 58, 48);
  g.textAlign = "left";
  // back arrow
  g.strokeStyle = "#ffffff";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(52, 156);
  g.lineTo(36, 140);
  g.lineTo(52, 124);
  g.stroke();
  g.fillStyle = COLORS.navy;
  g.beginPath();
  g.arc(108, 140, 38, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = COLORS.tealGlow;
  g.font = `700 26px ${font}`;
  g.textAlign = "center";
  g.fillText("CC", 108, 141);
  g.textAlign = "left";
  g.fillStyle = "#ffffff";
  g.font = `650 31px ${font}`;
  g.fillText(SAMPLE.clinic, 162, 124);
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.font = `400 22px ${font}`;
  g.fillText("Business account · online", 162, 160);

  // Date chip
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath();
  g.roundRect(W / 2 - 56, 236, 112, 38, 12);
  g.fill();
  g.fillStyle = "#54656f";
  g.font = `600 19px ${font}`;
  g.textAlign = "center";
  g.fillText("TODAY", W / 2, 256);

  // Bubbles, stacked from the bottom.
  g.font = `400 28px ${font}`;
  const maxW = W * 0.74;
  const laid = bubbles.map((b) => {
    const lines = wrap(g, b.text, maxW - 44);
    const w = Math.min(maxW, Math.max(140, ...lines.map((l) => g.measureText(l).width + 44)));
    return { b, lines, w, h: lines.length * 37 + 60 };
  });
  let y = H - 130;
  for (let i = laid.length - 1; i >= 0; i--) {
    const { b, lines, w, h } = laid[i];
    y -= h + 18;
    if (y < 290) break;
    const x = b.mine ? W - w - 34 : 34;
    g.shadowColor = "rgba(11,20,26,0.13)";
    g.shadowBlur = 3;
    g.shadowOffsetY = 1.5;
    g.fillStyle = b.mine ? WA_GREEN : "#ffffff";
    bubblePath(g, x, y, w, h, b.mine);
    g.fill();
    g.shadowColor = "transparent";
    g.fillStyle = "#111b21";
    g.font = `400 28px ${font}`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    lines.forEach((l, k) => g.fillText(l, x + 22, y + 40 + k * 37));
    g.fillStyle = "#667781";
    g.font = `400 19px ${font}`;
    g.textAlign = "right";
    g.fillText(b.time, x + w - (b.mine ? 46 : 18), y + h - 14);
    if (b.mine) ticks(g, x + w - 40, y + h - 20, 0.9);
    g.textBaseline = "middle";
  }

  // Composer
  g.fillStyle = "#ffffff";
  g.shadowColor = "rgba(11,20,26,0.1)";
  g.shadowBlur = 4;
  g.beginPath();
  g.roundRect(22, H - 104, W - 128, 70, 35);
  g.fill();
  g.shadowColor = "transparent";
  g.fillStyle = "#8696a0";
  g.font = `400 25px ${font}`;
  g.textAlign = "left";
  g.fillText("Message", 62, H - 68);
  g.fillStyle = "#00a884";
  g.beginPath();
  g.arc(W - 62, H - 69, 36, 0, Math.PI * 2);
  g.fill();
  // mic
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.roundRect(W - 69, H - 90, 14, 26, 7);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(W - 62, H - 72, 12, 0.15 * Math.PI, 0.85 * Math.PI);
  g.moveTo(W - 62, H - 60);
  g.lineTo(W - 62, H - 53);
  g.stroke();
  g.restore();
}

const ASK = BOOKING_CHAT[2]; // "Dr. Sana, tomorrow please"
const ACK = BOOKING_CHAT[5]; // booking request received, token #7
const CONFIRMED = BOOKING_CHAT[6]; // confirmed, reminder promised

/** What the phone shows at each stage of the story. */
const SCREENS: Bubble[][] = [
  [
    { mine: true, text: BOOKING_CHAT[0].text, time: BOOKING_CHAT[0].time },
    { mine: false, text: BOOKING_CHAT[1].text, time: BOOKING_CHAT[1].time },
  ],
  [
    { mine: true, text: BOOKING_CHAT[0].text, time: BOOKING_CHAT[0].time },
    { mine: false, text: BOOKING_CHAT[1].text, time: BOOKING_CHAT[1].time },
    { mine: true, text: ASK.text, time: ASK.time },
  ],
  [
    { mine: false, text: BOOKING_CHAT[1].text, time: BOOKING_CHAT[1].time },
    { mine: true, text: ASK.text, time: ASK.time },
    { mine: false, text: ACK.text, time: ACK.time },
  ],
  [
    { mine: true, text: ASK.text, time: ASK.time },
    { mine: false, text: ACK.text, time: ACK.time },
    { mine: false, text: CONFIRMED.text, time: CONFIRMED.time },
  ],
];

// ─── Flying bubbles ──────────────────────────────────────────────────────────

function flyBubble(title: string, sub: string | null, mine: boolean, time: string) {
  const W = 680;
  const H = sub ? 200 : 150;
  return makeTex(W, H, (g, font) => {
    g.shadowColor = "rgba(8,41,87,0.25)";
    g.shadowBlur = 14;
    g.shadowOffsetY = 4;
    g.fillStyle = mine ? WA_GREEN : "#ffffff";
    bubblePath(g, 24, 14, W - 48, H - 34, mine, 30);
    g.fill();
    g.shadowColor = "transparent";
    g.fillStyle = "#111b21";
    g.textBaseline = "middle";
    g.font = `${sub ? 650 : 500} 40px ${font}`;
    g.fillText(title, 64, sub ? 66 : H / 2 - 4, W - 150);
    if (sub) {
      g.fillStyle = "#008069";
      g.font = `500 32px ${font}`;
      g.fillText(sub, 64, 122, W - 150);
    }
    g.fillStyle = "#667781";
    g.font = `400 24px ${font}`;
    g.textAlign = "right";
    g.fillText(time, W - (mine ? 98 : 56), H - 44);
    if (mine) ticks(g, W - 90, H - 48, 1.2);
  });
}

// ─── Check cards ─────────────────────────────────────────────────────────────

type CheckIcon = "clock" | "gauge" | "calendar";
function drawIcon(g: CanvasRenderingContext2D, icon: CheckIcon, cx: number, cy: number, color: string) {
  g.save();
  g.translate(cx - 18, cy - 18);
  g.scale(1.5, 1.5);
  g.strokeStyle = color;
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.lineJoin = "round";
  const P = (d: string) => g.stroke(new Path2D(d));
  if (icon === "clock") {
    P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z");
    P("M12 7v5l3 2");
  } else if (icon === "gauge") {
    P("M4 16a8 8 0 1 1 16 0");
    P("M12 16l4-5");
    P("M4 19h16");
  } else {
    P("M4 5h16v15H4z");
    P("M4 10h16M8 3v4M16 3v4");
    P("M9 14l6 4M15 14l-6 4");
  }
  g.restore();
}

function checkTexture(title: string, icon: CheckIcon, on: boolean) {
  return makeTex(620, 150, (g, font) => {
    g.fillStyle = on ? "#f0fdfa" : "#ffffff";
    g.beginPath();
    g.roundRect(3, 3, 614, 144, 30);
    g.fill();
    g.strokeStyle = on ? COLORS.teal : "#dbe3ee";
    g.lineWidth = on ? 4 : 3;
    g.stroke();
    g.fillStyle = on ? "rgba(15,180,187,0.15)" : "#f1f5f9";
    g.beginPath();
    g.arc(78, 75, 42, 0, Math.PI * 2);
    g.fill();
    drawIcon(g, icon, 78, 75, on ? "#0b7e83" : "#64748b");
    g.fillStyle = COLORS.navy;
    g.font = `650 38px ${font}`;
    g.textBaseline = "middle";
    g.fillText(title, 140, 77);
    if (on) {
      g.fillStyle = "#16a34a";
      g.beginPath();
      g.roundRect(462, 47, 122, 56, 28);
      g.fill();
      g.fillStyle = "#ffffff";
      g.font = `700 30px ${font}`;
      g.textAlign = "center";
      g.fillText("✓  OK", 523, 77);
    } else {
      g.fillStyle = "#94a3b8";
      g.font = `500 28px ${font}`;
      g.textAlign = "right";
      g.fillText("Checking…", 584, 77);
    }
  });
}

// ─── Diary board ─────────────────────────────────────────────────────────────

const PXU = 500; // canvas px per board unit
const toPx = (x: number, y: number) => [(x + BW / 2) * PXU, (BH / 2 - y) * PXU] as const;
const EXISTING: [number, number, string, string, "teal" | "navy" | "amber"][] = [
  [0, 0, "09:00", "Bilal Ahmed", "navy"],
  [0, 2, "11:00", "Hina Raza", "teal"],
  [1, 1, "10:00", "Usman Tariq", "amber"],
  [2, 0, "09:30", "Sara Ali", "teal"],
  [2, 3, "12:00", "Imran Shah", "navy"],
  [3, 0, "09:00", "Zainab Noor", "navy"],
  [3, 2, "11:30", "Ali Hassan", "teal"],
  [4, 1, "10:00", "Fatima Iqbal", "amber"],
  [4, 3, "12:30", "Ahmed Raza", "teal"],
  [5, 0, "09:00", "Maryam Khan", "navy"],
];
const TINT = {
  teal: { bg: "#e6f8f8", bar: COLORS.teal, fg: "#0b6b70" },
  navy: { bg: "#e8eef7", bar: COLORS.navy, fg: COLORS.navy },
  amber: { bg: "#fef3e2", bar: "#f5a524", fg: "#92400e" },
};

function boardTexture() {
  return makeTex(BW * PXU, BH * PXU, (g, font) => {
    const W = BW * PXU;
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.roundRect(0, 0, W, BH * PXU, 40);
    g.fill();
    // Header
    g.fillStyle = COLORS.teal;
    g.beginPath();
    g.arc(78, 78, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = `700 30px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("SM", 78, 79);
    g.textAlign = "left";
    g.fillStyle = COLORS.navy;
    g.font = `700 44px ${font}`;
    g.fillText(SAMPLE.doctor, 140, 62);
    g.fillStyle = "#64748b";
    g.font = `500 28px ${font}`;
    g.fillText("This week · 11 – 16 Nov", 140, 104);
    g.fillStyle = "#16a34a";
    g.beginPath();
    g.arc(W - 250, 80, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#475569";
    g.font = `500 26px ${font}`;
    g.fillText("Live diary", W - 230, 81);
    g.fillStyle = "#e2e8f0";
    g.fillRect(30, 150, W - 60, 2);

    // Day headers
    const dates = [11, 12, 13, 14, 15, 16];
    DAYS.forEach((d, i) => {
      const [x] = toPx(...slotPos(i, 0));
      const today = d === "Thu";
      if (today) {
        g.fillStyle = COLORS.teal;
        g.beginPath();
        g.roundRect(x - 62, 172, 124, 70, 18);
        g.fill();
      }
      g.textAlign = "center";
      g.fillStyle = today ? "#ffffff" : "#94a3b8";
      g.font = `600 22px ${font}`;
      g.fillText(d.toUpperCase(), x, 194);
      g.fillStyle = today ? "#ffffff" : COLORS.navy;
      g.font = `700 30px ${font}`;
      g.fillText(String(dates[i]), x, 224);
    });
    // Grid + times
    TIMES.forEach((t, j) => {
      const [, y] = toPx(...slotPos(0, j));
      g.fillStyle = "#f1f5f9";
      g.fillRect(150, y - (ROWH * PXU) / 2, W - 180, 2);
      g.fillStyle = "#94a3b8";
      g.font = `500 24px ${font}`;
      g.textAlign = "right";
      g.fillText(t, 128, y);
    });
    const cellW = (COLW - 0.07) * PXU;
    const cellH = (ROWH - 0.08) * PXU;
    // The free slot the new booking will fill (Thu, 10:30).
    {
      const [x, y] = toPx(...slotPos(3, 1));
      g.setLineDash([10, 8]);
      g.strokeStyle = COLORS.teal;
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(x - cellW / 2, y - cellH / 2, cellW, cellH, 14);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#0b7e83";
      g.font = `600 22px ${font}`;
      g.textAlign = "center";
      g.fillText("Free slot", x, y);
    }
    // Existing appointments
    for (const [d, hr, t, name, tint] of EXISTING) {
      const [x, y] = toPx(...slotPos(d, hr));
      const c = TINT[tint];
      g.fillStyle = c.bg;
      g.beginPath();
      g.roundRect(x - cellW / 2, y - cellH / 2, cellW, cellH, 14);
      g.fill();
      g.fillStyle = c.bar;
      g.beginPath();
      g.roundRect(x - cellW / 2, y - cellH / 2, 9, cellH, [14, 0, 0, 14]);
      g.fill();
      g.textAlign = "left";
      g.fillStyle = c.fg;
      g.font = `700 28px ${font}`;
      g.fillText(t, x - cellW / 2 + 22, y - 17);
      g.fillStyle = "#475569";
      g.font = `600 24px ${font}`;
      g.fillText(name, x - cellW / 2 + 22, y + 19, cellW - 30);
    }
  });
}

function apptTexture(confirmed: boolean) {
  return makeTex(320, 200, (g, font) => {
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `750 56px ${font}`;
    g.fillText("10:30", 26, 62);
    g.font = `600 28px ${font}`;
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.fillText("Token #7", 26, 112);
    g.fillStyle = confirmed ? "#ffffff" : "rgba(255,255,255,0.25)";
    g.beginPath();
    g.roundRect(22, 140, confirmed ? 196 : 170, 44, 22);
    g.fill();
    g.fillStyle = confirmed ? "#0b7e83" : "#ffffff";
    g.font = `700 24px ${font}`;
    g.fillText(confirmed ? "✓ Confirmed" : "Requested", 40, 163);
  });
}

// ─── Build ───────────────────────────────────────────────────────────────────

function std(color: string, rough = 0.55, extra: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, ...extra });
}

/** A flat card: a thin body with the texture on its face. */
function card(w: number, h: number, d: number, bodyColor: string, tex: THREE.Texture, r = 0.08) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(w * 0.94, h * 0.8, d, 3, Math.min(r, h / 2 - 0.001, d / 2 - 0.001)),
    std(bodyColor, 0.5, { emissive: bodyColor, emissiveIntensity: 0.45 }),
  );
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  face.position.z = d / 2 + 0.002;
  g.add(body, face);
  return { group: g, body, face };
}

function roundedShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Point on a lifted arc from a to b (no allocation: writes into out). */
function arc(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number, lift: number) {
  out.lerpVectors(a, b, t);
  out.y += Math.sin(Math.PI * t) * lift;
  out.z += Math.sin(Math.PI * t) * 0.6;
  return out;
}

function build(root: THREE.Group): Built {
  const glowTex = glowTexture(COLORS.tealGlow);
  const shadowTex = glowTexture("#082957");

  // ── Phone: rounded titanium frame, glass screen, dynamic island, side buttons.
  const phone = new THREE.Group();
  phone.position.copy(PHONE);
  phone.rotation.set(-0.05, 0.38, 0.04);
  phone.scale.setScalar(0.92);
  const frameGeo = new THREE.ExtrudeGeometry(roundedShape(1.5, 3.12, 0.24), {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 5,
    curveSegments: 16,
  });
  frameGeo.translate(0, 0, -0.08);
  const frame = new THREE.Mesh(
    frameGeo,
    new THREE.MeshPhysicalMaterial({ color: "#2b3445", metalness: 0.75, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }),
  );
  const bezel = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(1.48, 3.1, 0.23), 16), new THREE.MeshBasicMaterial({ color: "#05080d" }));
  bezel.position.z = 0.054;
  const sc = document.createElement("canvas");
  sc.width = SCREEN_W;
  sc.height = SCREEN_H;
  const sg = sc.getContext("2d")!;
  const screenTex = new THREE.CanvasTexture(sc);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 8;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, (1.36 * SCREEN_H) / SCREEN_W),
    new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, toneMapped: false }),
  );
  screen.position.z = 0.056;
  const island = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.22, 4, 12), new THREE.MeshBasicMaterial({ color: "#000000" }));
  island.rotation.z = Math.PI / 2;
  island.position.set(0, 1.33, 0.06);
  const glareTex = makeTex(64, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 64, 256);
    grd.addColorStop(0, "rgba(255,255,255,0.16)");
    grd.addColorStop(0.35, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 256);
  });
  const glare = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 2.86),
    new THREE.MeshBasicMaterial({ map: glareTex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  glare.position.z = 0.058;
  const btnMat = new THREE.MeshPhysicalMaterial({ color: "#3a4558", metalness: 0.8, roughness: 0.3 });
  for (const [y, h, side] of [
    [0.75, 0.32, 1],
    [0.85, 0.18, -1],
    [0.5, 0.3, -1],
  ] as const) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.03, h, 0.06, 2, 0.012), btnMat);
    b.position.set(side * 0.785, y, -0.015);
    phone.add(b);
  }
  phone.add(frame, bezel, screen, glare, island);
  root.add(phone);
  const phoneShadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTex, transparent: true, opacity: 0.22, depthWrite: false }));
  phoneShadow.scale.set(2.4, 0.5, 1);
  phoneShadow.position.set(PHONE.x + 0.15, PHONE.y - 1.75, PHONE.z - 0.4);
  root.add(phoneShadow);
  let screenStage = -1;
  const setScreen = (k: number) => {
    if (k === screenStage) return;
    screenStage = k;
    drawScreen(sg, SCREENS[k]);
    screenTex.needsUpdate = true;
  };
  setScreen(0);

  // ── Flying bubbles (WhatsApp style, with tails and ticks).
  const askTex = flyBubble(ASK.text, null, true, ASK.time);
  const ask = card(1.7, (1.7 * 150) / 680, 0.04, WA_GREEN, askTex, 0.04);
  const ackTex = flyBubble("Booking request received", "Thu, 10:30 am · Your token is #7", false, ACK.time);
  const ack = card(1.8, (1.8 * 200) / 680, 0.04, "#ffffff", ackTex, 0.04);
  const remTex = flyBubble("Confirmed: Thu, 10:30 am", "We'll remind you the day before", false, CONFIRMED.time);
  const rem = card(1.8, (1.8 * 200) / 680, 0.04, "#ffffff", remTex, 0.04);
  root.add(ask.group, ack.group, rem.group);

  // ── Check gate: the FlexicaAI mark in a glowing ring, with three check cards.
  const gate = new THREE.Group();
  gate.position.copy(GATE);
  const ringMat = new THREE.MeshPhysicalMaterial({
    color: COLORS.teal,
    emissive: COLORS.teal,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.3,
    clearcoat: 1,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 20, 96), ringMat);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.46, 64), new THREE.MeshBasicMaterial({ color: COLORS.navy }));
  disc.position.z = -0.01;
  const markMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56), markMat);
  mark.position.z = 0.01;
  loadLogoMark((t) => {
    markMat.map = t;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  glow.scale.setScalar(2.0);
  const sparks = [0, 1, 2].map(() => {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    sp.scale.setScalar(0.22);
    gate.add(sp);
    return sp;
  });
  const gateLabelTex = makeTex(760, 150, (g, font) => {
    g.textBaseline = "middle";
    g.fillStyle = "#0b7e83";
    g.font = `700 30px ${font}`;
    g.letterSpacing = "5px";
    g.fillText("FLEXICAAI CHECKS", 6, 40);
    g.letterSpacing = "0px";
    g.fillStyle = "#64748b";
    g.font = `500 32px ${font}`;
    g.fillText("Before anything is promised", 6, 100);
  });
  const gateLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.375), new THREE.MeshBasicMaterial({ map: gateLabelTex, transparent: true, toneMapped: false }));
  gateLabel.position.set(0.55, 0.86, 0);
  gate.add(glow, disc, ring, mark, gateLabel);
  const CHECKS: [string, CheckIcon][] = [
    ["Working hours", "clock"],
    ["Daily limit", "gauge"],
    ["Leave", "calendar"],
  ];
  const chips = CHECKS.map(([t, icon], i) => {
    const off = checkTexture(t, icon, false);
    const on = checkTexture(t, icon, true);
    const c = card(1.5, 1.5 * (150 / 620), 0.04, "#ffffff", off, 0.05);
    c.group.position.set(1.48, 0.36 - i * 0.42, 0);
    gate.add(c.group);
    return { ...c, off, on, lit: false };
  });
  root.add(gate);

  // ── Week board: a crisp white diary card.
  const board = new THREE.Group();
  board.position.copy(BOARD);
  board.rotation.set(-0.06, -0.3, 0);
  board.scale.setScalar(BOARD_SCALE);
  const slab = new THREE.Mesh(new RoundedBoxGeometry(BW, BH, 0.08, 4, 0.04), std("#ffffff", 0.5, { emissive: "#ffffff", emissiveIntensity: 0.5 }));
  board.add(slab);
  const boardTex = boardTexture();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, toneMapped: false }));
  face.position.z = 0.042;
  board.add(face);
  const boardShadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: shadowTex, transparent: true, opacity: 0.18, depthWrite: false }));
  boardShadow.scale.set(BW * 1.4, BH * 1.3, 1);
  boardShadow.position.set(0.15, -0.2, -0.3);
  board.add(boardShadow);
  root.add(board);

  // The new appointment (Thu 10:30), flies in from the gate.
  const SLOT = slotPos(3, 1);
  const apptPending = apptTexture(false);
  const apptDone = apptTexture(true);
  const apptMat = new THREE.MeshPhysicalMaterial({ color: COLORS.teal, emissive: COLORS.teal, emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 1 });
  const appt = new THREE.Mesh(new RoundedBoxGeometry(COLW - 0.05, ROWH - 0.05, 0.1, 3, 0.04), apptMat);
  const apptFaceMat = new THREE.MeshBasicMaterial({ map: apptPending, transparent: true, toneMapped: false });
  const apptFace = new THREE.Mesh(new THREE.PlaneGeometry(COLW - 0.1, ROWH - 0.1), apptFaceMat);
  apptFace.position.z = 0.052;
  appt.add(apptFace);
  root.add(appt);
  const slotGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  slotGlow.scale.setScalar(1.1);
  slotGlow.position.set(SLOT[0], SLOT[1], 0.2);
  board.add(slotGlow);

  // Scratch
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const slotWorld = new THREE.Vector3();
  const phoneScreen = (out: THREE.Vector3, y: number) => out.set(0.1, y, 0.12).applyMatrix4(phone.matrixWorld);

  const update = (p: number, camera: THREE.PerspectiveCamera) => {
    root.updateMatrixWorld();
    // Camera: phone + gate, then settle a little lower and closer for the diary.
    const toBoard = sstep(0.72, 0.84, p);
    camPos.set(lerp(0.75, 0.95, toBoard), lerp(1.3, 1.05, toBoard), lerp(9.0, 8.9, toBoard));
    look.set(lerp(0.7, 0.85, toBoard), lerp(0.35, 0.1, toBoard), 0);
    camera.position.copy(camPos);
    camera.lookAt(look);

    // Phone breathes a little; screen follows the story.
    phone.rotation.y = 0.38 + 0.05 * Math.sin(p * 9);
    setScreen(p < 0.06 ? 0 : p < 0.66 ? 1 : p < 0.965 ? 2 : 3);

    // Act 1 — the patient's message lifts off the screen (0.06 → 0.22), Act 2 — through the gate (0.25 → 0.45).
    const lift = sstep(0.06, 0.2, p);
    const fly = sstep(0.24, 0.44, p);
    phoneScreen(a, -0.55);
    if (fly <= 0) {
      ask.group.position.copy(a);
      ask.group.position.z += lift * 0.9;
      ask.group.position.y += lift * 0.5;
      ask.group.position.x += lift * 0.35;
    } else {
      b.copy(a);
      b.z += 0.9;
      b.y += 0.5;
      b.x += 0.35;
      tmp.copy(GATE);
      tmp.z += 0.05;
      arc(ask.group.position, b, tmp, fly, 0.5);
    }
    const askScale = lerp(0.6, 1, lift) * lerp(1, 0.55, fly) * (1 - sstep(0.5, 0.53, p));
    ask.group.scale.setScalar(Math.max(0.001, askScale));
    ask.group.visible = p > 0.06 && p < 0.53;
    ask.group.rotation.set(0, lerp(0.38, 0, fly), Math.sin(fly * Math.PI) * 0.12);

    // Checks tick one by one as the message sits in the gate.
    const ticks = [0.43, 0.46, 0.49];
    chips.forEach((c, i) => {
      const on = p >= ticks[i];
      if (on !== c.lit) {
        c.lit = on;
        (c.face.material as THREE.MeshBasicMaterial).map = on ? c.on : c.off;
        (c.body.material as THREE.MeshStandardMaterial).color.set(on ? "#e6f8f8" : "#ffffff");
      }
      const pop = window01(ticks[i], ticks[i] + 0.04, p, 0.015);
      c.group.position.z = pop * 0.15;
      c.group.scale.setScalar(1 + pop * 0.08);
    });
    const active = window01(0.4, 0.56, p, 0.03);
    ringMat.emissiveIntensity = 0.5 + active * 1.6;
    (glow.material as THREE.SpriteMaterial).opacity = active * 0.85;
    ring.rotation.z = p * 6;
    sparks.forEach((sp, i) => {
      const ang = p * 40 + (i * Math.PI * 2) / 3;
      sp.position.set(Math.cos(ang) * 0.5, Math.sin(ang) * 0.5, 0.05);
      (sp.material as THREE.SpriteMaterial).opacity = active;
    });
    ring.scale.setScalar(1 + 0.05 * Math.sin(p * 120) * active);

    // Act 3 — the acknowledgement returns to the phone (0.52 → 0.66).
    const back = sstep(0.52, 0.66, p);
    phoneScreen(b, 0.2);
    b.z += 0.15;
    tmp.copy(GATE);
    arc(ack.group.position, tmp, b, back, 0.6);
    ack.group.visible = p > 0.51 && p < 0.67;
    ack.group.scale.setScalar(Math.max(0.001, lerp(0.4, 1, sstep(0.51, 0.55, p)) * (1 - sstep(0.63, 0.67, p) * 0.7)));
    ack.group.rotation.set(0, lerp(0, 0.38, back), 0);

    // Act 4 — the appointment drops into Thursday 10:30 and locks in (0.76 → 0.88).
    slotWorld.set(SLOT[0], SLOT[1], 0.09).applyMatrix4(board.matrixWorld);
    const drop = sstep(0.76, 0.87, p);
    tmp.copy(GATE);
    tmp.y -= 0.2;
    arc(appt.position, tmp, slotWorld, drop, 0.35);
    appt.visible = p > 0.74;
    appt.scale.setScalar(Math.max(0.001, sstep(0.74, 0.78, p)) * (1 + 0.25 * (1 - drop)));
    appt.quaternion.copy(board.quaternion);
    appt.rotateZ((1 - drop) * 0.5);
    const locked = p >= 0.885;
    if ((apptFaceMat.map === apptDone) !== locked) {
      apptFaceMat.map = locked ? apptDone : apptPending;
      apptFaceMat.needsUpdate = true;
    }
    (slotGlow.material as THREE.SpriteMaterial).opacity = window01(0.86, 0.95, p, 0.02) * 0.9;

    // …and the reminder promise goes back to the phone (0.9 → 0.97).
    const remT = sstep(0.9, 0.965, p);
    phoneScreen(b, 0.35);
    b.z += 0.15;
    arc(rem.group.position, slotWorld, b, remT, 0.9);
    rem.group.visible = p > 0.895 && p < 0.97;
    rem.group.scale.setScalar(Math.max(0.001, lerp(0.4, 1, sstep(0.895, 0.92, p))));
    rem.group.rotation.set(0, lerp(-0.32, 0.38, remT), 0);
  };

  return {
    update,
    dispose: () => {
      disposeDeep(root);
      [askTex, ackTex, remTex, gateLabelTex, boardTex, apptPending, apptDone, glowTex, shadowTex, screenTex].forEach((t) => t.dispose());
      chips.forEach((c) => {
        c.off.dispose();
        c.on.dispose();
      });
    },
  };
}

export default function WhatsappScene({ bus, onReady }: StorySceneProps) {
  return (
    <StoryCanvas onReady={onReady} camera={{ position: [0.7, 1.3, 9.0], fov: 36 }} dpr={[2, 2.5]}>
      <StudioLights />
      <FrameOffset x={0.12} />
      <Imperative bus={bus} build={build} />
    </StoryCanvas>
  );
}
