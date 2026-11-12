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
  lerp,
  loadLogoMark,
  siteFont,
  sstep,
  type Built,
} from "./scene-kit";
import type { StorySceneProps } from "./story-stage";

/**
 * "The connected core" — the platform page's story.
 *
 * Act 1: six areas float apart, tilted, like separate registers and spreadsheets.
 * Act 2: they dock in a ring around one FlexicaAI core; links grow to each.
 * Act 3: a pulse travels the chain — WhatsApp booking → diary → note → bill → P&L —
 *        through the core each time, lighting each area as it passes.
 * Act 4: the camera pulls back; Front desk, Doctors and Owner appear above the ring,
 *        each linked to the areas their work needs.
 */

type Mod = { key: string; name: string; sub: string; chain?: string };

// Ring order (counter-clockwise from the back) — the chain runs around it.
const MODULES: Mod[] = [
  { key: "patients", name: "Patients", sub: "Records, history, plans" },
  { key: "whatsapp", name: "WhatsApp", sub: "Bookings & reminders", chain: "The booking" },
  { key: "appointments", name: "Appointments", sub: "Calendars & the queue", chain: "In the diary" },
  { key: "scribe", name: "AI Scribe", sub: "Draft notes to approve", chain: "The note" },
  { key: "billing", name: "Billing", sub: "Invoices & receipts", chain: "The bill" },
  { key: "analytics", name: "Analytics", sub: "Sales to profit & loss", chain: "The P&L" },
];
const CHAIN = ["whatsapp", "appointments", "scribe", "billing", "analytics"];

const ROLES = [
  { name: "Front desk", sub: "Bookings, arrivals, the queue, the bill", at: [-3.1, 3.55, 0.2], mods: ["whatsapp", "appointments", "billing"] },
  { name: "Doctors", sub: "Records, notes, plans, prescriptions", at: [0.2, 3.95, -0.6], mods: ["patients", "scribe"] },
  { name: "Owner", sub: "Sales, expenses, shares, P&L", at: [3.4, 3.55, 0.2], mods: ["analytics"] },
] as const;

// Where each tile drifts before the core exists (x, y, z, rotX, rotY, rotZ).
const SCATTER: [number, number, number, number, number, number][] = [
  [0.4, 3.1, -4.2, 0.35, -0.5, 0.25],
  [-2.6, 2.2, -1.4, -0.3, 0.6, -0.35],
  [-1.6, -0.9, 2.2, 0.45, -0.3, 0.3],
  [2.0, -1.1, 2.6, -0.4, 0.45, -0.25],
  [4.6, 0.6, 0.8, 0.25, -0.7, 0.4],
  [3.6, 3.0, -2.6, -0.35, 0.35, -0.3],
];

const R = 3.0;
const TILE_Y = 0.75;
const CORE_Y = 0.3;

// Camera keys: [p, posX, posY, posZ, lookX, lookY, lookZ]
const CAM: number[][] = [
  [0.0, 0.6, 2.6, 12.5, 0.8, 0.8, 0],
  [0.2, 0.6, 3.2, 12.0, 0.8, 0.8, 0],
  [0.45, 0.2, 5.2, 10.6, 0.3, 0.5, 0],
  [0.72, 0.4, 5.6, 9.8, 0.3, 0.5, 0.2],
  [0.86, 0.0, 6.6, 12.6, 0.2, 1.6, 0],
  [1.0, 0.0, 6.8, 13.0, 0.2, 1.7, 0],
];

// ─── Card textures ───────────────────────────────────────────────────────────

const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

// Lucide icon paths (24-unit grid).
const ICONS: Record<string, string[]> = {
  patients: [circ(12, 8, 5), "M20 21a8 8 0 0 0-16 0"],
  whatsapp: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z"],
  appointments: ["M8 2v4", "M16 2v4", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M3 10h18", "M8 14h.01", "M12 14h.01", "M16 14h.01", "M8 18h.01", "M12 18h.01"],
  scribe: ["M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  billing: ["M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z", "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8", "M12 17.5v-11"],
  analytics: ["M13 17V9", "M18 17V5", "M3 3v16a2 2 0 0 0 2 2h16", "M8 17v-3"],
  "Front desk": ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", circ(9, 7, 4), "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  Doctors: ["M11 2v2", "M5 2v2", "M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1", "M8 15a6 6 0 0 0 12 0v-3", circ(20, 10, 2)],
  Owner: ["M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16", "M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"],
};

// Textures are drawn at TEX_SCALE× their layout size so small text stays crisp.
const TEX_SCALE = 1.5;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * TEX_SCALE);
  c.height = Math.round(h * TEX_SCALE);
  const g = c.getContext("2d")!;
  g.scale(TEX_SCALE, TEX_SCALE);
  draw(g, siteFont());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function drawIcon(g: CanvasRenderingContext2D, key: string, x: number, y: number, size: number, color = "#ffffff") {
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const d of ICONS[key] ?? []) g.stroke(new Path2D(d));
  g.restore();
}

