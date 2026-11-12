"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { NARROW_CANVAS, capDpr } from "../story/webgl";
import { COLORS, NarrowFit, disposeDeep, glowTexture, lerp, siteFont } from "./scene-kit";
import { canvas2d, pill, texOf, tileGeometry } from "./scene-ui";

/**
 * Billing and payments hero: "every rupee of the visit, on one clear bill".
 * A dark glass invoice (the same sample as the page's InvoiceMock, INV-02418) floats over a
 * teal glow. The visit's lines fly in from the price list and land on it; the
 * procedure's line discount waits for approval, then counts; the totals appear; cash
 * from the front desk is recorded, the balance due shows and the bill is stamped
 * "partly paid"; finally the print options light up — thermal, A5, A4.
 * Loops every CYCLE seconds. Sample data only.
 */

const CYCLE = 12.5;
const T_ITEM = (i: number) => 0.5 + i * 0.75;
const FLY = 0.8;
const T_WAIT = 2.9; // discount awaiting approval
const T_OK = 3.9; // approved
const T_SUM = 4.5; // discounts and total rows
const T_CASH = 5.5; // cash flies in
const T_PAID = 6.3;
const T_STAMP = 6.9;
const T_PRINT = 7.9;
const T_OUT = CYCLE - 1.0;

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const n = (v: number) => v.toLocaleString("en-US");

// ── The invoice, in texture pixels.
const TW = 640;
const TH = 820;
const ROW_X = 40;
const ROW_W = 560;
const ROW_H = 70;
const ROW_Y = (i: number) => 226 + i * 80;
const SUM_Y = (k: number) => 488 + k * 46;
const SUM_H = 40;

const ITEMS = [
  { k: "Consultation", d: "Dr. Sana Malik", v: 2500 },
  { k: "Minor procedure · wound suturing", d: "Procedure", v: 18000, disc: 1800 },
  { k: "ECG", d: "Service", v: 800 },
];
const SUB = ITEMS.reduce((s, l) => s + l.v, 0);
const DISC = ITEMS.reduce((s, l) => s + (l.disc ?? 0), 0);
const TOTAL = SUB - DISC;
const PAID = 12000;

const WHITE = "#ffffff";
const MUTE = "#9fb3c8";
const FAINT = "#64748b";

/** The printed layer of the invoice, on a transparent sheet over dark glass. */
function paperTexture() {
  const { c, g } = canvas2d(TW, TH);
  const font = siteFont();
  // Teal band along the top.
  g.save();
  g.beginPath();
  g.roundRect(0, 0, TW, TH, 30);
  g.clip();
  const grd = g.createLinearGradient(0, 0, TW, 0);
  grd.addColorStop(0, COLORS.teal);
  grd.addColorStop(1, COLORS.tealGlow);
  g.fillStyle = grd;
  g.fillRect(0, 0, TW, 10);
  g.restore();
  g.textBaseline = "middle";
  g.fillStyle = COLORS.tealGlow;
  g.font = `700 19px ${font}`;
  g.fillText("C I T Y   C A R E   C L I N I C", 40, 50);
  g.fillStyle = WHITE;
  g.font = `700 36px ${font}`;
  g.fillText("Invoice INV-02418", 40, 96);
  g.fillStyle = MUTE;
  g.font = `500 21px ${font}`;
  g.fillText("Ayesha Khan · MRN FA-100248 · Thu, 14 Nov", 40, 136);
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(40, 168, TW - 80, 2);
  g.fillStyle = FAINT;
  g.font = `700 16px ${font}`;
  g.fillText("I T E M", 40, 196);
  g.textAlign = "right";
  g.fillText("R S", TW - 40, 196);
  g.textAlign = "left";
  ITEMS.forEach((_, i) => {
    g.save();
    g.setLineDash([10, 8]);
    g.strokeStyle = "rgba(95,224,228,0.28)";
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(ROW_X, ROW_Y(i), ROW_W, ROW_H, 14);
    g.stroke();
    g.restore();
  });
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(40, 470, TW - 80, 2);
  return texOf(c);
}

