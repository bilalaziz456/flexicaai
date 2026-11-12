"use client";

import { NARROW_CANVAS, capDpr } from "./webgl";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ClinicBus } from "./clinic-bus";

/**
 * A modern clinic, cut away like an architect's model, with jointed people who walk,
 * sit, turn and gesture. One visit, driven entirely by `shared.progress` (0..1 from the
 * section's ScrollTrigger):
 *
 *   0.00–0.30  the patient comes in through the sliding doors and checks in — Arrived
 *   0.30–0.60  into the consultation room; the doctor stands to greet them; they sit
 *   0.60–0.78  the patient leaves, waving to the desk on the way out
 *   0.78–1.00  the doctor dictates into a phone; the AI note drafts on the floating
 *              screen; the doctor reviews it and approves it
 *
 * The canvas renders ON DEMAND: a frame is drawn only when progress changes.
 */

// ─── Motion helpers ──────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 1 inside [a, b], easing in and out over `e` at each end. */
const window01 = (a: number, b: number, x: number, e = 0.02) => sstep(a, a + e, x) * (1 - sstep(b - e, b, x));

/** Piecewise-smooth interpolation through keyed values: [p, ...values]. */
function track(p: number, keys: number[][]): number[] {
  if (p <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (p <= b[0]) {
      const t = sstep(a[0], b[0], p);
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
    }
  }
  return keys[keys.length - 1].slice(1);
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

const dirAt = (walk: number[][], p0: number, p1: number) => {
  const [x0, z0] = track(p0, walk);
  const [x1, z1] = track(p1, walk);
  return Math.atan2(x1 - x0, z1 - z0);
};

/** Facing: the direction of travel, except inside "hold" windows where a set angle wins. */
function headingAt(p: number, walk: number[][], holds: number[][]) {
  for (const [a, b, ang] of holds) {
    if (p >= a && p <= b) {
      let h = lerpAngle(dirAt(walk, a - 0.01, a), ang, sstep(a, a + 0.015, p));
      if (b < 1) h = lerpAngle(h, dirAt(walk, b, b + 0.01), sstep(b - 0.015, b, p));
      return h;
    }
  }
  return dirAt(walk, p - 0.002, p + 0.002);
}

function speedAt(p: number, walk: number[][]) {
  const [x0, z0] = track(p - 0.003, walk);
  const [x1, z1] = track(p + 0.003, walk);
  return clamp01(Math.hypot(x1 - x0, z1 - z0) / 0.12);
}

// ─── The visit ───────────────────────────────────────────────────────────────

// Patient: [p, x, z]
const PATIENT_WALK = [
  [0.0, -9.7, 2.5],
  [0.03, -9.7, 2.5],
  [0.1, -6.2, 2.4],
  [0.17, -3.2, 0.1],
  [0.3, -3.2, 0.1],
  [0.36, 0.0, 0.85],
  [0.4, 1.7, 0.85],
  [0.45, 3.55, -0.55],
  [0.48, 3.72, -1.5],
  [0.5, 4.4, -1.5],
  [0.63, 4.4, -1.5],
  [0.645, 3.72, -1.5],
  [0.66, 3.55, -0.55],
  [0.69, 1.7, 0.85],
  [0.71, -0.5, 0.95],
  [0.745, -5.9, 2.4],
  [0.775, -9.7, 2.6],
];
const PATIENT_HOLDS = [
  [0.0, 0.03, Math.PI / 2],
  [0.17, 0.3, Math.PI],
  [0.48, 0.645, Math.PI],
  [0.775, 1, -Math.PI / 2],
];
const DOCTOR_AT: [number, number] = [4.4, -3.22];
const RECEPTION_AT: [number, number] = [-3.1, -1.62];

// Camera: [p, posX, posY, posZ, lookX, lookY, lookZ]
const CAMERA = [
  [0.0, -1.5, 11.5, 17.5, -0.6, 0, 0],
  [0.05, -12.6, 4.3, 9.8, -7.4, 1.0, 1.9],
  [0.12, -8.6, 4.0, 8.4, -4.8, 1.0, 0.7],
  [0.18, -5.7, 3.5, 6.6, -3.2, 1.1, -0.7],
  [0.29, -5.3, 3.3, 6.1, -3.1, 1.1, -0.8],
  [0.38, 0.6, 6.8, 11.2, 1.8, 0.8, -0.6],
  [0.47, 7.7, 3.9, 5.7, 4.3, 1.0, -2.0],
  [0.58, 7.1, 3.3, 4.7, 4.4, 1.0, -2.1],
  [0.64, 5.2, 6.6, 10.8, 1.0, 0.6, -0.8],
  [0.7, -0.6, 5.8, 10.6, -3.2, 0.8, 0.8],
  [0.765, -3.6, 4.6, 9.4, -6.6, 0.9, 2.2],
  [0.785, -3.6, 4.6, 9.4, -6.6, 0.9, 2.2],
  [0.84, 7.1, 3.7, 4.7, 4.9, 1.45, -2.4],
  [1.0, 6.7, 3.4, 4.1, 4.9, 1.5, -2.45],
];

// ─── Materials & textures ────────────────────────────────────────────────────

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const tones = ["#e9dcc8", "#e4d5bf", "#eadfcd", "#e2d2bb", "#e7d9c4"];
  for (let row = 0; row < 8; row++) {
    let x = -((row * 97) % 180);
    while (x < 512) {
      const w = 180 + ((row * 31 + x) % 90);
      ctx.fillStyle = tones[(row * 3 + Math.abs(x)) % tones.length];
      ctx.fillRect(x, row * 64, w, 64);
      ctx.fillStyle = "rgba(120,90,60,0.10)";
      ctx.fillRect(x, row * 64, 2, 64);
      x += w;
    }
    ctx.fillStyle = "rgba(120,90,60,0.12)";
    ctx.fillRect(0, row * 64, 512, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3.2, 2.4);
  t.anisotropy = 4;
  return t;
}

function useMaterials() {
  const m = useMemo(() => {
    const wood = woodTexture();
    const std = (color: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    return {
      wood,
      floor: std("#ffffff", 0.75, { map: wood }),
      plinth: std("#d6e0ea", 0.9),
      paving: std("#dfe4e9", 0.95),
      wall: std("#fbfcfd", 0.9),
      accent: std("#0d2f57", 0.7),
      white: std("#f4f6f8", 0.55),
      oak: std("#c79f78", 0.6),
      walnut: std("#8a6248", 0.55),
      metal: std("#9aa7b4", 0.35, { metalness: 0.6 }),
      dark: std("#2b3a4a", 0.5),
      fabric: std("#c7d3dc", 0.95),
      sage: std("#a9bfb3", 0.95),
      cushion: std("#0fb4bb", 0.85),
      rug: std("#e3e8ec", 1),
      leaf: std("#5c8f6d", 0.8),
      leafDark: std("#3f7353", 0.8),
      pot: std("#ece6df", 0.7),
      art1: std("#9fd3d6", 0.9),
      art2: std("#f1d9c4", 0.9),
      books: [std("#0b3d6b", 0.7), std("#0fb4bb", 0.7), std("#d9c6ad", 0.7), std("#5d84a8", 0.7)],
      glass: std("#d6eef6", 0.1, { transparent: true, opacity: 0.32, metalness: 0.1, depthWrite: false }),
      frosted: std("#ffffff", 0.6, { transparent: true, opacity: 0.55, depthWrite: false }),
      window: std("#dcf1f8", 0.2, { emissive: "#eaf8fc", emissiveIntensity: 0.55 }),
      teal: std("#0fb4bb", 0.4, { emissive: "#0fb4bb", emissiveIntensity: 0.6 }),
      led: new THREE.MeshBasicMaterial({ color: "#5fe0e4", toneMapped: false }),
      lamp: new THREE.MeshBasicMaterial({ color: "#fff3dc", toneMapped: false }),
      screen: std("#0b2b4f", 0.3, { emissive: "#1f6f9a", emissiveIntensity: 0.6 }),
      ring: new THREE.MeshBasicMaterial({ color: "#0fb4bb", transparent: true, opacity: 0, depthWrite: false }),
      path: new THREE.MeshBasicMaterial({ color: "#0fb4bb", transparent: true, opacity: 0.8, depthWrite: false }),
    };
  }, []);
  useEffect(
    () => () => {
      Object.values(m).forEach((x) => {
        if (Array.isArray(x)) x.forEach((y) => y.dispose());
        else x.dispose();
      });
    },
    [m],
  );
  return m;
}

// ─── Building blocks ─────────────────────────────────────────────────────────

type V3 = [number, number, number];

function RBox({
  size,
  position,
  material,
  rotation,
  radius = 0.03,
  shadow = true,
}: {
  size: V3;
  position: V3;
  material: THREE.Material;
  rotation?: V3;
  radius?: number;
  shadow?: boolean;
}) {
  const [sx, sy, sz] = size;
  const geo = useMemo(() => new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(radius, sx / 2 - 1e-3, sy / 2 - 1e-3, sz / 2 - 1e-3)), [sx, sy, sz, radius]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} position={position} rotation={rotation} material={material} castShadow={shadow} receiveShadow />;
}

function Cyl({ args, position, material, rotation, shadow = true }: { args: [number, number, number, number?]; position: V3; material: THREE.Material; rotation?: V3; shadow?: boolean }) {
  return (
    <mesh position={position} rotation={rotation} material={material} castShadow={shadow} receiveShadow>
      <cylinderGeometry args={[args[0], args[1], args[2], args[3] ?? 24]} />
    </mesh>
  );
}

type M = ReturnType<typeof useMaterials>;

function Plant({ m, position, scale = 1 }: { m: M; position: V3; scale?: number }) {
  const leaves = useMemo(
    () =>
      Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        const tilt = 0.35 + (i % 3) * 0.12;
        return { a, tilt, h: 0.75 + (i % 4) * 0.12, dark: i % 2 === 0 };
      }),
    [],
  );
  return (
    <group position={position} scale={scale}>
      <Cyl args={[0.2, 0.15, 0.42]} position={[0, 0.21, 0]} material={m.pot} />
      {leaves.map(({ a, tilt, h, dark }, i) => (
        <mesh
          key={i}
          position={[Math.sin(a) * 0.12, 0.42 + h * 0.45, Math.cos(a) * 0.12]}
          rotation={[Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]}
          material={dark ? m.leafDark : m.leaf}
          castShadow
        >
          <sphereGeometry args={[0.1, 10, 8]} />
        </mesh>
      ))}
      {leaves.map(({ a, tilt, h, dark }, i) => (
        <mesh
          key={`b${i}`}
          position={[Math.sin(a) * 0.16, 0.42 + h * 0.45, Math.cos(a) * 0.16]}
          rotation={[Math.cos(a) * tilt, a, -Math.sin(a) * tilt]}
          scale={[0.9, h * 2.6, 0.32]}
          material={dark ? m.leaf : m.leafDark}
          castShadow
        >
          <sphereGeometry args={[0.1, 10, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function OfficeChair({ m, position, rotationY = 0 }: { m: M; position: V3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <RBox size={[0.5, 0.08, 0.48]} position={[0, 0.46, 0]} material={m.dark} radius={0.035} />
      <RBox size={[0.48, 0.52, 0.07]} position={[0, 0.8, -0.24]} material={m.dark} radius={0.04} rotation={[-0.08, 0, 0]} />
      <Cyl args={[0.025, 0.025, 0.36]} position={[0, 0.25, 0]} material={m.metal} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return <RBox key={i} size={[0.04, 0.03, 0.3]} position={[Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15]} rotation={[0, a, 0]} material={m.metal} radius={0.01} />;
      })}
    </group>
  );
}

function Armchair({ m, position, rotationY = 0, fabric }: { m: M; position: V3; rotationY?: number; fabric?: THREE.Material }) {
  const f = fabric ?? m.sage;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <RBox size={[0.62, 0.14, 0.56]} position={[0, 0.42, 0.02]} material={f} radius={0.06} />
      <RBox size={[0.62, 0.5, 0.12]} position={[0, 0.7, -0.24]} material={f} radius={0.06} rotation={[-0.1, 0, 0]} />
      <RBox size={[0.09, 0.22, 0.5]} position={[-0.3, 0.56, 0]} material={f} radius={0.04} />
      <RBox size={[0.09, 0.22, 0.5]} position={[0.3, 0.56, 0]} material={f} radius={0.04} />
      {[-0.25, 0.25].flatMap((x) => [-0.2, 0.22].map((z) => <Cyl key={`${x}${z}`} args={[0.018, 0.014, 0.36]} position={[x, 0.18, z]} material={m.walnut} />))}
    </group>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────

type Limb = { upper: THREE.Group; lower: THREE.Group; end: THREE.Group };
type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  arms: [Limb, Limb]; // [right, left]
  legs: [Limb, Limb];
  coat?: THREE.Mesh;
  phone?: THREE.Group;
  waves?: THREE.Mesh[];
  dispose: () => void;
};
type Look = {
  skin: string;
  top: string;
  sleeve?: string;
  bottom: string;
  shoes: string;
  hair: string;
  hairStyle: "short" | "bun" | "long";
  coat?: boolean;
  phone?: boolean;
};

function makePerson(look: Look): Rig {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mat = (color: string, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const x = new THREE.MeshStandardMaterial({ color, roughness, ...extra });
    mats.push(x);
    return x;
  };
  const skin = mat(look.skin, 0.6);
  const top = mat(look.top, 0.8);
  const sleeve = look.sleeve ? mat(look.sleeve, 0.75) : top;
  const bottom = mat(look.bottom, 0.85);
  const shoes = mat(look.shoes, 0.5);
  const hair = mat(look.hair, 0.65);

  const mesh = (geo: THREE.BufferGeometry, material: THREE.Material, pos: V3 = [0, 0, 0], scale?: V3) => {
    const x = new THREE.Mesh(geo, material);
    x.position.set(...pos);
    if (scale) x.scale.set(...scale);
    x.castShadow = true;
    return x;
  };
  const group = (pos: V3 = [0, 0, 0]) => {
    const x = new THREE.Group();
    x.position.set(...pos);
    return x;
  };

  const root = group();
  const body = group();
  root.add(body);
  const pelvis = group([0, 0.93, 0]);
  body.add(pelvis);
  pelvis.add(mesh(g(new THREE.SphereGeometry(0.15, 18, 12)), bottom, [0, 0, 0], [1.1, 0.72, 0.82]));

  // Legs
  const thighGeo = g(new THREE.CapsuleGeometry(0.075, 0.3, 4, 12));
  const shinGeo = g(new THREE.CapsuleGeometry(0.058, 0.32, 4, 12));
  const shoeGeo = g(new RoundedBoxGeometry(0.11, 0.075, 0.25, 2, 0.03));
  const legs = [-1, 1].map((side) => {
    const upper = group([side * 0.09, 0, 0]);
    upper.add(mesh(thighGeo, bottom, [0, -0.22, 0]));
    const lower = group([0, -0.44, 0]);
    lower.add(mesh(shinGeo, bottom, [0, -0.21, 0]));
    const end = group([0, -0.43, 0]);
    end.add(mesh(shoeGeo, shoes, [0, -0.02, 0.045]));
    lower.add(end);
    upper.add(lower);
    pelvis.add(upper);
    return { upper, lower, end };
  }) as [Limb, Limb];

  // Torso
  const chest = group([0, 0.02, 0]);
  pelvis.add(chest);
  chest.add(mesh(g(new THREE.CapsuleGeometry(0.155, 0.28, 6, 16)), top, [0, 0.27, 0], [1.12, 1, 0.72]));

  // Neck and head
  const neck = group([0, 0.5, 0]);
  chest.add(neck);
  neck.add(mesh(g(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12)), skin, [0, 0.03, 0]));
  const head = group([0, 0.09, 0]);
  neck.add(head);
  head.add(mesh(g(new THREE.SphereGeometry(0.105, 24, 18)), skin, [0, 0.09, 0.005], [0.9, 1.12, 1]));
  head.add(mesh(g(new THREE.SphereGeometry(0.02, 8, 6)), skin, [0, 0.075, 0.1], [0.8, 1.2, 1]));
  const earGeo = g(new THREE.SphereGeometry(0.022, 8, 6));
  head.add(mesh(earGeo, skin, [0.094, 0.085, 0], [0.5, 1, 0.8]));
  head.add(mesh(earGeo, skin, [-0.094, 0.085, 0], [0.5, 1, 0.8]));
  const cap = g(new THREE.SphereGeometry(0.113, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56));
  const capMesh = mesh(cap, hair, [0, 0.1, -0.02], [0.94, 1.08, 1.04]);
  capMesh.rotation.x = -0.45;
  head.add(capMesh);
  if (look.hairStyle === "bun") head.add(mesh(g(new THREE.SphereGeometry(0.055, 14, 10)), hair, [0, 0.16, -0.1]));
  if (look.hairStyle === "long") {
    head.add(mesh(g(new THREE.CapsuleGeometry(0.095, 0.2, 4, 14)), hair, [0, -0.02, -0.05], [1.05, 1, 0.6]));
  }

  // Arms: [right (−x), left (+x)] — the figure faces +z.
  const upperArmGeo = g(new THREE.CapsuleGeometry(0.05, 0.22, 4, 12));
  const foreGeo = g(new THREE.CapsuleGeometry(0.043, 0.2, 4, 12));
  const handGeo = g(new THREE.SphereGeometry(0.045, 12, 10));
  const arms = [-1, 1].map((side) => {
    const upper = group([side * 0.215, 0.45, 0]);
    upper.add(mesh(upperArmGeo, sleeve, [0, -0.14, 0]));
    const lower = group([0, -0.29, 0]);
    lower.add(mesh(foreGeo, sleeve, [0, -0.13, 0]));
    const end = group([0, -0.27, 0]);
    end.add(mesh(handGeo, skin, [0, -0.02, 0], [0.75, 1.1, 0.55]));
    lower.add(end);
    upper.add(lower);
    chest.add(upper);
    return { upper, lower, end };
  }) as [Limb, Limb];

  let coat: THREE.Mesh | undefined;
  if (look.coat) {
    const coatMat = mat("#f8fafc", 0.75, { side: THREE.DoubleSide });
    const gap = 0.32;
    coat = mesh(g(new THREE.CylinderGeometry(0.185, 0.25, 0.84, 28, 1, true, gap, Math.PI * 2 - gap * 2)), coatMat, [0, 0.07, 0], [1.05, 1, 0.78]);
    chest.add(coat);
    // White sleeves over the scrubs.
    arms.forEach((a) => {
      (a.upper.children[0] as THREE.Mesh).material = coatMat;
      (a.lower.children[0] as THREE.Mesh).material = coatMat;
    });
    const steth = mat("#24384c", 0.4);
    const tube = mesh(g(new THREE.TorusGeometry(0.11, 0.011, 8, 24, Math.PI * 1.2)), steth, [0, 0.42, 0.06]);
    tube.rotation.set(Math.PI / 2 + 0.35, 0, Math.PI * 1.1);
    chest.add(tube);
    chest.add(mesh(g(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16)), steth, [0.05, 0.26, 0.125], undefined));
  }

  let phone: THREE.Group | undefined;
  let waves: THREE.Mesh[] | undefined;
  if (look.phone) {
    phone = group([0, -0.06, 0.035]);
    phone.add(mesh(g(new RoundedBoxGeometry(0.07, 0.14, 0.012, 2, 0.006)), mat("#111827", 0.3)));
    phone.add(mesh(g(new THREE.PlaneGeometry(0.058, 0.122)), mat("#0b3d6b", 0.3, { emissive: "#5fe0e4", emissiveIntensity: 0.6 }), [0, 0, 0.0065]));
    const waveMat = new THREE.MeshBasicMaterial({ color: "#0fb4bb", transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    mats.push(waveMat);
    const waveGeo = g(new THREE.TorusGeometry(0.1, 0.005, 6, 40));
    waves = [0, 1, 2].map(() => {
      const w = new THREE.Mesh(waveGeo, waveMat.clone());
      mats.push(w.material as THREE.Material);
      w.position.set(0, 0.09, 0);
      phone!.add(w);
      return w;
    });
    phone.visible = false;
    arms[0].end.add(phone);
  }

  return {
    root,
    body,
    chest,
    head,
    arms,
    legs,
    coat,
    phone,
    waves,
    dispose: () => {
      geos.forEach((x) => x.dispose());
      mats.forEach((x) => x.dispose());
    },
  };
}

type ArmPose = [number, number, number]; // shoulder x, shoulder z, elbow x
type Pose = {
  walk: number;
  phase: number;
  sit: number;
  armR?: ArmPose;
  armL?: ArmPose;
  armBlendR?: number;
  armBlendL?: number;
  headYaw?: number;
  headPitch?: number;
  lean?: number;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function applyPose(r: Rig, P: Pose) {
  const s = Math.sin(P.phase);
  const c = Math.cos(P.phase);
  const w = P.walk * (1 - P.sit);
  const sit = P.sit;

  // Legs: stride while walking; thighs forward and shins down while seated.
  const hipR = -s * 0.5 * w - (Math.PI / 2) * sit;
  const hipL = s * 0.5 * w - (Math.PI / 2) * sit;
  const kneeR = Math.max(0, c) * 0.85 * w + (Math.PI / 2) * sit;
  const kneeL = Math.max(0, -c) * 0.85 * w + (Math.PI / 2) * sit;
  r.legs[0].upper.rotation.x = hipR;
  r.legs[1].upper.rotation.x = hipL;
  r.legs[0].lower.rotation.x = kneeR;
  r.legs[1].lower.rotation.x = kneeL;
  r.legs[0].end.rotation.x = -(hipR + kneeR) * 0.6 * (1 - sit);
  r.legs[1].end.rotation.x = -(hipL + kneeL) * 0.6 * (1 - sit);

  r.body.position.y = Math.abs(c) * 0.03 * w - 0.4 * sit;
  r.chest.rotation.x = 0.06 * w - 0.06 * sit + (P.lean ?? 0);
  if (r.coat) {
    // Shorten the coat while seated so it rests on the lap instead of the chair.
    r.coat.scale.y = 1 - 0.42 * sit;
    r.coat.position.y = 0.07 + 0.18 * sit;
  }

  // Arms: a natural swing, resting on the thighs when seated, or a set gesture.
  const rest = (side: number): ArmPose => [
    side * s * 0.42 * w + mix(0, -0.55, sit),
    -side * 0.07,
    mix(-0.18 - 0.2 * w, -0.75, sit),
  ];
  const set = (limb: Limb, base: ArmPose, target: ArmPose | undefined, t: number) => {
    const k = target ? clamp01(t) : 0;
    const v = target ?? base;
    limb.upper.rotation.set(mix(base[0], v[0], k), 0, mix(base[1], v[1], k));
    limb.lower.rotation.x = mix(base[2], v[2], k);
  };
  set(r.arms[0], rest(1), P.armR, P.armBlendR ?? 1);
  set(r.arms[1], rest(-1), P.armL, P.armBlendL ?? 1);

  r.head.rotation.set(P.headPitch ?? 0, P.headYaw ?? 0, 0);
}

const LOOKS: Record<"patient" | "doctor" | "reception", Look> = {
  patient: { skin: "#c58f6b", top: "#3f9c9a", sleeve: "#3f9c9a", bottom: "#e7ddcf", shoes: "#f3efe9", hair: "#1d1714", hairStyle: "long" },
  doctor: { skin: "#b97f5c", top: "#1d3a5f", bottom: "#1d3a5f", shoes: "#26303b", hair: "#191412", hairStyle: "bun", coat: true, phone: true },
  reception: { skin: "#a8714f", top: "#20324a", bottom: "#2c3e55", shoes: "#1e2630", hair: "#15110f", hairStyle: "short" },
};

// ─── The floating scribe screen ──────────────────────────────────────────────

const NOTE_ROWS: [string, string][] = [
  ["Complaint", "Sore throat, fever · 3 days"],
  ["Examination", "Temp 38.4 °C · tonsils inflamed"],
  ["Diagnosis", "Acute tonsillitis"],
  ["Medicines", "Azithromycin 500 mg × 3 days"],
  ["Next visit", "Review in 1 week"],
];

function drawScribe(ctx: CanvasRenderingContext2D, font: string, stage: number, lines: number, wave: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  rr(6, 6, W - 12, H - 12, 34);
  ctx.fillStyle = "rgba(7, 27, 54, 0.9)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(95, 224, 228, 0.55)";
  ctx.stroke();

  ctx.fillStyle = "#5fe0e4";
  ctx.font = `600 22px ${font}`;
  ctx.fillText("AI CLINICAL SCRIBE", 44, 64);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 34px ${font}`;
  ctx.fillText("Ayesha Khan", 44, 112);

  const pill = (text: string, fg: string, bg: string) => {
    ctx.font = `700 22px ${font}`;
    const w = ctx.measureText(text).width + 40;
    rr(W - 44 - w, 40, w, 44, 22);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, W - 44 - w + 20, 70);
  };

  if (stage === 0) {
    pill("●  Recording", "#fecaca", "rgba(239, 68, 68, 0.22)");
    const n = 46;
    for (let i = 0; i < n; i++) {
      const h = 18 + 120 * Math.abs(Math.sin(i * 1.7 + wave) * Math.cos(i * 0.45 - wave * 0.6));
      const x = 44 + i * ((W - 88) / n);
      const grad = ctx.createLinearGradient(0, 260 - h / 2, 0, 260 + h / 2);
      grad.addColorStop(0, "#5fe0e4");
      grad.addColorStop(1, "#0fb4bb");
      ctx.fillStyle = grad;
      rr(x, 260 - h / 2, 8, h, 4);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `400 22px ${font}`;
    ctx.fillText("Dr. Sana Malik is dictating the consultation…", 44, H - 50);
    return;
  }

  if (stage === 1) pill("Draft · review", "#fde68a", "rgba(252, 211, 77, 0.18)");
  else pill("✓  Approved", "#a7f3d0", "rgba(52, 211, 153, 0.2)");

  NOTE_ROWS.forEach(([k, v], i) => {
    const y = 172 + i * 54;
    const shown = stage === 2 || i < lines;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `500 22px ${font}`;
    ctx.fillText(k, 44, y);
    if (shown) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `500 24px ${font}`;
      ctx.fillText(v, 230, y);
    } else {
      rr(230, y - 18, 260 + ((i * 53) % 120), 16, 8);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();
    }
  });
  ctx.fillStyle = stage === 2 ? "#6ee7b7" : "rgba(255,255,255,0.55)";
  ctx.font = `500 21px ${font}`;
  ctx.fillText(stage === 2 ? "Approved by Dr. Sana Malik · on the record" : "AI draft — the doctor reviews before it is saved", 44, H - 40);
}

function ScribeScreen({ progressRef }: { progressRef: RefObject<number> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const gfx = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 520;
    const ctx = canvas.getContext("2d")!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    return { canvas, ctx, texture, material, font, last: "" };
  }, []);
  // Mutated every frame, so it lives in a ref rather than as a render value.
  const live = useRef(gfx);
  useEffect(() => {
    live.current = gfx;
    return () => {
      gfx.texture.dispose();
      gfx.material.dispose();
      gfx.canvas.width = gfx.canvas.height = 0;
    };
  }, [gfx]);

  useFrame(() => {
    const g = live.current;
    const p = progressRef.current ?? 0;
    const stage = p < 0.877 ? 0 : p < 0.947 ? 1 : 2;
    const lines = Math.floor(sstep(0.88, 0.935, p) * NOTE_ROWS.length + 0.001);
    const wave = Math.round(p * 900) / 20;
    const key = stage === 0 ? `0:${wave}` : `${stage}:${lines}`;
    if (key !== g.last) {
      g.last = key;
      drawScribe(g.ctx, g.font, stage, lines, wave);
      g.texture.needsUpdate = true;
    }
    const vis = sstep(0.79, 0.82, p);
    g.material.opacity = vis;
    if (mesh.current) {
      mesh.current.visible = vis > 0.001;
      const pop = 1 + 0.06 * window01(0.945, 0.985, p, 0.015);
      mesh.current.scale.setScalar((0.85 + 0.15 * vis) * pop);
      mesh.current.position.y = 1.95 + 0.1 * vis;
    }
  });

  return (
    <mesh ref={mesh} position={[5.75, 2.0, -2.7]} rotation={[0, 0.18, 0]} material={gfx.material}>
      <planeGeometry args={[1.62, 0.936]} />
    </mesh>
  );
}

/** The real FlexicaAI logo (the light-on-dark version from the header) as a lit wall sign. */
function WallLogo({ position, width }: { position: [number, number, number]; width: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const invalidate = useThree((st) => st.invalidate);
  useEffect(() => {
    let live = true;
    let made: THREE.Texture | null = null;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      // Rasterise at a fixed, sharp size (the SVG has no intrinsic width of its own).
      const c = document.createElement("canvas");
      c.width = 2080;
      c.height = 520;
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      made = new THREE.CanvasTexture(c);
      made.colorSpace = THREE.SRGBColorSpace;
      made.anisotropy = 8;
      setTex(made);
      invalidate();
    };
    img.src = "/logo-dark.svg";
    return () => {
      live = false;
      made?.dispose();
    };
  }, [invalidate]);
  if (!tex) return null;
  // The source artwork is 520 × 130.
  return (
    <mesh position={position} renderOrder={2}>
      <planeGeometry args={[width, width / 4]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

// ─── Quaternius characters (CC0, see public/models/CREDITS.md) ─────────────────

type Actor = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
  bones: Record<string, THREE.Object3D>;
  /** Rest pose of every bone, restored before each evaluation so bends never pile up. */
  rest: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][];
  phone?: THREE.Group;
  waves?: THREE.Mesh[];
  dispose: () => void;
};
type ActorSpec = {
  url: string;
  height: number;
  clips: Record<string, string>;
  colors?: Record<string, string>;
  phone?: boolean;
};

const ACTORS = {
  patient: {
    url: "/models/patient.glb",
    height: 1.64,
    clips: { idle: "HumanArmature|Female_Idle", walk: "HumanArmature|Female_Walk", sit: "HumanArmature|Female_Sitting" },
    colors: { Shirt: "#2f9f9c", Pants: "#e6dccd", Shoes: "#efe9e2", Socks: "#efe9e2" },
  },
  doctor: {
    url: "/models/doctor.glb",
    height: 1.67,
    clips: { idle: "CharacterArmature|Idle_Neutral", wave: "CharacterArmature|Wave", interact: "CharacterArmature|Interact" },
    colors: { White: "#f7f9fb", Grey: "#1d3a5f" },
    phone: true,
  },
  reception: {
    url: "/models/receptionist.glb",
    height: 1.78,
    clips: { idle: "CharacterArmature|Idle_Neutral", wave: "CharacterArmature|Wave", interact: "CharacterArmature|Interact" },
    colors: { Suit: "#1f3350", Tie: "#0fb4bb" },
  },
} satisfies Record<string, ActorSpec>;

function makePhone() {
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.14, 0.012, 2, 0.006), new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.3 }));
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.058, 0.122),
    new THREE.MeshStandardMaterial({ color: "#0b3d6b", emissive: "#5fe0e4", emissiveIntensity: 0.6 }),
  );
  glass.position.z = 0.0065;
  phone.add(body, glass);
  const waveGeo = new THREE.TorusGeometry(0.1, 0.005, 6, 40);
  const waves = [0, 1, 2].map(() => {
    const w = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: "#0fb4bb", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    w.position.y = 0.09;
    phone.add(w);
    return w;
  });
  return { phone, waves };
}

async function loadActor(loader: GLTFLoader, spec: ActorSpec): Promise<Actor> {
  const gltf = await loader.loadAsync(spec.url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const k = spec.height / Math.max(0.001, box.max.y - box.min.y);
  model.scale.multiplyScalar(k);
  model.position.y = -box.min.y * k;
  const root = new THREE.Group();
  root.add(model);

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false; // skinned bounds don't follow the animation
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((mt) => {
      const c = spec.colors?.[mt.name];
      if (c && (mt as THREE.MeshStandardMaterial).color) (mt as THREE.MeshStandardMaterial).color.set(c);
    });
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [alias, name] of Object.entries(spec.clips)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, name);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.play();
    a.paused = true; // time is set from scroll, never advanced by the clock
    a.setEffectiveWeight(0);
    actions[alias] = a;
  }
  const bones: Record<string, THREE.Object3D> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o;
  });
  const rest = Object.values(bones).map((b) => [b, b.position.clone(), b.quaternion.clone()] as [THREE.Object3D, THREE.Vector3, THREE.Quaternion]);

  let phone: THREE.Group | undefined;
  let waves: THREE.Mesh[] | undefined;
  const wrist = bones["WristR"];
  if (spec.phone && wrist) {
    ({ phone, waves } = makePhone());
    root.updateMatrixWorld(true);
    const ws = wrist.getWorldScale(new THREE.Vector3());
    phone.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
    phone.position.set(0, 0.08 / ws.y, 0.03 / ws.z);
    phone.visible = false;
    wrist.add(phone);
  }

  return {
    root,
    mixer,
    actions,
    bones,
    rest,
    phone,
    waves,
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mt) => mt.dispose());
      });
    },
  };
}

/** Sets each clip's weight and time (weights should sum to 1), then evaluates once. */
function drive(a: Actor, weights: Record<string, [number, number]>) {
  for (const [b, pos, q] of a.rest) {
    b.position.copy(pos);
    b.quaternion.copy(q);
  }
  for (const [alias, act] of Object.entries(a.actions)) {
    const v = weights[alias];
    act.setEffectiveWeight(v ? v[0] : 0);
    if (v) {
      const d = act.getClip().duration;
      act.time = ((v[1] % d) + d) % d;
    }
  }
  a.mixer.update(0);
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
/** Adds a local rotation on top of whatever the clip set for this bone this frame. */
function bend(b: THREE.Object3D | undefined, x: number, y = 0, z = 0) {
  if (!b || (x === 0 && y === 0 && z === 0)) return;
  b.quaternion.multiply(_quat.setFromEuler(_euler.set(x, y, z)));
}

/** Seated legs for rigs without a sitting clip. Tuned by eye for the Quaternius rig. */
const SIT = { thigh: -1.45, knee: 1.45, drop: 0.43 };
/** Right arm raised so the phone is by the mouth, tuned by eye. */
const PHONE_POSE = { ux: -2.0, uy: 0, uz: 0.35, lx: -2.0, ly: 0, lz: 0 };
function sitLegs(a: Actor, t: number) {
  if (t <= 0) return;
  bend(a.bones["UpperLegL"], SIT.thigh * t);
  bend(a.bones["UpperLegR"], SIT.thigh * t);
  bend(a.bones["LowerLegL"], SIT.knee * t);
  bend(a.bones["LowerLegR"], SIT.knee * t);
}

// ─── The clinic ──────────────────────────────────────────────────────────────

function Clinic({ shared }: { shared: ClinicBus }) {
  const m = useMaterials();
  // People are built after mount and hung on these groups, so a rig is never a
  // render value; per-frame posing goes through the rig refs.
  const patientHolder = useRef<THREE.Group>(null);
  const doctorHolder = useRef<THREE.Group>(null);
  const receptionHolder = useRef<THREE.Group>(null);
  const patientRig = useRef<Rig | null>(null);
  const doctorRig = useRef<Rig | null>(null);
  const receptionRig = useRef<Rig | null>(null);
  // The Quaternius characters replace the built-in figures once they have loaded.
  const patientActor = useRef<Actor | null>(null);
  const doctorActor = useRef<Actor | null>(null);
  const receptionActor = useRef<Actor | null>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pathMesh = useRef<THREE.Mesh>(null);
  const doors = useRef<THREE.Group>(null);
  const progress = useRef(0);
  const { camera, invalidate, size } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);

  // Shift the frame so the action sits right of the text column.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (size.width < NARROW_CANVAS) {
      cam.clearViewOffset();
      invalidate();
      return;
    }
    cam.setViewOffset(size.width, size.height, -size.width * 0.08, 0, size.width, size.height);
    invalidate();
    return () => cam.clearViewOffset();
  }, [camera, size, invalidate]);

  // The teal route on the floor: entrance → desk → consultation room.
  const pathGeo = useMemo(() => {
    const pts = PATIENT_WALK.filter(([p]) => p >= 0.03 && p <= 0.48).map(([, x, z]) => new THREE.Vector3(x, 0.025, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    return new THREE.TubeGeometry(curve, 200, 0.03, 6, false);
  }, []);
  useEffect(() => () => pathGeo.dispose(), [pathGeo]);

  useEffect(() => {
    const cast: [RefObject<THREE.Group | null>, RefObject<Rig | null>, Look][] = [
      [patientHolder, patientRig, LOOKS.patient],
      [doctorHolder, doctorRig, LOOKS.doctor],
      [receptionHolder, receptionRig, LOOKS.reception],
    ];
    const built = cast.map(([holder, rigRef, look]) => {
      const rig = makePerson(look);
      const parent = holder.current;
      parent?.add(rig.root);
      rigRef.current = rig;
      return () => {
        parent?.remove(rig.root);
        rig.dispose();
        rigRef.current = null;
      };
    });
    invalidate();
    return () => built.forEach((undo) => undo());
  }, [invalidate]);

  useEffect(() => {
    let cancelled = false;
    const loaded: Actor[] = [];
    const loader = new GLTFLoader();
    const cast: [RefObject<THREE.Group | null>, RefObject<Rig | null>, RefObject<Actor | null>, ActorSpec][] = [
      [patientHolder, patientRig, patientActor, ACTORS.patient],
      [doctorHolder, doctorRig, doctorActor, ACTORS.doctor],
      [receptionHolder, receptionRig, receptionActor, ACTORS.reception],
    ];
    Promise.all(cast.map(([, , , spec]) => loadActor(loader, spec)))
      .then((actors) => {
        if (cancelled) return actors.forEach((a) => a.dispose());
        actors.forEach((a, i) => {
          const [holder, rigRef, actorRef] = cast[i];
          holder.current?.add(a.root);
          if (rigRef.current) rigRef.current.root.visible = false;
          actorRef.current = a;
          loaded.push(a);
        });
        invalidate();
      })
      .catch(() => {
        // Keep the built-in figures if the models can't be fetched.
      });
    return () => {
      cancelled = true;
      cast.forEach(([holder, , actorRef]) => {
        if (actorRef.current) holder.current?.remove(actorRef.current.root);
        actorRef.current = null;
      });
      loaded.forEach((a) => a.dispose());
    };
  }, [invalidate]);

  useEffect(() => {
    shared.bind(invalidate);
    return () => shared.bind(undefined);
  }, [shared, invalidate]);

  useFrame(() => {
    const p = shared.progress;
    progress.current = p;
    const patient = patientRig.current;
    const doctor = doctorRig.current;
    const reception = receptionRig.current;
    const patientA = patientActor.current;
    const doctorA = doctorActor.current;
    const receptionA = receptionActor.current;

    // ── Patient
    const [px, pz] = track(p, PATIENT_WALK);
    const pSit = sstep(0.5, 0.53, p) * (1 - sstep(0.6, 0.63, p));
    const pWalk = speedAt(p, PATIENT_WALK) * (1 - pSit);
    const pHeading = headingAt(p, PATIENT_WALK, PATIENT_HOLDS);
    const pVisible = p < 0.772;
    const talking = window01(0.53, 0.6, p);
    if (patientA) {
      // Seated, the clip puts her hips behind her feet; move her forward so her back clears the chair.
      patientA.root.position.set(px, 0, pz - 0.2 * pSit);
      patientA.root.rotation.y = pHeading;
      patientA.root.visible = pVisible;
      // The sitting clip lowers her into the chair over its first ~0.67s, then holds.
      // Play that once to sit, settle in the hold, and play it backwards to stand up.
      const seated = p >= 0.5 && p <= 0.63;
      const sitT =
        p < 0.53 ? 0.67 * sstep(0.5, 0.53, p) : p < 0.6 ? 0.67 + ((p - 0.53) / 0.07) * 1.3 : 0.67 * (1 - sstep(0.6, 0.63, p));
      drive(patientA, {
        walk: [seated ? 0 : pWalk, p * 42],
        idle: [seated ? 0 : 1 - pWalk, p * 18],
        sit: [seated ? 1 : 0, sitT],
      });
    } else if (patient) {
      patient.root.position.set(px, 0, pz + 0.12 * pSit);
      patient.root.rotation.y = pHeading;
      patient.root.visible = pVisible;
      applyPose(patient, {
        walk: pWalk,
        phase: p * 330,
        sit: pSit,
        armL: [-0.9 + 0.15 * Math.sin(p * 400), 0.1, -1.2],
        armBlendL: talking * 0.9,
        armR: [-0.25, -2.5, -0.5 + 0.35 * Math.sin(p * 520)],
        armBlendR: window01(0.7, 0.735, p, 0.01),
        headYaw: 0.25 * window01(0.2, 0.28, p) + 0.08 * Math.sin(p * 160) * talking,
        headPitch: 0.05 * talking,
      });
    }

    // ── Receptionist: stands at the counter, taps "Arrived", waves goodbye.
    const [rx, rz] = RECEPTION_AT;
    const tap = window01(0.2, 0.27, p, 0.012);
    const bye = window01(0.7, 0.75, p, 0.012);
    if (receptionA) {
      receptionA.root.position.set(rx, 0, rz);
      drive(receptionA, {
        idle: [Math.max(0, 1 - tap - bye), p * 20],
        interact: [tap, sstep(0.2, 0.27, p) * 1.25],
        wave: [bye, sstep(0.7, 0.75, p) * 1.67 * 1.5],
      });
    } else if (reception) {
      reception.root.position.set(rx, 0, rz);
      const toPatient = Math.atan2(px - rx, pz - rz);
      const watch = clamp01(1 - Math.hypot(px - rx, pz - rz) / 9);
      applyPose(reception, {
        walk: 0,
        phase: 0,
        sit: 0,
        armR: [-0.95, 0.05, -0.75],
        armBlendR: tap,
        armL: [-0.2, 2.5, -0.5 + 0.35 * Math.sin(p * 520)],
        armBlendL: bye,
        headYaw: THREE.MathUtils.clamp(toPatient, -1.1, 1.1) * watch,
        headPitch: -0.05,
      });
    }

    // ── Doctor: seated, stands to greet, sits, then dictates, reviews and approves.
    const [dx, dz] = DOCTOR_AT;
    const greet = sstep(0.44, 0.47, p) * (1 - sstep(0.5, 0.53, p));
    const dSit = 1 - greet;
    const dictate = window01(0.79, 0.875, p, 0.015);
    const typing = window01(0.88, 0.94, p, 0.012);
    const approve = window01(0.945, 0.98, p, 0.01);
    if (doctorA) {
      doctorA.root.position.set(dx, -SIT.drop * dSit, dz + 0.2 * greet);
      const waveW = window01(0.445, 0.495, p, 0.012);
      const interactW = Math.max(typing, approve);
      drive(doctorA, {
        idle: [Math.max(0, 1 - waveW - interactW), p * 20],
        wave: [waveW, sstep(0.445, 0.495, p) * 2.08],
        interact: [interactW, approve > 0 ? 0.55 + sstep(0.945, 0.98, p) * 0.5 : p * 30],
      });
      sitLegs(doctorA, dSit);
      // Phone held up to the mouth while dictating.
      bend(doctorA.bones["UpperArmR"], PHONE_POSE.ux * dictate, PHONE_POSE.uy * dictate, PHONE_POSE.uz * dictate);
      bend(doctorA.bones["LowerArmR"], PHONE_POSE.lx * dictate, PHONE_POSE.ly * dictate, PHONE_POSE.lz * dictate);
      if (doctorA.phone && doctorA.waves) {
        doctorA.phone.visible = dictate > 0.4;
        doctorA.waves.forEach((w, i) => {
          const t = (p * 60 + i / 3) % 1;
          w.scale.setScalar(0.3 + t * 1.6);
          (w.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8 * dictate;
        });
      }
    } else if (doctor) {
      doctor.root.position.set(dx, 0, dz + 0.2 * greet);
      const toPat = Math.atan2(px - dx, pz - dz);
      const presence = p > 0.4 && p < 0.66 ? 1 : 0;
      let armR: ArmPose | undefined;
      let blendR = 0;
      if (dictate > 0) {
        armR = [-1.35, 0.05, -1.95];
        blendR = dictate;
      } else if (approve > 0) {
        armR = [-1.15, 0.1, -0.35];
        blendR = approve;
      } else if (typing > 0) {
        armR = [-0.55, 0.05, -1.1];
        blendR = typing;
      } else if (greet > 0) {
        armR = [-0.75, 0.05, -0.25];
        blendR = window01(0.465, 0.505, p, 0.01);
      }
      applyPose(doctor, {
        walk: 0,
        phase: 0,
        sit: dSit,
        armR,
        armBlendR: blendR,
        armL: [-0.55, -0.05, -1.1],
        armBlendL: typing,
        headYaw: presence ? THREE.MathUtils.clamp(toPat, -0.9, 0.9) : 0,
        headPitch: typing > 0.5 ? 0.3 : dictate > 0.5 ? -0.05 : 0.04 * Math.sin(p * 300) * window01(0.53, 0.6, p),
        lean: 0.08 * typing,
      });
      if (doctor.phone && doctor.waves) {
        doctor.phone.visible = dictate > 0.4;
        doctor.waves.forEach((w, i) => {
          const t = (p * 60 + i / 3) % 1;
          w.scale.setScalar(0.3 + t * 1.6);
          (w.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8 * dictate;
        });
      }
    }

    // ── Sliding doors: open as the patient arrives and as they leave.
    const open = window01(0.04, 0.13, p, 0.03) + window01(0.715, 0.79, p, 0.025);
    if (doors.current) {
      const [a, b] = doors.current.children;
      a.position.z = 2.04 - 0.85 * open;
      b.position.z = 2.96 + 0.85 * open;
    }

    // ── "Arrived": a teal ring opens under the patient at the desk.
    if (ring.current) {
      const r = sstep(0.2, 0.26, p);
      const fade = 1 - sstep(0.29, 0.33, p);
      ring.current.position.set(-3.2, 0.03, 0.1);
      ring.current.scale.setScalar(0.4 + r * 1.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = r * fade * 0.85;
    }

    // ── Route draws ahead of the patient, then fades once they are seated.
    if (pathMesh.current) {
      const total = pathGeo.index ? pathGeo.index.count : 0;
      const draw = sstep(0.03, 0.48, p);
      pathGeo.setDrawRange(0, Math.floor((total * draw) / 6) * 6);
      (pathMesh.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - sstep(0.55, 0.62, p));
    }

    const [cx, cy, cz, lx, ly, lz] = track(p, CAMERA);
    camera.position.set(cx, cy, cz);
    look.set(lx, ly, lz);
    camera.lookAt(look);
  });

  return (
    <>
      <color attach="background" args={["#eef4f9"]} />
      <fog attach="fog" args={["#eef4f9", 26, 48]} />
      <hemisphereLight args={["#ffffff", "#d9cbb8", 1.05]} />
      <directionalLight
        position={[5, 12, 8]}
        intensity={1.7}
        color="#fffaf2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
      <pointLight position={[-3.2, 2.2, -0.9]} intensity={1.6} distance={5} color="#ffe6c2" />
      <pointLight position={[4.4, 2.3, -2.4]} intensity={1.2} distance={5} color="#ffe6c2" />

      {/* Slab, plinth and the paving outside the entrance */}
      <mesh position={[0, -0.06, 0]} material={m.floor} receiveShadow>
        <boxGeometry args={[14.4, 0.12, 9.4]} />
      </mesh>
      <mesh position={[0, -0.4, 0]} material={m.plinth}>
        <boxGeometry args={[14.8, 0.56, 9.8]} />
      </mesh>
      <RBox size={[3.2, 0.08, 2.4]} position={[-8.9, -0.04, 2.5]} material={m.paving} shadow={false} />
      <Plant m={m} position={[-8.1, 0, 4.0]} scale={0.9} />
      <Plant m={m} position={[-8.1, 0, 1.0]} scale={0.9} />

      {/* Walls: back, left with the entrance, header over the door */}
      <RBox size={[14.4, 2.6, 0.14]} position={[0, 1.3, -4.63]} material={m.wall} radius={0.01} />
      <RBox size={[0.14, 2.6, 6.3]} position={[-7.13, 1.3, -1.55]} material={m.wall} radius={0.01} />
      <RBox size={[0.14, 2.6, 1.3]} position={[-7.13, 1.3, 4.05]} material={m.wall} radius={0.01} />
      <RBox size={[0.14, 0.32, 1.8]} position={[-7.13, 2.44, 2.5]} material={m.wall} radius={0.01} />
      <RBox size={[0.16, 0.03, 1.8]} position={[-7.13, 2.27, 2.5]} material={m.led} radius={0.005} shadow={false} />
      {/* Sliding glass doors */}
      <group ref={doors}>
        <group position={[-7.22, 1.13, 2.04]}>
          <RBox size={[0.03, 2.22, 0.9]} position={[0, 0, 0]} material={m.glass} radius={0.008} shadow={false} />
          <RBox size={[0.04, 2.22, 0.03]} position={[0, 0, 0.44]} material={m.dark} radius={0.008} />
        </group>
        <group position={[-7.22, 1.13, 2.96]}>
          <RBox size={[0.03, 2.22, 0.9]} position={[0, 0, 0]} material={m.glass} radius={0.008} shadow={false} />
          <RBox size={[0.04, 2.22, 0.03]} position={[0, 0, -0.44]} material={m.dark} radius={0.008} />
        </group>
      </group>

      {/* Reception: navy accent wall with the logo, slatted oak desk, pendants */}
      <RBox size={[4.2, 2.6, 0.04]} position={[-3.2, 1.3, -4.54]} material={m.accent} radius={0.01} />
      <WallLogo position={[-3.2, 1.62, -4.49]} width={2.4} />
      <RBox size={[1.4, 0.06, 0.02]} position={[-3.2, 1.15, -4.51]} material={m.led} radius={0.01} shadow={false} />

      <group position={[-3.2, 0, -0.95]}>
        <RBox size={[3.0, 0.98, 0.66]} position={[0, 0.49, 0]} material={m.white} radius={0.06} />
        {Array.from({ length: 24 }, (_, i) => (
          <RBox key={i} size={[0.07, 0.86, 0.03]} position={[-1.38 + i * 0.12, 0.47, 0.345]} material={m.oak} radius={0.01} />
        ))}
        <RBox size={[3.1, 0.05, 0.78]} position={[0, 1.0, 0]} material={m.oak} radius={0.02} />
        <RBox size={[2.9, 0.02, 0.02]} position={[0, 0.05, 0.37]} material={m.led} radius={0.005} shadow={false} />
        {/* Monitor facing the receptionist */}
        <RBox size={[0.62, 0.38, 0.03]} position={[0.2, 1.32, -0.12]} material={m.white} radius={0.015} rotation={[0.08, Math.PI, 0]} />
        <mesh position={[0.2, 1.33, -0.14]} rotation={[0.08, Math.PI, 0]} material={m.screen}>
          <planeGeometry args={[0.56, 0.3]} />
        </mesh>
        <RBox size={[0.04, 0.24, 0.04]} position={[0.2, 1.12, -0.08]} material={m.metal} radius={0.01} />
        <Plant m={m} position={[-1.25, 1.02, -0.05]} scale={0.35} />
      </group>
      {[-4.1, -3.2, -2.3].map((x) => (
        <group key={x} position={[x, 0, -0.95]}>
          <Cyl args={[0.004, 0.004, 0.9, 6]} position={[0, 2.55, 0]} material={m.dark} shadow={false} />
          <mesh position={[0, 2.06, 0]} material={m.dark} castShadow>
            <coneGeometry args={[0.17, 0.2, 28, 1, true]} />
          </mesh>
          <mesh position={[0, 1.98, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.lamp}>
            <circleGeometry args={[0.15, 28]} />
          </mesh>
        </group>
      ))}

      {/* Waiting lounge: sofa, armchair, round table on a rug, art, plants */}
      <mesh position={[-5.7, 0.006, -3.0]} material={m.rug} receiveShadow>
        <cylinderGeometry args={[1.35, 1.35, 0.012, 48]} />
      </mesh>
      <group position={[-5.7, 0, -3.95]}>
        <RBox size={[2.0, 0.36, 0.82]} position={[0, 0.24, 0]} material={m.fabric} radius={0.08} />
        <RBox size={[2.0, 0.5, 0.2]} position={[0, 0.62, -0.32]} material={m.fabric} radius={0.08} />
        <RBox size={[0.18, 0.5, 0.82]} position={[-1.0, 0.4, 0]} material={m.fabric} radius={0.07} />
        <RBox size={[0.18, 0.5, 0.82]} position={[1.0, 0.4, 0]} material={m.fabric} radius={0.07} />
        <RBox size={[0.42, 0.36, 0.12]} position={[-0.55, 0.62, -0.16]} material={m.cushion} radius={0.06} rotation={[-0.2, 0.15, 0]} />
        <RBox size={[0.4, 0.34, 0.12]} position={[0.6, 0.6, -0.16]} material={m.sage} radius={0.06} rotation={[-0.2, -0.15, 0]} />
      </group>
      <Armchair m={m} position={[-5.3, 0, -2.0]} rotationY={Math.PI + 0.35} fabric={m.sage} />
      <Cyl args={[0.4, 0.4, 0.04, 40]} position={[-5.8, 0.4, -3.05]} material={m.oak} />
      <Cyl args={[0.05, 0.12, 0.38, 16]} position={[-5.8, 0.19, -3.05]} material={m.walnut} />
      <RBox size={[0.3, 0.04, 0.22]} position={[-5.75, 0.44, -3.0]} material={m.white} radius={0.01} rotation={[0, 0.4, 0]} />
      <group position={[-7.04, 1.55, -2.6]} rotation={[0, Math.PI / 2, 0]}>
        <RBox size={[1.1, 0.75, 0.04]} position={[-0.65, 0, 0]} material={m.dark} radius={0.01} />
        <RBox size={[1.0, 0.65, 0.02]} position={[-0.65, 0, 0.02]} material={m.art1} radius={0.005} />
        <RBox size={[0.7, 0.75, 0.04]} position={[0.4, 0, 0]} material={m.dark} radius={0.01} />
        <RBox size={[0.6, 0.65, 0.02]} position={[0.4, 0, 0.02]} material={m.art2} radius={0.005} />
      </group>
      <Plant m={m} position={[-4.3, 0, -4.15]} scale={1.2} />
      <Plant m={m} position={[-6.6, 0, 0.9]} scale={1.0} />

      {/* Glass partition to the consultation room, with its doorway */}
      <RBox size={[0.03, 2.4, 4.6]} position={[1.0, 1.2, -2.33]} material={m.glass} radius={0.005} shadow={false} />
      <RBox size={[0.035, 0.5, 4.6]} position={[1.0, 1.25, -2.33]} material={m.frosted} radius={0.005} shadow={false} />
      {[-4.6, -2.3, -0.03, 1.6].map((z) => (
        <RBox key={z} size={[0.06, 2.4, 0.06]} position={[1.0, 1.2, z]} material={m.dark} radius={0.01} />
      ))}
      <RBox size={[0.06, 0.06, 6.2]} position={[1.0, 2.4, -1.5]} material={m.dark} radius={0.01} />

      {/* Consultation room: big window, desk, chairs, couch, cabinet and shelves */}
      <RBox size={[4.6, 1.5, 0.03]} position={[4.4, 1.35, -4.54]} material={m.window} radius={0.01} shadow={false} />
      {[2.1, 3.25, 4.4, 5.55, 6.7].map((x) => (
        <RBox key={x} size={[0.05, 1.5, 0.05]} position={[x, 1.35, -4.52]} material={m.dark} radius={0.01} />
      ))}
      <RBox size={[4.65, 0.05, 0.08]} position={[4.4, 0.6, -4.5]} material={m.dark} radius={0.01} />
      <RBox size={[4.65, 0.05, 0.08]} position={[4.4, 2.1, -4.5]} material={m.dark} radius={0.01} />

      <RBox size={[2.8, 0.012, 2.3]} position={[4.4, 0.006, -2.35]} material={m.rug} radius={0.006} />
      <group position={[4.4, 0, -2.45]}>
        <RBox size={[1.9, 0.05, 0.85]} position={[0, 0.745, 0]} material={m.oak} radius={0.02} />
        <RBox size={[0.05, 0.72, 0.78]} position={[-0.9, 0.36, 0]} material={m.white} radius={0.01} />
        <RBox size={[0.05, 0.72, 0.78]} position={[0.9, 0.36, 0]} material={m.white} radius={0.01} />
        <RBox size={[0.5, 0.36, 0.7]} position={[0.62, 0.52, 0]} material={m.white} radius={0.02} />
        {/* Laptop, open towards the doctor */}
        <RBox size={[0.36, 0.018, 0.25]} position={[-0.1, 0.78, -0.12]} material={m.metal} radius={0.006} />
        <group position={[-0.1, 0.78, 0.0]} rotation={[0.35, 0, 0]}>
          <RBox size={[0.36, 0.24, 0.012]} position={[0, 0.12, 0]} material={m.metal} radius={0.006} />
          <mesh position={[0, 0.12, -0.008]} rotation={[0, Math.PI, 0]} material={m.screen}>
            <planeGeometry args={[0.32, 0.2]} />
          </mesh>
        </group>
        <Cyl args={[0.04, 0.035, 0.1, 16]} position={[0.62, 0.82, 0.2]} material={m.white} />
        <Plant m={m} position={[-0.75, 0.77, 0.2]} scale={0.28} />
      </group>
      <OfficeChair m={m} position={[DOCTOR_AT[0], 0, DOCTOR_AT[1] - 0.06]} />
      <Armchair m={m} position={[4.4, 0, -1.38]} rotationY={Math.PI} fabric={m.fabric} />

      {/* Examination couch along the back wall */}
      <group position={[6.15, 0, -3.95]}>
        <RBox size={[1.9, 0.12, 0.66]} position={[0, 0.62, 0]} material={m.white} radius={0.05} />
        <RBox size={[0.55, 0.12, 0.64]} position={[0.75, 0.74, 0]} material={m.white} radius={0.05} rotation={[0, 0, 0.3]} />
        <RBox size={[1.8, 0.06, 0.6]} position={[0, 0.52, 0]} material={m.dark} radius={0.02} />
        {[-0.8, 0.8].map((x) => (
          <RBox key={x} size={[0.08, 0.5, 0.56]} position={[x, 0.25, 0]} material={m.metal} radius={0.02} />
        ))}
        <RBox size={[0.9, 0.02, 0.6]} position={[-0.45, 0.69, 0]} material={m.cushion} radius={0.01} />
      </group>
      {/* Cabinet with an oak top, shelves above */}
      <group position={[1.5, 0, -3.7]}>
        <RBox size={[0.6, 0.9, 1.5]} position={[0, 0.45, 0]} material={m.white} radius={0.03} />
        <RBox size={[0.64, 0.04, 1.54]} position={[0, 0.92, 0]} material={m.oak} radius={0.01} />
        <RBox size={[0.3, 0.03, 1.3]} position={[-0.3, 1.6, 0]} material={m.oak} radius={0.01} />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <RBox
            key={i}
            size={[0.18, 0.2 + (i % 3) * 0.04, 0.06]}
            position={[-0.3, 1.72 + (i % 3) * 0.02, -0.5 + i * 0.09]}
            material={m.books[i % m.books.length]}
            radius={0.006}
          />
        ))}
        <Plant m={m} position={[0, 0.94, 0.5]} scale={0.32} />
      </group>
      <Plant m={m} position={[6.8, 0, -1.7]} scale={1.15} />

      {/* People */}
      <group ref={receptionHolder} />
      <group ref={patientHolder} />
      <group ref={doctorHolder} />

      <ScribeScreen progressRef={progress} />

      {/* Route and arrival ring */}
      <mesh ref={pathMesh} geometry={pathGeo} material={m.path} />
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} material={m.ring}>
        <ringGeometry args={[0.42, 0.5, 48]} />
      </mesh>
    </>
  );
}

export default function ClinicCanvas({ shared, onReady }: { shared: ClinicBus; onReady?: () => void }) {
  return (
    <Canvas
      frameloop="demand"
      shadows="percentage"
      dpr={capDpr([1, 1.75])}
      camera={{ fov: 30, near: 0.1, far: 90, position: [-1.5, 11.5, 17.5] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      onCreated={() => onReady?.()}
      aria-hidden
    >
      <Clinic shared={shared} />
    </Canvas>
  );
}