/** Navy-to-teal rounded icon tile, as on the site's cards. */
function iconTile(g: CanvasRenderingContext2D, key: string, x: number, y: number, s: number) {
  const grd = g.createLinearGradient(x, y, x + s, y + s);
  grd.addColorStop(0, "#0b3d6b");
  grd.addColorStop(0.55, "#082957");
  grd.addColorStop(1, "#0a6f86");
  g.fillStyle = grd;
  g.beginPath();
  g.roundRect(x, y, s, s, s * 0.26);
  g.fill();
  const hl = g.createRadialGradient(x + s * 0.3, y + s * 0.2, 0, x + s * 0.3, y + s * 0.2, s * 0.75);
  hl.addColorStop(0, "rgba(95,224,228,0.55)");
  hl.addColorStop(1, "rgba(95,224,228,0)");
  g.fillStyle = hl;
  g.fill();
  drawIcon(g, key, x + s * 0.25, y + s * 0.25, s * 0.5);
}

const CARD_W = 2.05;
const CARD_H = 0.86;
const CARD_PX = 320; // px per unit

/** A module card face: white glass, icon tile, name and one line. */
function moduleTexture(mod: Mod) {
  const W = CARD_W * CARD_PX;
  const H = CARD_H * CARD_PX;
  return canvasTex(W, H, (g, font) => {
    const r = 0.1 * CARD_PX;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#ffffff");
    bg.addColorStop(1, "#eef6fa");
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(2, 2, W - 4, H - 4, r);
    g.fill();
    g.strokeStyle = "rgba(15,180,187,0.35)";
    g.lineWidth = 3;
    g.stroke();
    // top accent line
    const ac = g.createLinearGradient(0, 0, W, 0);
    ac.addColorStop(0, "rgba(15,180,187,0)");
    ac.addColorStop(0.5, "rgba(15,180,187,0.9)");
    ac.addColorStop(1, "rgba(15,180,187,0)");
    g.fillStyle = ac;
    g.fillRect(r, 3, W - 2 * r, 4);
    iconTile(g, mod.key, 30, (H - 150) / 2, 150);
    g.textBaseline = "middle";
    g.fillStyle = "#0b1b33";
    g.font = `700 54px ${font}`;
    g.fillText(mod.name, 210, H / 2 - 26, W - 240);
    g.fillStyle = "#4a5d78";
    g.font = `600 34px ${font}`;
    g.fillText(mod.sub, 210, H / 2 + 34, W - 236);
  });
}

function chipTexture(text: string) {
  return canvasTex(420, 110, (g, font) => {
    const grd = g.createLinearGradient(0, 0, 420, 0);
    grd.addColorStop(0, "#0fb4bb");
    grd.addColorStop(1, "#069fc5");
    g.fillStyle = grd;
    g.beginPath();
    g.roundRect(4, 8, 412, 94, 47);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(52, 55, 11, 0, Math.PI * 2);
    g.fill();
    g.font = `700 44px ${font}`;
    g.textBaseline = "middle";
    g.fillText(text, 80, 57, 320);
  });
}