/** The words on a bill line. Transparent: the line itself is a raised 3D tile. */
function rowTexture(it: (typeof ITEMS)[number], approved: boolean) {
  const { c, g } = canvas2d(ROW_W, ROW_H);
  const font = siteFont();
  g.fillStyle = COLORS.tealGlow;
  g.beginPath();
  g.roundRect(12, 16, 5, ROW_H - 32, 3);
  g.fill();
  g.textBaseline = "middle";
  g.fillStyle = WHITE;
  g.font = `700 24px ${font}`;
  g.fillText(it.k, 30, 25);
  g.font = `500 18px ${font}`;
  g.fillStyle = MUTE;
  g.fillText(it.d, 30, 51);
  if (it.disc && approved) {
    const w = g.measureText(it.d).width;
    g.fillStyle = "#86efac";
    g.fillText(` · line discount −${n(it.disc)}`, 30 + w, 51);
  }
  g.textAlign = "right";
  g.fillStyle = WHITE;
  g.font = `700 24px ${font}`;
  g.fillText(n(it.v), ROW_W - 20, 25);
  return texOf(c);
}

function sumTexture(label: string, value: string, tone: "mute" | "bold" | "due") {
  const { c, g } = canvas2d(ROW_W, SUM_H);
  const font = siteFont();
  if (tone === "due") {
    g.fillStyle = "rgba(225,29,72,0.18)";
    g.beginPath();
    g.roundRect(1, 1, ROW_W - 2, SUM_H - 2, 10);
    g.fill();
    g.strokeStyle = "rgba(251,113,133,0.5)";
    g.lineWidth = 2;
    g.stroke();
  }
  const weight = tone === "mute" ? 500 : 700;
  const size = tone === "bold" ? 26 : 22;
  g.textBaseline = "middle";
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = tone === "due" ? "#fda4af" : tone === "bold" ? WHITE : MUTE;
  g.fillText(label, 12, SUM_H / 2 + 1);
  g.textAlign = "right";
  g.fillStyle = tone === "due" ? "#fda4af" : tone === "bold" ? COLORS.tealGlow : MUTE;
  g.fillText(value, ROW_W - 12, SUM_H / 2 + 1);
  return texOf(c);
}

