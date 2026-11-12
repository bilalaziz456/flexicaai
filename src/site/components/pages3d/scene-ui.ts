import * as THREE from "three";
import { COLORS, siteFont } from "./scene-kit";

/**
 * Canvas-drawn UI for the feature hero scenes: pills, chips and small line icons,
 * drawn at 2× so text stays crisp on a tilted plane.
 */

export const S = 2;

export function texOf(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

/** A canvas of w×h logical pixels, already scaled for supersampling. */
export function canvas2d(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w * S;
  c.height = h * S;
  const g = c.getContext("2d")!;
  g.scale(S, S);
  return { c, g };
}

export function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bg: string, line: string) {
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 18);
  g.fillStyle = bg;
  g.fill();
  g.clip();
  g.strokeStyle = line;
  g.lineWidth = 6;
  for (let i = -h; i < w; i += 26) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + h, y);
    g.stroke();
  }
  g.restore();
}

export type Icon = "dot" | "check" | "cross" | "none" | "desk" | "chat" | "doctor" | "owner" | "record" | "calendar" | "note" | "image" | "plan" | "bill";

/** Line icons, centred on (cx, cy), about 2r across. */
export function drawIcon(g: CanvasRenderingContext2D, icon: Icon, cx: number, cy: number, r: number, fg: string, bg: string) {
  g.save();
  g.strokeStyle = fg;
  g.fillStyle = fg;
  g.lineWidth = Math.max(3, r * 0.17);
  g.lineCap = "round";
  g.lineJoin = "round";
  const line = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(cx + x * r, cy + y * r) : g.moveTo(cx + x * r, cy + y * r)));
    g.stroke();
  };
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    g.beginPath();
    g.roundRect(cx + x * r, cy + y * r, w * r, h * r, rad * r);
    g.stroke();
  };
  switch (icon) {
    case "dot":
      g.beginPath();
      g.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
      g.fill();
      break;
    case "check":
    case "cross":
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = bg;
      g.lineWidth = r * 0.28;
      if (icon === "check") line([[-0.45, 0.02], [-0.12, 0.38], [0.5, -0.36]]);
      else {
        line([[-0.36, -0.36], [0.36, 0.36]]);
        line([[0.36, -0.36], [-0.36, 0.36]]);
      }
      break;
    case "desk":
      rr(-0.85, -0.7, 1.7, 1.1, 0.18);
      line([[0, 0.4], [0, 0.78]]);
      line([[-0.45, 0.82], [0.45, 0.82]]);
      break;
    case "chat":
      g.beginPath();
      g.arc(cx, cy - r * 0.05, r * 0.78, 0.35 * Math.PI, 2.35 * Math.PI);
      g.stroke();
      line([[-0.48, 0.58], [-0.78, 0.9], [-0.18, 0.72]]);
      break;
    case "doctor":
      g.beginPath();
      g.arc(cx, cy - r * 0.35, r * 0.4, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy + r * 0.95, r * 0.8, Math.PI * 1.15, Math.PI * 1.85);
      g.stroke();
      line([[0.55, 0.15], [0.55, 0.55]]);
      line([[0.35, 0.35], [0.75, 0.35]]);
      break;
    case "owner":
      line([[-0.75, 0.75], [0.8, 0.75]]);
      line([[-0.45, 0.5], [-0.45, 0.05]]);
      line([[0, 0.5], [0, -0.4]]);
      line([[0.45, 0.5], [0.45, -0.75]]);
      break;
    case "record":
      rr(-0.7, -0.85, 1.4, 1.7, 0.2);
      line([[-0.35, -0.35], [0.35, -0.35]]);
      line([[-0.35, 0.05], [0.35, 0.05]]);
      line([[-0.35, 0.45], [0.1, 0.45]]);
      break;
    case "calendar":
      rr(-0.8, -0.65, 1.6, 1.5, 0.22);
      line([[-0.8, -0.15], [0.8, -0.15]]);
      line([[-0.4, -0.9], [-0.4, -0.5]]);
      line([[0.4, -0.9], [0.4, -0.5]]);
      break;
    case "note":
      rr(-0.65, -0.85, 1.3, 1.7, 0.18);
      line([[-0.3, -0.35], [0.3, -0.35]]);
      line([[-0.3, 0.05], [0.3, 0.05]]);
      line([[-0.3, 0.42], [0.05, 0.42]]);
      break;
    case "image":
      rr(-0.85, -0.65, 1.7, 1.3, 0.2);
      line([[-0.6, 0.45], [-0.15, -0.05], [0.15, 0.25], [0.35, 0.05], [0.65, 0.45]]);
      g.beginPath();
      g.arc(cx + r * 0.38, cy - r * 0.3, r * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    case "plan":
      line([[-0.7, -0.55], [-0.45, -0.3], [-0.1, -0.7]]);
      line([[0.1, -0.5], [0.8, -0.5]]);
      line([[-0.7, 0.35], [-0.45, 0.6], [-0.1, 0.2]]);
      line([[0.1, 0.4], [0.8, 0.4]]);
      break;
    case "bill":
      line([[-0.6, -0.85], [0.6, -0.85], [0.6, 0.85], [0.3, 0.65], [0, 0.85], [-0.3, 0.65], [-0.6, 0.85], [-0.6, -0.85]]);
      line([[-0.3, -0.35], [0.3, -0.35]]);
      line([[-0.3, 0.05], [0.3, 0.05]]);
      break;
  }
  g.restore();
}

