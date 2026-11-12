"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { WHATSAPP_GREEN } from "../contact/whatsapp-icon";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont } from "./scene-kit";

/**
 * Platform hero: a living honeycomb — the hexagon of the FlexicaAI mark, repeated into
 * one floor. The core hex at the centre sends rings of light across the whole floor;
 * six raised tiles are the platform's areas, and pulses run to them from the core.
 * The pointer lifts the tiles beneath it.
 */

const R = 0.5; // hex radius
const ROWS = 9; // rows each side of centre
const COLS = 11;
const SQ3 = Math.sqrt(3);

type Icon = "calendar" | "person" | "chat" | "mic" | "receipt" | "chart" | "cash" | "file" | "rx" | "bell" | "shield" | "log";
type Area = { label: string; icon: Icon; q: number; r: number; color: string };

const axial = (q: number, r: number) => [SQ3 * R * (q + r / 2), 1.5 * R * r] as const;
/** The hex cell nearest a point on the floor. */
function cellAt(x: number, z: number) {
  const rf = z / (1.5 * R);
  const qf = x / (SQ3 * R) - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r] as const;
}

// The platform's areas (all from the features page), evenly round the core.
const LIST: [string, Icon][] = [
  ["Appointments", "calendar"],
  ["Patients", "person"],
  ["Prescriptions", "rx"],
  ["Petty cash", "cash"],
  ["Recalls", "bell"],
  ["Billing", "receipt"],
  ["AI Scribe", "mic"],
  ["Reports", "file"],
  ["Analytics", "chart"],
  ["Activity log", "log"],
  ["Permissions", "shield"],
  ["WhatsApp", "chat"],
];
const RX = 4.3; // a wide oval reads better from the camera than a circle
const RZ = 3.2;
const AREAS: Area[] = LIST.map(([label, icon], i) => {
  const a = (i / LIST.length) * Math.PI * 2 - Math.PI / 2;
  const [q, r] = cellAt(Math.cos(a) * RX, Math.sin(a) * RZ);
  return { label, icon, q, r, color: icon === "chat" ? WHATSAPP_GREEN : COLORS.tealGlow };
});

function drawIcon(g: CanvasRenderingContext2D, icon: Area["icon"], cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx - s / 2, cy - s / 2);
  g.scale(s / 24, s / 24);
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  const P = (d: string) => g.stroke(new Path2D(d));
  switch (icon) {
    case "calendar":
      P("M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z");
      P("M3 10h18M8 3v4M16 3v4");
      P("M8 14h2M12 14h2M16 14h0.5M8 17h2");
      break;
    case "person":
      P("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z");
      P("M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5");
      break;
    case "chat":
      P("M12 3.5c-4.7 0-8.5 3.6-8.5 8 0 1.5.4 2.9 1.2 4.1L3.5 20.5l4.6-1.2c1.2.6 2.5.9 3.9.9 4.7 0 8.5-3.6 8.5-8s-3.8-8.7-8.5-8.7z");
      break;
    case "mic":
      P("M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z");
      P("M19 11a7 7 0 0 1-14 0M12 18v3");
      break;
    case "receipt":
      P("M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z");
      P("M9 8h6M9 12h6M9 16h3");
      break;
    case "chart":
      P("M4 20h16");
      P("M7 16v-4M12 16V8M17 16v-7");
      break;
    case "cash":
      P("M3 7h18v10H3z");
      P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 10v4M18 10v4");
      break;
    case "file":
      P("M6 3h8l4 4v14H6z");
      P("M14 3v4h4M9 12h6M9 16h6");
      break;
    case "rx":
      P("M6 3h12v18H6z");
      P("M9 7h3.5a2 2 0 0 1 0 4H9V7zM9 11v5M11.5 11l4 5M15.5 11l-4 5");
      break;
    case "bell":
      P("M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z");
      P("M10 20a2 2 0 0 0 4 0");
      break;
    case "shield":
      P("M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z");
      P("M9 12l2 2 4-4");
      break;
    case "log":
      P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z");
      P("M12 7v5l3 2");
      break;
  }
  g.restore();
}