function roleTexture(name: string, sub: string) {
  return canvasTex(780, 220, (g, font) => {
    const bg = g.createLinearGradient(0, 0, 780, 220);
    bg.addColorStop(0, "#0b3d6b");
    bg.addColorStop(1, "#061c3b");
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, 772, 212, 106);
    g.fill();
    g.strokeStyle = "rgba(95,224,228,0.55)";
    g.lineWidth = 3;
    g.stroke();
    const av = g.createLinearGradient(30, 30, 190, 190);
    av.addColorStop(0, "#5fe0e4");
    av.addColorStop(1, "#0fb4bb");
    g.fillStyle = av;
    g.beginPath();
    g.arc(110, 110, 76, 0, Math.PI * 2);
    g.fill();
    drawIcon(g, name, 70, 70, 80, "#04152e");
    g.textBaseline = "middle";
    g.fillStyle = "#ffffff";
    g.font = `700 60px ${font}`;
    g.fillText(name, 215, 82, 530);
    g.fillStyle = "#b5f0f2";
    g.font = `600 34px ${font}`;
    g.fillText(sub, 215, 148, 540);
  });
}

function coreLabelTexture() {
  return canvasTex(640, 180, (g, font) => {
    g.fillStyle = "rgba(4,21,46,0.92)";
    g.beginPath();
    g.roundRect(4, 4, 632, 172, 86);
    g.fill();
    g.strokeStyle = "rgba(95,224,228,0.6)";
    g.lineWidth = 3;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#5fe0e4";
    g.font = `700 30px ${font}`;
    g.letterSpacing = "6px";
    g.fillText("FLEXICAAI CORE", 320, 66);
    g.letterSpacing = "0px";
    g.fillStyle = "#ffffff";
    g.font = `600 40px ${font}`;
    g.fillText("One record per patient", 320, 118);
  });
}