function stampTexture() {
  const W = 300;
  const H = 92;
  const { c, g } = canvas2d(W, H);
  const font = siteFont();
  g.fillStyle = "rgba(225,29,72,0.16)";
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, 14);
  g.fill();
  g.strokeStyle = "#fb7185";
  g.lineWidth = 5;
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(15, 15, W - 30, H - 30, 9);
  g.stroke();
  g.fillStyle = "#fda4af";
  g.font = `800 34px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("PARTLY PAID", W / 2, H / 2 + 2);
  return { tex: texOf(c), aspect: W / H };
}

// ── The scene

type Api = { update: (time: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group, narrow: boolean): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = root) => (parent.add(o), o);
  const glowSprite = (color: string, size: number, opacity = 1) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    s.scale.set(size, size, 1);
    return s;
  };
  const sprite = (tex: THREE.Texture, aspect: number, h: number) => {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.scale.set(h * aspect, h, 1);
    s.renderOrder = 20;
    return s;
  };
  const pillSprite = (text: string, tone: Parameters<typeof pill>[1], h: number, icon?: Parameters<typeof pill>[3]) => {
    const p = pill(text, tone, tone === "desk" || tone === "navy" ? 700 : 600, icon);
    return sprite(p.tex, p.aspect, h);
  };
  const plane = (tex: THREE.Texture, w: number, h: number, order = 5) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.renderOrder = order;
    return { m, mat };
  };

  // ── The invoice: white paper on a thin teal-edged card.
  const PW = 2.45;
  const PH = (PW * TH) / TW;
  const paper = add(new THREE.Group());
  paper.position.set(0, narrow ? -0.2 : 0.1, 0);
  const cardGeo = new THREE.BoxGeometry(PW + 0.1, PH + 0.1, 0.1);
  const card = add(
    new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({ color: "#0a2547", metalness: 0.3, roughness: 0.5, transparent: true, opacity: 0.95 })),
    paper,
  );
  card.position.z = -0.06;
  const cardEdges = add(
    new THREE.LineSegments(new THREE.EdgesGeometry(cardGeo), new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.75, toneMapped: false })),
    card,
  );
  cardEdges.renderOrder = 1;
  const sheen = add(glowSprite(COLORS.teal, 1, 0.16), paper);
  sheen.position.set(0, PH * 0.3, 0.01);
  sheen.scale.set(PW * 1.1, PH * 0.6, 1);
  const face = add(
    new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: paperTexture(), transparent: true, toneMapped: false, depthWrite: false })),
    paper,
  );
  face.position.z = 0.001;
  const back = add(glowSprite(COLORS.teal, 1, 0.45));
  back.position.set(0, 0, -1.2);
  back.scale.set(6, 5.5, 1);

  const P = (px: number, py: number, z = 0.01) =>
    new THREE.Vector3((px / TW - 0.5) * PW, (0.5 - py / TH) * PH, z).add(paper.position);

  // ── Sources.
  const sx = PW / 2 + 0.12;
  const topY = PH / 2 + paper.position.y + 0.38;
  const priceList = add(pillSprite("Price list", "navy", narrow ? 0.28 : 0.3, "plan"));
  const desk = add(pillSprite("Front desk", "desk", narrow ? 0.28 : 0.3));
  if (narrow) {
    priceList.center.set(0, 0.5);
    priceList.position.set(-PW / 2, topY, 0.3);
    desk.center.set(1, 0.5);
    desk.position.set(PW / 2, topY, 0.3);
  } else {
    priceList.center.set(1, 0.5);
    priceList.position.set(-sx, 0.95, 0.3);
    desk.center.set(0, 0.5);
    desk.position.set(sx, -0.35, 0.3);
  }
  const srcOf = (s: THREE.Sprite) => {
    const w = s.scale.x;
    return s.position.clone().add(new THREE.Vector3((0.5 - s.center.x) * w, 0, 0));
  };
  const fromPrice = srcOf(priceList);
  const fromDesk = srcOf(desk);

  // ── Bill lines.
  const rw = (ROW_W / TW) * PW;
  const rh = (ROW_H / TH) * PH;
  const TILE_D = 0.06;
  const rowGeo = tileGeometry(rw, rh, TILE_D);
  const rows = ITEMS.map((it, i) => {
    const grp = add(new THREE.Group());
    const tileMat = new THREE.MeshStandardMaterial({ color: "#123f70", metalness: 0.35, roughness: 0.35, emissive: "#0b2a55", emissiveIntensity: 0.45, transparent: true, opacity: 0 });
    add(new THREE.Mesh(rowGeo, tileMat), grp);
    const edgeMat = new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false });
    add(new THREE.LineSegments(new THREE.EdgesGeometry(rowGeo, 30), edgeMat), grp);
    const before = plane(rowTexture(it, false), rw, rh, 6);
    add(before.m, grp).position.z = TILE_D + 0.016;
    const after = it.disc ? plane(rowTexture(it, true), rw, rh, 7) : null;
    if (after) add(after.m, grp).position.z = TILE_D + 0.017;
    const slot = P(ROW_X + ROW_W / 2, ROW_Y(i) + ROW_H / 2, 0.005);
    const flash = add(glowSprite(COLORS.tealGlow, 1, 0));
    flash.scale.set(rw * 1.2, rh * 2.4, 1);
    flash.position.copy(slot);
    return { i, grp, tileMat, edgeMat, before, after, slot, flash };
  });

  // Discount approval.
  const procRow = rows[1];
  const chipH = narrow ? 0.24 : 0.25;
  const waitChip = add(pillSprite("Discount awaiting approval", "warn", chipH, "dot"));
  const okChip = add(pillSprite("Approved by Dr. Sana Malik", "ok", chipH));
  for (const c of [waitChip, okChip]) {
    c.center.set(1, 0.5);
    c.position.set(PW / 2 + (narrow ? 0.05 : 0.45), procRow.slot.y - rh * 0.95, 0.4);
  }

  // Summary rows.
  const sw = rw;
  const sh = (SUM_H / TH) * PH;
  const sums = [
    { tex: sumTexture("Discounts", `−${n(DISC)}`, "mute"), at: T_SUM },
    { tex: sumTexture("Total", `Rs ${n(TOTAL)}`, "bold"), at: T_SUM + 0.35 },
    { tex: sumTexture("Paid · cash", n(PAID), "mute"), at: T_PAID },
    { tex: sumTexture("Balance due", `Rs ${n(TOTAL - PAID)}`, "due"), at: T_PAID + 0.4 },
  ].map((s, k) => {
    const p = plane(s.tex, sw, sh, 6);
    add(p.m);
    const pos = P(ROW_X + ROW_W / 2, SUM_Y(k) + SUM_H / 2, 0.02);
    p.m.position.copy(pos);
    return { ...s, p, pos };
  });

  // Cash, from the front desk to the "paid" row.
  const cash = add(pillSprite(`Cash · Rs ${n(PAID)}`, "ok", narrow ? 0.24 : 0.26, "bill"));
  const cashTo = sums[2].pos.clone().setZ(0.3);

  // The stamp.
  const st = stampTexture();
  const STAMP_H = 0.32;
  const stamp = add(sprite(st.tex, st.aspect, STAMP_H));
  // In the clear space under the balance due, right-aligned and fully inside the invoice.
  stamp.position.copy(P(TW - 48 - (STAMP_H * st.aspect * TW) / PW / 2, 742, 0.3));
  (stamp.material as THREE.SpriteMaterial).rotation = 0.08;

  // Print options.
  const prints = [
    { label: "Thermal", icon: "bill" as const },
    { label: "A5", icon: "note" as const },
    { label: "A4", icon: "note" as const },
  ].map((o, k) => {
    const s = add(pillSprite(o.label, "navy", narrow ? 0.26 : 0.27, o.icon));
    const x = (k - 1) * (narrow ? 0.86 : 0.92);
    s.position.set(x, paper.position.y - PH / 2 - 0.36, 0.3);
    const g = add(glowSprite(COLORS.tealGlow, 1, 0));
    g.position.copy(s.position).setZ(0.1);
    g.scale.set(s.scale.x * 1.6, 0.9, 1);
    return { s, g, base: { x: s.scale.x, y: s.scale.y } };
  });

  const tmp = new THREE.Vector3();
  const setOp = (s: THREE.Sprite, v: number) => ((s.material as THREE.SpriteMaterial).opacity = v);

  return {
    update(time, px, py) {
      const t = time % CYCLE;
      const out = 1 - win(t, T_OUT, CYCLE - 0.2);

      setOp(priceList, out);
      setOp(desk, out);

      // Lines fly from the price list and land on the bill.
      for (const r of rows) {
        const s = T_ITEM(r.i);
        const u = ease(win(t, s, s + FLY));
        const vis = win(t, s - 0.05, s + 0.12) * out;
        tmp.lerpVectors(fromPrice, r.slot, u);
        tmp.z += Math.sin(u * Math.PI) * 0.9;
        tmp.y += Math.sin(u * Math.PI) * 0.25;
        r.grp.position.copy(tmp);
        r.grp.scale.setScalar(lerp(0.55, 1, u));
        r.grp.rotation.y = (1 - u) * 0.5;
        r.tileMat.opacity = 0.95 * vis;
        r.edgeMat.opacity = 0.55 * vis;
        const approved = r.after ? win(t, T_OK, T_OK + 0.3) : 0;
        r.before.mat.opacity = vis * (1 - approved);
        if (r.after) r.after.mat.opacity = vis * approved;
        setOp(r.flash, 0.55 * (win(t, s + FLY - 0.1, s + FLY) - win(t, s + FLY, s + FLY + 0.5)) * out);
      }

      // The procedure's discount waits for approval, then counts.
      const w = win(t, T_WAIT, T_WAIT + 0.3) * (1 - win(t, T_OK, T_OK + 0.25));
      setOp(waitChip, w * out);
      const ok = win(t, T_OK, T_OK + 0.25) * (1 - win(t, T_OK + 1.6, T_OK + 2.0));
      setOp(okChip, ok * out);
      waitChip.position.x = PW / 2 + (narrow ? 0.05 : 0.45) + 0.1 * (1 - win(t, T_WAIT, T_WAIT + 0.3));
      setOp(procRow.flash, Math.max((procRow.flash.material as THREE.SpriteMaterial).opacity, 0.5 * win(t, T_OK, T_OK + 0.1) * (1 - win(t, T_OK + 0.1, T_OK + 0.6)) * out));

      // Totals.
      for (const s of sums) {
        const a = ease(win(t, s.at, s.at + 0.35));
        s.p.mat.opacity = a * out;
        s.p.m.position.x = s.pos.x - 0.2 * (1 - a);
      }

      // Cash arrives.
      const cu = ease(win(t, T_CASH, T_CASH + 0.8));
      const cv = win(t, T_CASH - 0.05, T_CASH + 0.1) * (1 - win(t, T_CASH + 0.75, T_CASH + 0.95));
      tmp.lerpVectors(fromDesk, cashTo, cu);
      tmp.z += Math.sin(cu * Math.PI) * 0.7;
      cash.position.copy(tmp);
      setOp(cash, cv * out);

      // The stamp lands.
      const su = win(t, T_STAMP, T_STAMP + 0.25);
      const ss = lerp(1.7, 1, ease(su));
      stamp.scale.set(STAMP_H * st.aspect * ss, STAMP_H * ss, 1);
      setOp(stamp, su * 0.92 * out);

      // Print options light up in turn.
      prints.forEach((p, k) => {
        const a = win(t, T_PRINT + k * 0.7, T_PRINT + k * 0.7 + 0.25) * (1 - win(t, T_PRINT + k * 0.7 + 0.9, T_PRINT + k * 0.7 + 1.2));
        setOp(p.s, (0.55 + 0.45 * Math.max(a, win(t, T_PRINT + 2.4, T_PRINT + 2.7))) * out);
        p.s.scale.set(p.base.x * (1 + 0.12 * a), p.base.y * (1 + 0.12 * a), 1);
        setOp(p.g, a * 0.7 * out);
      });

      root.rotation.y = lerp(root.rotation.y, -0.16 + px * 0.14, 0.05);
      root.rotation.x = lerp(root.rotation.x, 0.06 - py * 0.06, 0.05);
      paper.position.y = (narrow ? -0.2 : 0.1) + Math.sin(time * 0.9) * 0.03;
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
  const narrow = useThree((s) => s.size.width < NARROW_CANVAS);
  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    const built = build(root, narrow);
    api.current = built;
    requestAnimationFrame(() => readyRef.current());
    return () => {
      api.current = null;
      built.dispose();
      root.clear();
    };
  }, [narrow]);
  useFrame(({ clock, pointer }) => api.current?.update(clock.elapsedTime, pointer.x, pointer.y));
  return <group ref={holder} />;
}

export default function BillingHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.25, 2])}
      camera={{ position: [0, 0, 7.6], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} />
      <NarrowFit span={0.8} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
