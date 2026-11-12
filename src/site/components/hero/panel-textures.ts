import * as THREE from "three";

/**
 * The hero's floating screens are drawn with the 2D canvas API and used as textures:
 * crisp text at any distance, no image downloads, five small draws at start-up.
 * Content mirrors the product (sample data only).
 */

export type PanelKind = "patient" | "appointment" | "note" | "whatsapp" | "analytics";

const W = 768;
const H = 480;

const C = {
  glass: "rgba(9, 34, 68, 0.86)",
  glassTop: "rgba(18, 60, 104, 0.9)",
  line: "rgba(255,255,255,0.14)",
  text: "#ffffff",
  mute: "#9db0c6",
  faint: "rgba(255,255,255,0.08)",
  teal: "#0fb4bb",
  tealGlow: "#5fe0e4",
  amber: "#fcd34d",
  green: "#6ee7b7",
  wa: "#d9fdd3",
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, fg: string, bg: string, font: string) {
  ctx.font = `600 22px ${font}`;
  const w = ctx.measureText(label).width + 32;
  rr(ctx, x - w, y, w, 38, 19);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(label, x - w + 16, y + 26);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h = 14, color = C.faint) {
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function frame(ctx: CanvasRenderingContext2D, title: string, font: string, accent = C.teal) {
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.glassTop);
  g.addColorStop(1, C.glass);
  rr(ctx, 4, 4, W - 8, H - 8, 34);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.line;
  ctx.stroke();
  // Top light edge
  const hl = ctx.createLinearGradient(0, 0, W, 0);
  hl.addColorStop(0, "rgba(95,224,228,0)");
  hl.addColorStop(0.5, "rgba(95,224,228,0.6)");
  hl.addColorStop(1, "rgba(95,224,228,0)");
  ctx.fillStyle = hl;
  ctx.fillRect(80, 5, W - 160, 2);
  // Header
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(52, 54, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 24px ${font}`;
  ctx.fillStyle = C.mute;
  ctx.fillText(title.toUpperCase(), 74, 62);
  ctx.fillStyle = C.line;
  ctx.fillRect(36, 92, W - 72, 2);
}

function draw(kind: PanelKind, ctx: CanvasRenderingContext2D, font: string) {
  switch (kind) {
    case "patient": {
      frame(ctx, "Patient profile", font);
      ctx.fillStyle = "rgba(15,180,187,0.2)";
      ctx.beginPath();
      ctx.arc(92, 162, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.tealGlow;
      ctx.font = `700 30px ${font}`;
      ctx.fillText("AK", 70, 173);
      ctx.fillStyle = C.text;
      ctx.font = `600 40px ${font}`;
      ctx.fillText("Ayesha Khan", 158, 156);
      ctx.fillStyle = C.mute;
      ctx.font = `400 24px ${font}`;
      ctx.fillText("F · 34 · MRN FA-100248", 158, 192);
      rr(ctx, 36, 236, W - 72, 58, 16);
      ctx.fillStyle = "rgba(252,211,77,0.12)";
      ctx.fill();
      ctx.fillStyle = C.amber;
      ctx.font = `600 23px ${font}`;
      ctx.fillText("⚠  Allergy: penicillin", 60, 273);
      ctx.fillStyle = C.mute;
      ctx.font = `400 22px ${font}`;
      ctx.fillText("Last visit", 36, 345);
      ctx.fillText("Plan", 36, 405);
      ctx.fillStyle = C.text;
      ctx.font = `500 24px ${font}`;
      ctx.fillText("02 Sep · General check-up", 200, 345);
      ctx.fillText("CBC → follow-up", 200, 405);
      break;
    }
    case "appointment": {
      frame(ctx, "Appointment", font);
      ctx.fillStyle = C.text;
      ctx.font = `600 46px ${font}`;
      ctx.fillText("Thu 14 Nov", 36, 170);
      ctx.fillStyle = C.tealGlow;
      ctx.font = `600 46px ${font}`;
      ctx.fillText("10:30 am", 36, 228);
      pill(ctx, W - 36, 136, "Confirmed", "#a7f3d0", "rgba(52,211,153,0.16)", font);
      ctx.fillStyle = C.mute;
      ctx.font = `400 24px ${font}`;
      ctx.fillText("Dr. Sana Malik · Token #7", 36, 282);
      // Mini week strip
      const days = ["M", "T", "W", "T", "F", "S"];
      days.forEach((d, i) => {
        const x = 36 + i * 116;
        rr(ctx, x, 326, 100, 112, 18);
        ctx.fillStyle = i === 3 ? "rgba(15,180,187,0.25)" : C.faint;
        ctx.fill();
        ctx.fillStyle = i === 3 ? C.tealGlow : C.mute;
        ctx.font = `600 24px ${font}`;
        ctx.fillText(d, x + 42, 368);
        bar(ctx, x + 18, 392, 64 - (i % 3) * 14, 10, i === 3 ? C.teal : "rgba(255,255,255,0.14)");
        bar(ctx, x + 18, 412, 40 + (i % 2) * 16, 10, "rgba(255,255,255,0.1)");
      });
      break;
    }
    case "note": {
      frame(ctx, "AI clinical note", font, C.amber);
      pill(ctx, W - 36, 30, "Draft · review", "#fde68a", "rgba(252,211,77,0.14)", font);
      const rows: [string, number][] = [
        ["Complaint", 380],
        ["Examination", 470],
        ["Diagnosis", 300],
        ["Treatment", 420],
      ];
      rows.forEach(([k, w], i) => {
        const y = 130 + i * 62;
        ctx.fillStyle = C.mute;
        ctx.font = `500 22px ${font}`;
        ctx.fillText(k, 36, y + 12);
        bar(ctx, 236, y, w, 14, "rgba(255,255,255,0.18)");
      });
      rr(ctx, W - 300, 392, 264, 54, 27);
      ctx.fillStyle = C.teal;
      ctx.fill();
      ctx.fillStyle = "#04152e";
      ctx.font = `700 23px ${font}`;
      ctx.fillText("Review & approve", W - 274, 427);
      ctx.fillStyle = C.mute;
      ctx.font = `400 20px ${font}`;
      ctx.fillText("Doctor approves every note", 36, 427);
      break;
    }
    case "whatsapp": {
      frame(ctx, "WhatsApp", font, "#25d366");
      rr(ctx, 36, 120, 470, 78, 22);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fill();
      ctx.fillStyle = "#111b21";
      ctx.font = `500 24px ${font}`;
      ctx.fillText("Hi, I'd like to book an", 60, 154);
      ctx.fillText("appointment please", 60, 184);
      rr(ctx, W - 36 - 520, 222, 520, 112, 22);
      ctx.fillStyle = C.wa;
      ctx.fill();
      ctx.fillStyle = "#111b21";
      ctx.fillText("✅ Confirmed: Thu 14 Nov,", W - 530, 262);
      ctx.fillText("10:30 am with Dr. Sana Malik.", W - 530, 294);
      ctx.fillStyle = "#53bdeb";
      ctx.font = `600 20px ${font}`;
      ctx.fillText("✓✓", W - 90, 322);
      ctx.fillStyle = C.mute;
      ctx.font = `400 22px ${font}`;
      ctx.fillText("Reminder goes out the day before", 36, 410);
      break;
    }
    case "analytics": {
      frame(ctx, "Clinic analytics", font);
      ctx.fillStyle = C.mute;
      ctx.font = `400 22px ${font}`;
      ctx.fillText("Sales · November (sample)", 36, 140);
      ctx.fillStyle = C.text;
      ctx.font = `600 50px ${font}`;
      ctx.fillText("Rs 1.52M", 36, 200);
      pill(ctx, W - 36, 160, "Net Rs 610k", "#a7f3d0", "rgba(52,211,153,0.16)", font);
      const vals = [0.48, 0.55, 0.62, 0.6, 0.74, 0.86];
      vals.forEach((v, i) => {
        const bh = v * 170;
        const x = 36 + i * 118;
        const g = ctx.createLinearGradient(0, 440 - bh, 0, 440);
        g.addColorStop(0, i === vals.length - 1 ? C.tealGlow : C.teal);
        g.addColorStop(1, "rgba(15,180,187,0.15)");
        rr(ctx, x, 440 - bh, 82, bh, 12);
        ctx.fillStyle = g;
        ctx.fill();
      });
      break;
    }
  }
}

export const PANEL_ASPECT = W / H;

export function makePanelTexture(kind: PanelKind, font: string, maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(kind, ctx, font);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