export type Tone = "teal" | "ok" | "warn" | "desk" | "wa" | "bubble" | "waBubble" | "navy";
export const TONES: Record<Tone, { fg: string; bg: string; ring: string; icon: Icon }> = {
  teal: { fg: COLORS.tealGlow, bg: "rgba(9,36,74,0.94)", ring: "rgba(95,224,228,0.55)", icon: "dot" },
  ok: { fg: "#86efac", bg: "rgba(8,64,40,0.94)", ring: "rgba(134,239,172,0.65)", icon: "check" },
  warn: { fg: "#fcd34d", bg: "rgba(92,56,6,0.94)", ring: "rgba(252,211,77,0.65)", icon: "cross" },
  desk: { fg: "#ffffff", bg: "rgba(8,41,87,0.96)", ring: "rgba(95,224,228,0.55)", icon: "desk" },
  navy: { fg: "#ffffff", bg: "rgba(8,41,87,0.96)", ring: "rgba(95,224,228,0.55)", icon: "dot" },
  wa: { fg: "#ffffff", bg: "#1fa855", ring: "rgba(255,255,255,0.4)", icon: "chat" },
  bubble: { fg: COLORS.ink, bg: "#ffffff", ring: "rgba(255,255,255,0)", icon: "none" },
  waBubble: { fg: "#111b21", bg: "#d9fdd3", ring: "rgba(255,255,255,0)", icon: "none" },
};

/**
 * A pill label: rounded capsule, optional icon, text. Icons on the brand tones sit in a
 * small teal-ringed disc. Returns the texture and its width/height ratio.
 */
export function pill(text: string, tone: Tone, weight = 700, icon?: Icon) {
  const t = TONES[tone];
  const ic = icon ?? t.icon;
  const H = 104;
  const font = siteFont();
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `${weight} 44px ${font}`;
  const pad = ic === "none" ? 44 : ic === "dot" || ic === "check" || ic === "cross" ? 96 : 112;
  const W = Math.ceil(m.measureText(text).width + pad + 46);
  const { c, g } = canvas2d(W, H);
  const bubble = tone === "bubble" || tone === "waBubble";
  // Soft inner gradient for depth.
  g.fillStyle = t.bg;
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 6, bubble ? 30 : 49);
  g.fill();
  if (!bubble) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(255,255,255,0.14)");
    grd.addColorStop(0.5, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fill();
  }
  g.strokeStyle = t.ring;
  g.lineWidth = 4;
  g.stroke();
  const cy = H / 2;
  if (ic === "dot") drawIcon(g, "dot", 52, cy, 26, tone === "navy" || tone === "desk" ? COLORS.tealGlow : t.fg, t.bg);
  else if (ic === "check" || ic === "cross") drawIcon(g, ic, 52, cy, 22, t.fg, t.bg);
  else if (ic !== "none") {
    g.fillStyle = tone === "wa" ? "rgba(255,255,255,0.2)" : "rgba(95,224,228,0.16)";
    g.beginPath();
    g.arc(58, cy, 34, 0, Math.PI * 2);
    g.fill();
    drawIcon(g, ic, 58, cy, 17, tone === "wa" ? "#ffffff" : COLORS.tealGlow, t.bg);
  }
  g.fillStyle = t.fg;
  g.font = `${weight} 44px ${font}`;
  g.textBaseline = "middle";
  g.fillText(text, pad, cy + 2);
  return { tex: texOf(c), aspect: W / H };
}

/** A rounded-rectangle tile, extruded (with a small bevel) so its edges catch the light. */
export function tileGeometry(w: number, h: number, depth = 0.07) {
  const r = Math.min(0.08, h * 0.28);
  const x = -w / 2;
  const y = -h / 2;
  const sh = new THREE.Shape();
  sh.moveTo(x + r, y);
  sh.lineTo(x + w - r, y);
  sh.quadraticCurveTo(x + w, y, x + w, y + r);
  sh.lineTo(x + w, y + h - r);
  sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  sh.lineTo(x + r, y + h);
  sh.quadraticCurveTo(x, y + h, x, y + h - r);
  sh.lineTo(x, y + r);
  sh.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
}
