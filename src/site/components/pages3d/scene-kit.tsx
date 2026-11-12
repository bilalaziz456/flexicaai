"use client";

import { NARROW_CANVAS, capDpr } from "../story/webgl";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { ClinicBus } from "../story/clinic-bus";

export type { StorySceneProps } from "./story-stage";

/** Shared pieces for the inner-page 3D stories. */

export const COLORS = {
  navy: "#082957",
  navyDeep: "#061d3d",
  teal: "#0FB4BB",
  tealGlow: "#5fe0e4",
  mist: "#F2F7FB",
  white: "#ffffff",
  amber: "#f5a524",
  green: "#22c55e",
  ink: "#0b1b33",
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 → 1 between a and b, smoothed. */
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises over [a, a+r], holds, falls over [b-r, b]. */
export const window01 = (a: number, b: number, x: number, r = 0.02) => sstep(a, a + r, x) * (1 - sstep(b - r, b, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Reads scroll progress each frame and redraws only when it changes. */
export function useBus(bus: ClinicBus) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    bus.bind(invalidate);
    return () => bus.bind(undefined);
  }, [bus, invalidate]);
}

export type Built = {
  /** Poses everything for scroll progress p (0..1). */
  update: (p: number, camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
};

/**
 * Builds a scene graph imperatively once (after mount), then poses it from scroll
 * progress every frame. Keeping Three objects out of React state keeps the React
 * compiler happy and the render loop allocation-free.
 */
export function Imperative({ bus, build }: { bus: ClinicBus; build: (root: THREE.Group) => Built }) {
  const holder = useRef<THREE.Group>(null);
  const api = useRef<Built | null>(null);
  const buildRef = useRef(build);
  const invalidate = useThree((s) => s.invalidate);
  useBus(bus);
  useEffect(() => {
    const root = holder.current;
    if (!root) return;
    const built = buildRef.current(root);
    api.current = built;
    invalidate();
    return () => {
      api.current = null;
      built.dispose();
      root.clear();
    };
  }, [invalidate]);
  useFrame(({ camera }) => {
    api.current?.update(bus.progress, camera as THREE.PerspectiveCamera);
  });
  return <group ref={holder} />;
}

/** Disposes every geometry, material and texture under an object. */
export function disposeDeep(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((mt) => {
      for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
      mt.dispose();
    });
  });
}

/** Calls onReady after the first real frame has been drawn. */
function ReadySignal({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(() => onReady());
  });
  return null;
}