function build(root: THREE.Group): Built {
  const glow = glowTexture(COLORS.tealGlow);
  const textures: THREE.Texture[] = [glow];
  const tileGeo = new RoundedBoxGeometry(CARD_W - 0.04, CARD_H - 0.04, 0.2, 5, 0.1);
  const stripGeo = new RoundedBoxGeometry(1.2, 0.035, 0.05, 2, 0.015);
  const labelGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const chipGeo = new THREE.PlaneGeometry(1.15, 0.3);
  const linkGeo = new THREE.CylinderGeometry(0.013, 0.013, 1, 8, 1, true);
  const white = new THREE.Color(COLORS.white);
  const paper = new THREE.Color("#dfe7f0");
  const tealC = new THREE.Color(COLORS.teal);
  const UP = new THREE.Vector3(0, 1, 0);

  // ── Floor ring and glow
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(R - 0.02, R + 0.02, 96),
    new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(R + 1.2, 64),
    new THREE.MeshBasicMaterial({ map: glow, color: COLORS.teal, transparent: true, opacity: 0, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  const orbitPts = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    orbitPts.set([Math.cos(a) * (R + 0.75), 0.01, Math.sin(a) * (R + 0.75)], i * 3);
  }
  const orbitGeo = new THREE.BufferGeometry();
  orbitGeo.setAttribute("position", new THREE.BufferAttribute(orbitPts, 3));
  const orbitMat = new THREE.PointsMaterial({ color: COLORS.teal, size: 0.05, transparent: true, opacity: 0, depthWrite: false });
  const orbit = new THREE.Points(orbitGeo, orbitMat);
  root.add(ring, disc, orbit);

  // ── The core: a rounded hexagonal prism with a teal edge and a floating label.
  const core = new THREE.Group();
  const hex = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.95;
    const y = Math.sin(a) * 0.95;
    if (i === 0) hex.moveTo(x, y);
    else hex.lineTo(x, y);
  }
  hex.closePath();
  const hexGeo = new THREE.ExtrudeGeometry(hex, { depth: 0.38, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 4 });
  hexGeo.rotateX(-Math.PI / 2);
  hexGeo.translate(0, -0.19, 0);
  const coreMat = new THREE.MeshPhysicalMaterial({
    color: "#0b3d6b",
    roughness: 0.18,
    metalness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    emissive: COLORS.teal,
    emissiveIntensity: 0,
  });
  const coreBody = new THREE.Mesh(hexGeo, coreMat);
  const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(hexGeo, 30), edgeMat);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: COLORS.teal, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  coreGlow.scale.set(4, 4, 1);
  const coreLabelTex = coreLabelTexture();
  textures.push(coreLabelTex);
  const coreLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreLabelTex, transparent: true, opacity: 0, depthTest: false }));
  const logoMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const logo = new THREE.Sprite(logoMat);
  logo.scale.setScalar(0.82);
  logo.position.y = 0.95;
  logo.renderOrder = 3;
  // A navy badge with a teal rim behind the mark, so it reads on the light page.
  const badgeTex = canvasTex(256, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 256, 256);
    grd.addColorStop(0, "#0b3d6b");
    grd.addColorStop(1, "#04152e");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(128, 128, 118, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#5fe0e4";
    g.lineWidth = 7;
    g.stroke();
  });
  textures.push(badgeTex);
  const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const badge = new THREE.Sprite(badgeMat);
  badge.scale.setScalar(1.12);
  badge.position.y = 0.95;
  badge.renderOrder = 2;
  loadLogoMark((t) => {
    textures.push(t);
    logoMat.map = t;
    logoMat.needsUpdate = true;
  });
  coreLabel.scale.set(2.1, 0.59, 1);
  coreLabel.position.set(0, CORE_Y + 2.05, -0.4);
  coreLabel.renderOrder = 5;
  core.add(coreBody, edges, coreGlow, badge, logo);
  core.position.y = CORE_Y;
  root.add(core, coreLabel);

  // ── Tiles
  type Tile = {
    mod: Mod;
    group: THREE.Group;
    mat: THREE.MeshStandardMaterial;
    stripMat: THREE.MeshStandardMaterial;
    chip?: THREE.Mesh;
    chipMat?: THREE.MeshBasicMaterial;
    home: THREE.Vector3;
    link: THREE.Mesh;
    linkMat: THREE.MeshBasicMaterial;
    linkDir: THREE.Vector3;
    linkLen: number;
    chainAt: number;
  };
  const tiles: Tile[] = MODULES.map((mod, i) => {
    const a = Math.PI + (i * Math.PI * 2) / MODULES.length;
    const home = new THREE.Vector3(Math.sin(a) * R, TILE_Y, Math.cos(a) * R);
    const group = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: COLORS.white, roughness: 0.35, clearcoat: 1, emissive: "#d9f1f5", emissiveIntensity: 0.45 });
    const body = new THREE.Mesh(tileGeo, mat);
    const stripMat = new THREE.MeshStandardMaterial({ color: COLORS.teal, emissive: COLORS.teal, emissiveIntensity: 0.1, roughness: 0.4 });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(0, 0.43, -0.02);
    const faceTex = moduleTexture(mod);
    textures.push(faceTex);
    const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, toneMapped: false }));
    label.position.z = 0.102;
    group.add(body, strip, label);

    let chip: THREE.Mesh | undefined;
    let chipMat: THREE.MeshBasicMaterial | undefined;
    if (mod.chain) {
      const chipTex = chipTexture(mod.chain);
      textures.push(chipTex);
      chipMat = new THREE.MeshBasicMaterial({
        map: chipTex,
        transparent: true,
        opacity: 0,
        toneMapped: false,
        depthWrite: false,
      });
      chip = new THREE.Mesh(chipGeo, chipMat);
      chip.position.set(0, -0.68, 0.11);
      group.add(chip);
    }
    root.add(group);

    // Link from the core to the tile's foot.
    const from = new THREE.Vector3(0, CORE_Y, 0);
    const to = new THREE.Vector3(home.x, TILE_Y - 0.35, home.z);
    const linkDir = to.clone().sub(from);
    const linkLen = linkDir.length();
    linkDir.normalize();
    const linkMat = new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.85, toneMapped: false });
    const link = new THREE.Mesh(linkGeo, linkMat);
    link.quaternion.setFromUnitVectors(UP, linkDir);
    link.visible = false;
    root.add(link);

    const ci = CHAIN.indexOf(mod.key);
    return { mod, group, mat, stripMat, chip, chipMat, home, link, linkMat, linkDir, linkLen, chainAt: ci < 0 ? -1 : ci / (CHAIN.length - 1) };
  });
  const byKey = new Map(tiles.map((t) => [t.mod.key, t]));

  // ── The pulse: tile → core → tile along the chain.
  const pts: THREE.Vector3[] = [];
  CHAIN.forEach((k, i) => {
    const h = byKey.get(k)!.home;
    pts.push(new THREE.Vector3(h.x * 0.92, TILE_Y - 0.35, h.z * 0.92));
    if (i < CHAIN.length - 1) pts.push(new THREE.Vector3(0, CORE_Y + 0.5, 0));
  });
  const path = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
  const DIV = 800;
  path.arcLengthDivisions = DIV;
  const lens = path.getLengths(DIV);
  // Arc-length position of each chain stop (they are every other control point).
  const stopU = CHAIN.map((_, i) => lens[Math.round(((i * 2) / (pts.length - 1)) * DIV)] / lens[DIV]);
  tiles.forEach((t) => {
    const ci = CHAIN.indexOf(t.mod.key);
    if (ci >= 0) t.chainAt = stopU[ci];
  });
  const TRAIL = 14;
  const trail: THREE.Sprite[] = Array.from({ length: TRAIL }, (_, i) => {
    const s = new THREE.Sprite(
      // Normal blending: additive glows vanish on the light background.
      new THREE.SpriteMaterial({ map: glow, color: i === 0 ? COLORS.teal : COLORS.tealGlow, transparent: true, opacity: 0, depthWrite: false, depthTest: false }),
    );
    const k = 1 - i / TRAIL;
    s.scale.setScalar(i === 0 ? 1.0 : 0.7 * k);
    s.renderOrder = 4;
    root.add(s);
    return s;
  });

  // ── Roles, with lines down to their areas.
  type RoleLine = { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; from: THREE.Vector3; dir: THREE.Vector3; len: number };
  const roleSprites: THREE.Sprite[] = [];
  const roleLines: RoleLine[] = [];
  const dashGeo = new THREE.CylinderGeometry(0.007, 0.007, 1, 6, 1, true);
  const dotGeo = new THREE.SphereGeometry(0.05, 16, 12);
  const roleDots: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  ROLES.forEach((r) => {
    const roleTex = roleTexture(r.name, r.sub);
    textures.push(roleTex);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: roleTex, transparent: true, opacity: 0, depthTest: false }));
    s.scale.set(2.6, (2.6 * 220) / 780, 1);
    s.position.set(r.at[0], r.at[1], r.at[2]);
    s.renderOrder = 6;
    root.add(s);
    roleSprites.push(s);
    r.mods.forEach((k) => {
      const t = byKey.get(k)!;
      const from = new THREE.Vector3(r.at[0], r.at[1] - 0.33, r.at[2]);
      const to = new THREE.Vector3(t.home.x, TILE_Y + 0.46, t.home.z);
      const dir = to.clone().sub(from);
      const len = dir.length();
      dir.normalize();
      const mat = new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(dashGeo, mat);
      const dotMat = new THREE.MeshBasicMaterial({ color: COLORS.teal, transparent: true, opacity: 0, toneMapped: false });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(to);
      root.add(dot);
      roleDots.push({ mesh: dot, mat: dotMat });
      mesh.quaternion.setFromUnitVectors(UP, dir);
      mesh.visible = false;
      root.add(mesh);
      roleLines.push({ mesh, mat, from, dir, len });
    });
  });

  const camPos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function update(p: number, camera: THREE.PerspectiveCamera) {
    // Camera
    let k = 0;
    while (k < CAM.length - 2 && p > CAM[k + 1][0]) k++;
    const a = CAM[k];
    const b = CAM[k + 1];
    const t = sstep(a[0], b[0], p);
    camPos.set(lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t));
    look.set(lerp(a[4], b[4], t), lerp(a[5], b[5], t), lerp(a[6], b[6], t));
    camera.position.copy(camPos);
    camera.lookAt(look);

    const drift = Math.sin(p * 40);
    const dock = sstep(0.2, 0.44, p);
    const coreIn = sstep(0.26, 0.4, p);
    const pulseU = sstep(0.5, 0.76, p);
    const pulseOn = p > 0.49 && p < 0.79 ? 1 : 0;
    const roles = sstep(0.8, 0.9, p);

    // Core
    core.scale.setScalar(0.001 + coreIn);
    core.rotation.y = p * 2.2;
    coreMat.emissiveIntensity = 0.05 + 0.18 * coreIn + 0.35 * pulseOn * (0.5 + 0.5 * Math.sin(p * 300));
    logoMat.opacity = coreIn;
    badgeMat.opacity = coreIn;
    logo.position.y = badge.position.y = 0.95 + Math.sin(p * 30) * 0.05;
    edgeMat.opacity = coreIn;
    (coreGlow.material as THREE.SpriteMaterial).opacity = 0.55 * coreIn;
    (coreLabel.material as THREE.SpriteMaterial).opacity = sstep(0.36, 0.42, p) * (1 - roles);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 * dock;
    (disc.material as THREE.MeshBasicMaterial).opacity = 0.18 * dock;
    orbitMat.opacity = 0.6 * dock;
    orbit.rotation.y = p * 1.5;

    // Tiles
    tiles.forEach((tile, i) => {
      const s = SCATTER[i];
      const d = sstep(0.2 + i * 0.025, 0.4 + i * 0.025, p);
      const bob = (1 - d) * 0.18 * Math.sin(p * 18 + i * 1.7);
      tile.group.position.set(lerp(s[0], tile.home.x, d), lerp(s[1], tile.home.y, d) + bob, lerp(s[2], tile.home.z, d));
      tile.group.rotation.set(lerp(s[3] + 0.05 * drift, -0.12, d), lerp(s[4], 0, d), lerp(s[5], 0, d));
      tile.mat.color.lerpColors(paper, white, d);

      // Link grows once docked.
      const g = sstep(0.4 + i * 0.012, 0.48 + i * 0.012, p);
      tile.link.visible = g > 0.001;
      if (tile.link.visible) {
        const len = tile.linkLen * g;
        tile.link.scale.set(1, len, 1);
        tile.link.position.set(0, CORE_Y, 0).addScaledVector(tile.linkDir, len / 2);
      }

      // Lit by the pulse.
      let lit = 0;
      if (tile.chainAt >= 0) lit = sstep(tile.chainAt - 0.03, tile.chainAt + 0.01, pulseU) * sstep(0.49, 0.51, p);
      const hit = tile.chainAt >= 0 ? Math.max(0, 1 - Math.abs(pulseU - tile.chainAt) / 0.06) * pulseOn : 0;
      tile.stripMat.emissiveIntensity = 0.1 + 1.6 * lit + 2 * hit;
      tile.linkMat.color.lerpColors(tealC, white, hit * 0.6);
      tile.group.scale.setScalar(1 + 0.07 * hit);
      if (tile.chipMat && tile.chip) {
        tile.chipMat.opacity = lit * (1 - roles);
        tile.chip.position.y = -0.68 - 0.08 * (1 - lit);
      }
    });

    // Pulse + trail
    trail.forEach((s, i) => {
      const u = pulseU - i * 0.006;
      const on = pulseOn && u > 0 && u < 1;
      s.visible = Boolean(on);
      if (!on) return;
      path.getPointAt(Math.min(1, Math.max(0, u)), tmp);
      s.position.copy(tmp);
      (s.material as THREE.SpriteMaterial).opacity = (i === 0 ? 1 : 0.75 * (1 - i / TRAIL)) * sstep(0.49, 0.51, p) * (1 - sstep(0.77, 0.79, p));
    });

    // Roles
    roleSprites.forEach((s, i) => {
      const r = sstep(0.8 + i * 0.025, 0.88 + i * 0.025, p);
      (s.material as THREE.SpriteMaterial).opacity = r;
      s.position.y = ROLES[i].at[1] + 0.25 * (1 - r);
    });
    roleLines.forEach((l) => {
      const g = sstep(0.86, 0.95, p);
      l.mesh.visible = g > 0.001;
      if (!l.mesh.visible) return;
      const len = l.len * g;
      l.mesh.scale.set(1, len, 1);
      tmp2.copy(l.from).addScaledVector(l.dir, len / 2);
      l.mesh.position.copy(tmp2);
    });
    const dotOn = sstep(0.93, 0.97, p);
    roleDots.forEach((d) => {
      d.mat.opacity = dotOn;
      d.mesh.scale.setScalar(0.4 + 0.6 * dotOn);
    });
  }

  return {
    update,
    dispose: () => {
      disposeDeep(root);
      textures.forEach((t) => t.dispose());
    },
  };
}

export default function PlatformScene({ bus, onReady }: StorySceneProps) {
  return (
    <StoryCanvas onReady={onReady} camera={{ position: [0.6, 2.6, 12.5], fov: 38 }} dpr={[2, 2.5]}>
      <FrameOffset x={0.16} narrowZoom={1.2} />
      <StudioLights />
      <Imperative bus={bus} build={build} />
    </StoryCanvas>
  );
}
