"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { PNL } from "../mockups/finance";
import { NARROW_CANVAS, capDpr } from "../story/webgl";
import { COLORS, NarrowFit, disposeDeep, glowTexture, lerp, siteFont } from "./scene-kit";
import { canvas2d, pill, texOf } from "./scene-ui";

/**
 * Clinic analytics hero: "what it earned, and what it actually kept", as a 3D
 * profit-and-loss waterfall on a dark glass plate. Sales grow from the month's bills;
 * then discounts, doctor shares and expenses lift off the top of sales one by one and
 * slide out to hang in their own columns; what is left rises as net profit.
 * The figures are the same illustrative sample used by the page's charts (mockups/finance).
 * Loops every CYCLE seconds.
 */

const CYCLE = 12;
const MAX = 1600; // Rs thousands, the chart's top
const BASE_Y = -1.3;
const T_SALES: [number, number] = [0.3, 2.0];
const T_DED = (k: number) => 2.4 + (k - 1) * 1.15; // k = 1..3
const DED_DUR = 0.85;
const T_NET: [number, number] = [5.9, 7.0];
const T_OUT = CYCLE - 1.0;

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `Rs ${(Math.round(a / 10) / 100).toFixed(2)}M` : `Rs ${a}k`;
  return v < 0 ? `−${s}` : s;
};

/** Plain text, one or more lines, centred. */
function textTex(text: string, color: string, weight: number, px = 40) {
  const font = siteFont();
  const lines = text.split("\n");
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `${weight} ${px}px ${font}`;
  const W = Math.ceil(Math.max(...lines.map((l) => m.measureText(l).width)) + 20);
  const lh = Math.round(px * 1.25);
  const H = lines.length * lh + 10;
  const { c, g } = canvas2d(W, H);
  g.font = `${weight} ${px}px ${font}`;
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, W / 2, 5 + lh * (i + 0.5)));
  return { tex: texOf(c), aspect: W / H, lines: lines.length };
}