function cardTexture(a: Area) {
  const c = document.createElement("canvas");
  c.width = 360;
  c.height = 300;
  const g = c.getContext("2d")!;
  const font = siteFont();
  g.fillStyle = "rgba(9,36,74,0.88)";
  g.beginPath();
  g.roundRect(6, 6, 348, 288, 40);
  g.fill();
  g.strokeStyle = a.color + "aa";
  g.lineWidth = 4;
  g.stroke();
  g.fillStyle = a.color + "33";
  g.beginPath();
  g.arc(180, 112, 66, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = a.color;
  drawIcon(g, a.icon, 180, 112, 76);
  g.fillStyle = "#ffffff";
  g.font = `650 40px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(a.label, 180, 232);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

type Api = { update: (t: number, px: number, py: number, camera: THREE.Camera) => void; dispose: () => void };

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);

  // ── Honeycomb floor (one instanced mesh).
  const cells: { x: number; z: number; d: number; area: number }[] = [];
  for (let r = -ROWS; r <= ROWS; r++)
    for (let q = -COLS - Math.ceil(r / 2); q <= COLS - Math.floor(r / 2); q++) {
      const [x, z] = axial(q, r);
      if (Math.abs(x) > 10.5) continue;
      const area = AREAS.findIndex((a) => a.q === q && a.r === r);
      cells.push({ x, z, d: Math.hypot(x, z), area: q === 0 && r === 0 ? -2 : area });
    }
  const geo = new THREE.CylinderGeometry(R * 0.93, R * 0.93, 1, 6);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.35, metalness: 0.35 });
  const floor = new THREE.InstancedMesh(geo, mat, cells.length);
  root.add(floor);
  const dummy = new THREE.Object3D();
  const navy = new THREE.Color("#0b2a52");
  const deep = new THREE.Color("#061a35");
  const teal = new THREE.Color(COLORS.teal);
  const glowC = new THREE.Color(COLORS.tealGlow);
  const col = new THREE.Color();
  const heights = new Float32Array(cells.length);

  // ── Core: the centre hex carries the mark.
  const markMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), markMat);
  mark.rotation.x = -Math.PI / 2;
  root.add(mark);
  loadLogoMark((tex) => {
    markMat.map = tex;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
  });
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
  coreGlow.scale.set(3.2, 3.2, 1);
  root.add(coreGlow);

  // ── Area cards floating over their tiles, and pulses running to them.
  const areas = AREAS.map((a) => {
    const [x, z] = axial(a.q, a.r);
    const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardTexture(a), transparent: true, depthWrite: false, toneMapped: false }));
    card.scale.set(1.3, 1.08, 1);
    root.add(card);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(a.color), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.6, 1.6, 1);
    root.add(halo);
    const pulses = [0].map((k) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: a.color, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      s.scale.set(0.38, 0.38, 1);
      root.add(s);
      return { s, phase: k };
    });
    return { a, x, z, card, halo, pulses, i: AREAS.indexOf(a) };
  });

  // Pointer → floor.
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3);
  const hit = new THREE.Vector3(999, 0, 999);
  const ndc = new THREE.Vector2();
  const mouse = new THREE.Vector3(999, 0, 999);

  return {
    update(t, px, py, camera) {
      ndc.set(px, py);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) mouse.lerp(hit, 0.15);

      // Rings of light leave the core every 3.2s.
      const ringA = (t * 2.6) % 8.3;
      const ringB = ((t + 1.6) * 2.6) % 8.3;
      let coreH = 0.7;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const wave = 0.1 * Math.sin(c.x * 0.55 + t * 0.9) * Math.cos(c.z * 0.5 + t * 0.6);
        const ring = Math.exp(-((c.d - ringA) ** 2) * 1.6) + 0.6 * Math.exp(-((c.d - ringB) ** 2) * 1.6);
        const md = (c.x - mouse.x) ** 2 + (c.z - mouse.z) ** 2;
        const lift = 0.9 * Math.exp(-md / 1.4);
        let h = 0.22 + wave + ring * 0.28 + lift;
        if (c.area >= 0) h = 0.95 + 0.06 * Math.sin(t * 1.5 + c.area);
        if (c.area === -2) {
          h = 0.7 + 0.05 * Math.sin(t * 2);
          coreH = h;
        }
        heights[i] = h;
        dummy.position.set(c.x, 0, c.z);
        dummy.scale.set(1, h, 1);
        dummy.updateMatrix();
        floor.setMatrixAt(i, dummy.matrix);
        // Colour: deep navy at the edges, teal where light passes or tiles rise.
        const edge = Math.min(1, c.d / 9);
        col.copy(navy).lerp(deep, edge);
        const lit = Math.min(1, ring * 0.9 + lift * 0.8 + Math.max(0, wave) * 0.6);
        col.lerp(teal, lit * 0.8);
        if (c.area >= 0) col.copy(teal).lerp(glowC, 0.25);
        if (c.area === -2) col.set("#0d3b6e");
        floor.setColorAt(i, col);
      }
      floor.instanceMatrix.needsUpdate = true;
      if (floor.instanceColor) floor.instanceColor.needsUpdate = true;

      mark.position.set(0, coreH + 0.01, 0);
      coreGlow.position.set(0, coreH + 0.2, 0);
      (coreGlow.material as THREE.SpriteMaterial).opacity = 0.55 + 0.25 * Math.max(0, Math.sin(t * 2.4));

      for (const ar of areas) {
        const bob = Math.sin(t * 1.4 + ar.x) * 0.06;
        ar.card.position.set(ar.x, 1.85 + bob, ar.z);
        ar.halo.position.set(ar.x, 1.05, ar.z);
        ar.pulses.forEach(({ s, phase }) => {
          const u = (t * 0.4 + phase + ar.i * 0.083) % 1;
          s.position.set(lerp(0, ar.x, u), 0.75 + Math.sin(u * Math.PI) * 0.5, lerp(0, ar.z, u));
          s.scale.setScalar(0.4 * Math.sin(u * Math.PI) + 0.05);
        });
      }

      root.rotation.y = lerp(root.rotation.y, px * 0.08, 0.04);
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
  useFrame(({ clock, pointer, camera }) => {
    api.current?.update(clock.elapsedTime, pointer.x, pointer.y, camera);
  });
  return <group ref={holder} />;
}

export default function PlatformHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1, 1.75])}
      camera={{ position: [0, 9.6, 11.6], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        camera.lookAt(0, 0.9, 0.2);
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[4, 9, 5]} intensity={1.6} />
      <pointLight position={[0, 2.5, 0]} intensity={14} distance={9} color={COLORS.tealGlow} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