/** The canvas every page scene uses: on-demand rendering, soft tone mapping, sane DPR. */
export function StoryCanvas({
  children,
  onReady,
  camera = { position: [0, 2, 9], fov: 38 },
  shadows = false,
  dpr = [1, 1.75],
}: {
  children: ReactNode;
  onReady: () => void;
  camera?: { position: [number, number, number]; fov: number };
  shadows?: boolean;
  /** Raise for text-heavy scenes: rendering above screen resolution supersamples small text. */
  dpr?: [number, number];
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={capDpr(dpr)}
      shadows={shadows ? "percentage" : false}
      camera={{ position: camera.position, fov: camera.fov, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      {children}
      <ReadySignal onReady={onReady} />
    </Canvas>
  );
}

/**
 * Shifts the rendered frame right so the action sits beside the text column. On a
 * narrow (phone) canvas there is no text column beside it, so the frame stays centred.
 */
export function FrameOffset({ x = 0.12, narrowZoom }: { x?: number; narrowZoom?: number }) {
  const { get, size, invalidate } = useThree();
  useEffect(() => {
    const cam = get().camera as THREE.PerspectiveCamera;
    if (size.width < NARROW_CANVAS) {
      // Phones: centred, and pulled back a little so a scene built for a wide frame fits.
      // `narrowZoom` overrides it for scenes that are compact enough to show larger.
      setZoom(cam, narrowZoom ?? Math.min(1, Math.max(0.72, size.width / size.height / 1.55)));
      cam.clearViewOffset();
      invalidate();
      return () => setZoom(cam, 1);
    }
    cam.setViewOffset(size.width, size.height, -size.width * x, 0, size.width, size.height);
    invalidate();
    return () => cam.clearViewOffset();
  }, [get, size, invalidate, x, narrowZoom]);
  return null;
}

/**
 * For hero canvases laid out left-to-right: on a narrow (phone) canvas, zoom the camera
 * out until a scene `span` times as wide as it is tall fits across the frame.
 */
export function NarrowFit({ span }: { span: number }) {
  const { get, size, invalidate } = useThree();
  useEffect(() => {
    if (size.width >= NARROW_CANVAS) return;
    const cam = get().camera as THREE.PerspectiveCamera;
    setZoom(cam, Math.min(1, Math.max(0.55, size.width / size.height / span)));
    invalidate();
    return () => setZoom(cam, 1);
  }, [get, size, invalidate, span]);
  return null;
}

function setZoom(cam: THREE.PerspectiveCamera, zoom: number) {
  cam.zoom = zoom;
  cam.updateProjectionMatrix();
}

let fontFamily = "";
/** The site's body font, as the canvas should name it. */
export function siteFont() {
  if (fontFamily) return fontFamily;
  if (typeof document === "undefined") return "sans-serif";
  fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
  return fontFamily;
}

export type LabelOpts = {
  w?: number;
  h?: number;
  bg?: string;
  fg?: string;
  sub?: string;
  subFg?: string;
  radius?: number;
  size?: number;
  weight?: number;
  align?: CanvasTextAlign;
  border?: string;
  icon?: string;
};

/** Draws a rounded card with a title (and optional subtitle) into a texture. */
export function labelTexture(text: string, o: LabelOpts = {}) {
  const w = o.w ?? 512;
  const h = o.h ?? 160;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const r = o.radius ?? 36;
  if (o.bg) {
    g.fillStyle = o.bg;
    g.beginPath();
    g.roundRect(2, 2, w - 4, h - 4, r);
    g.fill();
    if (o.border) {
      g.strokeStyle = o.border;
      g.lineWidth = 4;
      g.stroke();
    }
  }
  const font = siteFont();
  const size = o.size ?? 54;
  g.fillStyle = o.fg ?? COLORS.ink;
  g.textBaseline = "middle";
  g.textAlign = o.align ?? "center";
  const x = g.textAlign === "left" ? (o.icon ? 120 : 44) : w / 2;
  if (o.icon) {
    g.font = `${size * 1.15}px ${font}`;
    g.textAlign = "center";
    g.fillText(o.icon, 66, h / 2);
    g.textAlign = o.align ?? "center";
  }
  g.font = `${o.weight ?? 650} ${size}px ${font}`;
  if (o.sub) {
    g.fillText(text, x, h * 0.4);
    g.font = `500 ${size * 0.55}px ${font}`;
    g.fillStyle = o.subFg ?? "#64748b";
    g.fillText(o.sub, x, h * 0.72);
  } else {
    g.fillText(text, x, h / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A soft round sprite texture, for glows and particles. */
export function glowTexture(color = "#5fe0e4") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, color);
  grd.addColorStop(0.35, color + "88");
  grd.addColorStop(1, color + "00");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ambient + key + rim lights shared by the light scenes. */
export function StudioLights({ dark = false }: { dark?: boolean }) {
  return (
    <>
      <hemisphereLight args={[dark ? "#9fdfff" : "#ffffff", dark ? "#061d3d" : "#cfdbe8", dark ? 0.7 : 1.4]} />
      <directionalLight position={[5, 8, 6]} intensity={dark ? 1.4 : 2.0} />
      <directionalLight position={[-6, 3, -4]} intensity={dark ? 1.2 : 0.6} color={COLORS.tealGlow} />
    </>
  );
}

/**
 * Loads the FlexicaAI symbol (without the wordmark) as a square, centred texture.
 * The logo file is a 520×130 lockup: symbol, gap, wordmark — the symbol's bounds are
 * found from its pixels so it is always centred.
 */
export function loadLogoMark(onLoad: (tex: THREE.Texture) => void) {
  const img = new Image();
  img.onload = () => {
    // The artwork is a 520×130 lockup: the symbol, a gap, then the wordmark. Draw it,
    // find the symbol's real bounds from its pixels, and centre just the symbol.
    const W = 2080;
    const H = 520;
    const src = document.createElement("canvas");
    src.width = W;
    src.height = H;
    const sg = src.getContext("2d", { willReadFrequently: true })!;
    sg.drawImage(img, 0, 0, W, H);
    const data = sg.getImageData(0, 0, W, H).data;
    const opaque = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 24;
    const colHas = (x: number) => {
      for (let y = 0; y < H; y += 2) if (opaque(x, y)) return true;
      return false;
    };
    let x0 = 0;
    while (x0 < W && !colHas(x0)) x0++;
    let x1 = x0;
    let gap = 0;
    // Walk right until a run of empty columns: that gap ends the symbol.
    for (let x = x0; x < W; x++) {
      if (colHas(x)) {
        x1 = x;
        gap = 0;
      } else if (++gap > H * 0.06) break;
    }
    let y0 = H;
    let y1 = 0;
    for (let y = 0; y < H; y++)
      for (let x = x0; x <= x1; x += 2)
        if (opaque(x, y)) {
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
          break;
        }
    const bw = x1 - x0 + 1;
    const bh = Math.max(1, y1 - y0 + 1);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    const k = (512 * 0.86) / Math.max(bw, bh);
    g.drawImage(src, x0, y0, bw, bh, (512 - bw * k) / 2, (512 - bh * k) / 2, bw * k, bh * k);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    onLoad(tex);
  };
  img.src = "/logo-mark-dark.svg";
}