/** A scale value on the chart's guide lines: bright text in a small dark tag. */
function gridTag(text: string) {
  const font = siteFont();
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `700 34px ${font}`;
  const W = Math.ceil(m.measureText(text).width + 36);
  const H = 52;
  const { c, g } = canvas2d(W, H);
  g.fillStyle = "rgba(6,29,61,0.92)";
  g.beginPath();
  g.roundRect(2, 2, W - 4, H - 4, 14);
  g.fill();
  g.strokeStyle = "rgba(95,224,228,0.45)";
  g.lineWidth = 2;
  g.stroke();
  g.font = `700 34px ${font}`;
  g.fillStyle = "#e2e8f0";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, W / 2, H / 2 + 1);
  return { tex: texOf(c), aspect: W / H };
}

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
  const text = (t: string, color: string, weight: number, lineH: number) => {
    const tt = textTex(t, color, weight);
    return sprite(tt.tex, tt.aspect, lineH * tt.lines);
  };

  // ── Layout
  const N = PNL.length;
  const gap = narrow ? 0.84 : 1.0;
  const BW = narrow ? 0.56 : 0.62;
  const BD = 0.5;
  const U = 2.5 / MAX; // world units per Rs thousand
  const colX = (i: number) => (i - (N - 1) / 2) * gap;
  const plateW = gap * (N - 1) + BW + 0.7;
  const plateD = 1.5;

  // ── The plate: dark glass with a teal edge.
  const plateGeo = new THREE.BoxGeometry(plateW, 0.1, plateD);
  const plate = add(
    new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: "#0a2547", metalness: 0.3, roughness: 0.45, transparent: true, opacity: 0.95 })),
  );
  plate.position.set(0, BASE_Y - 0.05, 0);
  const plateEdges = add(
    new THREE.LineSegments(new THREE.EdgesGeometry(plateGeo), new THREE.LineBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.7, toneMapped: false })),
    plate,
  );
  plateEdges.renderOrder = 1;
  const underGlow = add(glowSprite(COLORS.teal, 1, 0.45));
  underGlow.position.set(0, BASE_Y - 0.2, -0.6);
  underGlow.scale.set(plateW * 1.5, 2.2, 1);

  // Guide lines behind the bars, every Rs 0.5M, each with its value in a small tag just
  // left of the plate, where no bar can cover it.
  const gridX = -plateW / 2 - 0.08;
  [500, 1000, 1500].forEach((v) => {
    const y = BASE_Y + v * U;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(gridX, y, -BD), new THREE.Vector3(plateW / 2 - 0.1, y, -BD)]);
    add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#5fe0e4", transparent: true, opacity: 0.26, toneMapped: false })));
    const gt = gridTag(money(v));
    const tag = add(sprite(gt.tex, gt.aspect, narrow ? 0.2 : 0.18));
    tag.center.set(1, 0.5);
    tag.position.set(gridX, y, -BD);
    (tag.material as THREE.SpriteMaterial).opacity = 1;
  });

  // ── Bars
  const barMat = (color: string, emissive = 0.35, opacity = 0.9) =>
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: emissive, metalness: 0.25, roughness: 0.3, transparent: true, opacity });
  const unitBox = new THREE.BoxGeometry(BW, 1, BD);
  unitBox.translate(0, 0.5, 0);
  const unitEdges = new THREE.EdgesGeometry(unitBox);
  /** A column that grows from the plate: scale.y is its height. */
  const growBar = (i: number, color: string, edge: string) => {
    const mat = barMat(color);
    const mesh = add(new THREE.Mesh(unitBox, mat));
    mesh.position.set(colX(i), BASE_Y, 0);
    mesh.scale.y = 0.0001;
    const edgeMat = new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.9, toneMapped: false });
    add(new THREE.LineSegments(unitEdges, edgeMat), mesh);
    return { mesh, mat, edgeMat };
  };

  const valueH = narrow ? 0.25 : 0.19;
  const nameH = narrow ? 0.19 : 0.15;
  const columns = PNL.map((p, i) => {
    const name = add(text(narrow && p.k === "Doctor shares" ? "Doctor\nshares" : p.k, p.kind === "result" ? COLORS.tealGlow : "#9fb3c8", 600, nameH));
    name.position.set(colX(i), BASE_Y - 0.2 - (name.scale.y - nameH) / 2, plateD / 2);
    const value = add(text(money(p.v), p.kind === "neg" ? "#fda4af" : p.kind === "result" ? COLORS.tealGlow : "#ffffff", 700, valueH));
    return { p, i, name, value };
  });

  // Sales.
  const salesV = PNL[0].v;
  const sales = growBar(0, COLORS.teal, COLORS.tealGlow);

  // Deductions: each lifts off the top of the running total and slides to its column.
  let running = salesV;
  const deds = PNL.slice(1, N - 1).map((p, j) => {
    const k = j + 1;
    const h = Math.abs(p.v) * U;
    const topV = running;
    running += p.v;
    const mat = barMat("#fb7185", 0.3, 0.82);
    const geo = new THREE.BoxGeometry(BW, h, BD);
    const mesh = add(new THREE.Mesh(geo, mat));
    const y = BASE_Y + (topV * U) - h / 2;
    mesh.position.set(colX(0), y, 0);
    const edgeMat = new THREE.LineBasicMaterial({ color: "#fecdd3", transparent: true, opacity: 0, toneMapped: false });
    add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat), mesh);
    // A dashed step line from the previous column's top to this block's top.
    const topY = BASE_Y + topV * U;
    const step = add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(colX(k - 1) + BW / 2, topY, 0), new THREE.Vector3(colX(k) - BW / 2, topY, 0)]),
        new THREE.LineDashedMaterial({ color: "#9fb3c8", dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0, toneMapped: false }),
      ),
    );
    step.computeLineDistances();
    const flash = add(glowSprite("#fb7185", 1, 0));
    flash.scale.set(BW * 2.2, h + 0.5, 1);
    return { k, p, mesh, mat, edgeMat, y, step, flash, topY };
  });

  // Net profit.
  const netV = PNL[N - 1].v;
  const net = growBar(N - 1, COLORS.tealGlow, "#ccfbf1");
  net.mat.emissiveIntensity = 0.55;
  const netStep = add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(colX(N - 2) + BW / 2, BASE_Y + netV * U, 0),
        new THREE.Vector3(colX(N - 1) - BW / 2, BASE_Y + netV * U, 0),
      ]),
      new THREE.LineDashedMaterial({ color: "#9fb3c8", dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0, toneMapped: false }),
    ),
  );
  netStep.computeLineDistances();
  const netHalo = add(new THREE.Mesh(new THREE.RingGeometry(0.45, 0.5, 64), new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })));
  netHalo.rotation.x = -Math.PI / 2;
  netHalo.position.set(colX(N - 1), BASE_Y + 0.005, 0);
  const netGlow = add(glowSprite(COLORS.tealGlow, 1, 0));
  netGlow.scale.set(2.2, 2.2, 1);
  const kept = pill("What the clinic kept", "ok", 600, "check");
  const keptH = narrow ? 0.28 : 0.24;
  const keptChip = add(sprite(kept.tex, kept.aspect, keptH));
  keptChip.center.set(narrow ? 0.72 : 0.62, 0.5);

  // Title pill.
  const title = pill("Profit & loss · November", "navy", 600, "owner");
  const titleChip = add(sprite(title.tex, title.aspect, narrow ? 0.3 : 0.26));
  titleChip.position.set(0, BASE_Y + MAX * U + 0.5, -0.2);

  // Motes that carry the month's bills up into sales.
  const motes = Array.from({ length: 18 }, (_, i) => {
    const s = add(glowSprite(COLORS.tealGlow, 0.08 + (i % 3) * 0.03, 0));
    return { s, ph: (i * 0.618) % 1, ox: ((i * 0.37) % 1) - 0.5, oz: ((i * 0.71) % 1) - 0.5 };
  });

  return {
    update(time, px, py) {
      const t = time % CYCLE;
      const out = 1 - win(t, T_OUT, CYCLE - 0.2);

      // Sales grows from the bills.
      const sg = ease(win(t, T_SALES[0], T_SALES[1]));
      sales.mesh.scale.y = Math.max(0.0001, sg * salesV * U);
      sales.mesh.visible = sg > 0.001;
      sales.mat.opacity = 0.9 * out;
      sales.edgeMat.opacity = 0.9 * out * (sg > 0 ? 1 : 0);
      const growing = t > T_SALES[0] && t < T_SALES[1] + 0.3 ? 1 : 0;
      for (const m of motes) {
        const u = (time * 0.9 + m.ph) % 1;
        const top = sg * salesV * U;
        m.s.position.set(colX(0) + m.ox * BW * 1.4, BASE_Y - 0.3 + u * (top + 0.4), m.oz * BD * 1.4);
        (m.s.material as THREE.SpriteMaterial).opacity = growing * Math.sin(u * Math.PI) * 0.8;
      }

      // Name labels stay; values arrive with their bars.
      for (const c of columns) (c.name.material as THREE.SpriteMaterial).opacity = 0.95 * out;
      const salesTop = BASE_Y + sg * salesV * U;
      columns[0].value.position.set(colX(0), salesTop + 0.2, 0);
      (columns[0].value.material as THREE.SpriteMaterial).opacity = win(t, T_SALES[1] - 0.4, T_SALES[1]) * out;

      // Deductions.
      for (const d of deds) {
        const s = T_DED(d.k);
        const u = ease(win(t, s, s + DED_DUR));
        const vis = win(t, s - 0.1, s + 0.05) * out;
        d.mesh.position.x = lerp(colX(0), colX(d.k), u);
        d.mesh.position.z = Math.sin(u * Math.PI) * 0.55;
        d.mesh.position.y = d.y + Math.sin(u * Math.PI) * 0.12;
        d.mat.opacity = 0.82 * vis;
        d.mat.emissiveIntensity = 0.3 + 0.9 * (1 - win(t, s, s + 0.5));
        d.edgeMat.opacity = 0.9 * vis;
        (d.flash.material as THREE.SpriteMaterial).opacity = vis * 0.6 * (1 - win(t, s, s + 0.6));
        d.flash.position.copy(d.mesh.position);
        const landed = win(t, s + DED_DUR - 0.25, s + DED_DUR + 0.1) * out;
        (d.step.material as THREE.LineDashedMaterial).opacity = 0.7 * landed;
        const v = columns[d.k].value;
        v.position.set(colX(d.k), d.topY + 0.2, 0);
        (v.material as THREE.SpriteMaterial).opacity = landed;
      }

      // Net profit rises from what is left.
      const ng = ease(win(t, T_NET[0], T_NET[1]));
      net.mesh.scale.y = Math.max(0.0001, ng * netV * U);
      net.mesh.visible = ng > 0.001;
      net.mat.opacity = 0.92 * out;
      net.edgeMat.opacity = 0.95 * out * (ng > 0 ? 1 : 0);
      (netStep.material as THREE.LineDashedMaterial).opacity = 0.7 * win(t, T_NET[0] - 0.3, T_NET[0]) * out;
      const netTop = BASE_Y + ng * netV * U;
      const nv = columns[N - 1].value;
      nv.position.set(colX(N - 1), netTop + 0.2, 0);
      (nv.material as THREE.SpriteMaterial).opacity = win(t, T_NET[1] - 0.3, T_NET[1]) * out;
      const done = win(t, T_NET[1], T_NET[1] + 0.4) * out;
      const pulse = (time * 0.8) % 1;
      netHalo.scale.setScalar(1 + pulse * 1.4);
      (netHalo.material as THREE.MeshBasicMaterial).opacity = done * 0.7 * (1 - pulse);
      netGlow.position.set(colX(N - 1), netTop - (netV * U) / 2, -0.7);
      (netGlow.material as THREE.SpriteMaterial).opacity = done * (0.35 + 0.15 * Math.sin(time * 3));
      keptChip.position.set(colX(N - 1), netTop + 0.56 + 0.08 * (1 - done), 0.2);
      (keptChip.material as THREE.SpriteMaterial).opacity = done;
      (titleChip.material as THREE.SpriteMaterial).opacity = out;

      root.rotation.y = lerp(root.rotation.y, -0.3 + px * 0.12, 0.05);
      root.rotation.x = lerp(root.rotation.x, 0.16 - py * 0.05, 0.05);
    },
    dispose() {
      disposeDeep(root);
      unitBox.dispose();
      unitEdges.dispose();
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

export default function AnalyticsHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.25, 2])}
      camera={{ position: [0, 0.35, 7.6], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} />
      <NarrowFit span={1.12} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
