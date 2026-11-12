"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NARROW_CANVAS, capDpr } from "../story/webgl";
import { COLORS, disposeDeep, glowTexture, lerp, siteFont } from "./scene-kit";
import { canvas2d, drawIcon, texOf, type Icon } from "./scene-ui";

/**
 * Patient management hero: the patient as a hologram.
 * A translucent teal figure (the sample patient model, CC0, see public/models/CREDITS.md)
 * stands on a glowing platform. A scan ring builds the figure from the feet up; then the
 * record appears beside it — name and MRN, then allergy, last visit, X-ray, plan and
 * bill — each a glass label wired to a point on the body. Loops every CYCLE seconds.
 * Sample patient only.
 */

const CYCLE = 13;
const FIG_H = 3.2; // figure height, world units
const FLOOR = -1.75;

type Entry = { icon: Icon; title: string; sub: string; warn?: boolean; at: number /* 0–1 up the body */ };
const ENTRIES: Entry[] = [
  { icon: "cross", title: "Allergy · Penicillin", sub: "Shown before any treatment", warn: true, at: 0.9 },
  { icon: "calendar", title: "Last visit · 14 Nov", sub: "Tonsillitis · Dr. Sana Malik", at: 0.8 },
  { icon: "image", title: "X-ray attached", sub: "Beside the note it belongs to", at: 0.66 },
  { icon: "plan", title: "Treatment plan & estimate", sub: "On the clinic letterhead", at: 0.5 },
  { icon: "bill", title: "Invoice paid", sub: "Receipt in the same record", at: 0.36 },
];
const T_BUILD = [0.2, 2.0];
const T_NAME = 1.6;
const T_ENTRY = (i: number) => 2.4 + i * 1.05;
const T_OUT = CYCLE - 1.1;

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

// ── Textures

/** A glass label: icon disc, title, one line of detail. */
function cardTexture(icon: Icon, title: string, sub: string, warn = false) {
  const font = siteFont();
  const m = document.createElement("canvas").getContext("2d")!;
  m.font = `700 36px ${font}`;
  const tw = m.measureText(title).width;
  m.font = `500 25px ${font}`;
  const sw = m.measureText(sub).width;
  const W = Math.ceil(Math.max(tw, sw) + 150);
  const H = 128;
  const { c, g } = canvas2d(W, H);
  g.fillStyle = warn ? "rgba(58,34,3,0.9)" : "rgba(6,29,61,0.88)";
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 6, 26);
  g.fill();
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "rgba(255,255,255,0.12)");
  grd.addColorStop(0.55, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = warn ? "rgba(251,191,36,0.75)" : "rgba(95,224,228,0.6)";
  g.lineWidth = 3;
  g.stroke();
  // Icon disc.
  g.fillStyle = warn ? "rgba(251,191,36,0.18)" : "rgba(95,224,228,0.16)";
  g.beginPath();
  g.arc(64, H / 2, 38, 0, Math.PI * 2);
  g.fill();
  if (warn) {
    g.fillStyle = "#fbbf24";
    g.beginPath();
    g.moveTo(64, H / 2 - 20);
    g.lineTo(86, H / 2 + 17);
    g.lineTo(42, H / 2 + 17);
    g.closePath();
    g.fill();
    g.fillStyle = "#3a2203";
    g.font = `800 24px ${font}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("!", 64, H / 2 + 5);
    g.textAlign = "left";
  } else {
    drawIcon(g, icon, 64, H / 2, 19, COLORS.tealGlow, "#061d3d");
  }
  g.textBaseline = "middle";
  g.fillStyle = warn ? "#fcd34d" : "#ffffff";
  g.font = `700 36px ${font}`;
  g.fillText(title, 122, H / 2 - 18);
  g.fillStyle = warn ? "#fbbf24" : "#9fb3c8";
  g.font = `500 25px ${font}`;
  g.fillText(sub, 122, H / 2 + 22);
  return { tex: texOf(c), aspect: W / H };
}

/** The name card: avatar, name, details. */
function nameTexture() {
  const W = 700;
  const H = 150;
  const { c, g } = canvas2d(W, H);
  const font = siteFont();
  g.fillStyle = "rgba(6,29,61,0.9)";
  g.beginPath();
  g.roundRect(3, 3, W - 6, H - 6, 32);
  g.fill();
  g.strokeStyle = "rgba(95,224,228,0.75)";
  g.lineWidth = 3;
  g.stroke();
  const grd = g.createLinearGradient(30, 30, 120, 120);
  grd.addColorStop(0, COLORS.tealGlow);
  grd.addColorStop(1, COLORS.teal);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(78, H / 2, 46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#04152e";
  g.font = `800 34px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("AK", 78, H / 2 + 2);
  g.textAlign = "left";
  g.fillStyle = "#ffffff";
  g.font = `700 44px ${font}`;
  g.fillText("Ayesha Khan", 148, H / 2 - 20);
  g.fillStyle = "#9fb3c8";
  g.font = `500 27px ${font}`;
  g.fillText("F · 34 yrs · MRN FA-100248", 148, H / 2 + 26);
  return { tex: texOf(c), aspect: W / H };
}

// ── The hologram material: fresnel rim, moving scan lines, built from the feet up.

type HoloUniforms = { uTime: { value: number }; uReveal: { value: number }; uOpacity: { value: number } };

function hologramMaterial(u: HoloUniforms) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#000000",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vHoloY;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHoloY = (modelMatrix * vec4(transformed, 1.0)).y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vHoloY;\nuniform float uTime;\nuniform float uReveal;\nuniform float uOpacity;")
      .replace(
        "#include <dithering_fragment>",
        `
        vec3 hn = normalize(normal);
        vec3 hv = normalize(vViewPosition);
        float fres = pow(1.0 - abs(dot(hn, hv)), 1.6);
        float scan = 0.6 + 0.4 * sin(vHoloY * 46.0 - uTime * 5.0);
        float band = smoothstep(0.0, 0.08, uReveal - vHoloY);
        float edge = 1.0 - smoothstep(0.0, 0.1, abs(uReveal - vHoloY));
        vec3 base = mix(vec3(0.02, 0.32, 0.38), vec3(0.37, 0.88, 0.89), fres);
        gl_FragColor.rgb = base * scan + vec3(0.7, 1.0, 1.0) * (fres * 0.55 + edge * 1.2);
        gl_FragColor.a = (0.16 + fres * 0.8 + edge) * band * uOpacity;
        #include <dithering_fragment>`,
      );
  };
  return mat;
}

// ── The scene

type Api = { update: (time: number, delta: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group, narrow: boolean, onReady: () => void): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const add = <T extends THREE.Object3D>(o: T, parent: THREE.Object3D = root) => (parent.add(o), o);
  const glowSprite = (color: string, size: number, opacity = 1) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
    );
    s.scale.set(size, size, 1);
    return s;
  };
  const labelSprite = (tex: THREE.Texture, aspect: number, h: number) => {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.scale.set(h * aspect, h, 1);
    s.center.set(0, 0.5);
    s.renderOrder = 20;
    return s;
  };

  // Layout: figure on the left, record on the right. On a phone the figure and its
  // platform shrink so the labels can stay large and nothing meets the frame's edge.
  const figH = narrow ? 2.75 : FIG_H;
  const floor = narrow ? -1.5 : FLOOR;
  const padS = narrow ? 0.8 : 1;
  const figX = narrow ? -1.12 : -1.45;
  const labelX = narrow ? -0.42 : -0.25;
  const cardH = narrow ? 0.36 : 0.36;
  const stage = add(new THREE.Group());
  stage.position.x = narrow ? 0.05 : 0.1;

  // ── Platform: a disc with rings and a beam of light.
  const platform = add(new THREE.Group(), stage);
  platform.position.set(figX, floor, 0);
  // The disc, rings, beam and scan ring scale on their own; the figure keeps true height.
  const pad = add(new THREE.Group(), platform);
  pad.scale.set(padS, 1, padS);
  const disc = add(
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.05, 0.12, 64),
      new THREE.MeshStandardMaterial({ color: "#0a2547", metalness: 0.5, roughness: 0.35, emissive: "#0b3d6b", emissiveIntensity: 0.4 }),
    ),
    pad,
  );
  disc.position.y = -0.06;
  const ringMats: THREE.MeshBasicMaterial[] = [];
  const rings = [0.98, 0.78, 0.55].map((r, i) => {
    const m = new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, transparent: true, opacity: 0.8 - i * 0.18, toneMapped: false, depthWrite: false });
    ringMats.push(m);
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(r, i === 0 ? 0.018 : 0.008, 8, 96), m), pad);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    return ring;
  });
  const floorGlow = add(glowSprite(COLORS.teal, 1, 0.65), pad);
  floorGlow.scale.set(3.2, 1.1, 1);
  floorGlow.position.y = 0.05;
  // The beam: an open cone, brighter at the base.
  const beamGeo = new THREE.CylinderGeometry(0.7, 0.95, figH * 1.05, 48, 1, true);
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: "varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying float vY; uniform float uOpacity; void main(){ gl_FragColor = vec4(0.2,0.8,0.85, pow(1.0 - vY, 2.2) * 0.32 * uOpacity); }",
  });
  const beam = add(new THREE.Mesh(beamGeo, beamMat), pad);
  beam.position.y = (figH * 1.05) / 2;

  // The scan ring that builds the figure.
  const scanMat = new THREE.MeshBasicMaterial({ color: "#a5f3fc", transparent: true, opacity: 0, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const scan = add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 8, 96), scanMat), pad);
  scan.rotation.x = Math.PI / 2;
  const scanGlow = add(glowSprite(COLORS.tealGlow, 1, 0), pad);
  scanGlow.scale.set(1.8, 0.35, 1);

  // ── The figure (loaded), as a hologram.
  const uniforms: HoloUniforms = { uTime: { value: 0 }, uReveal: { value: floor }, uOpacity: { value: 1 } };
  const holo = hologramMaterial(uniforms);
  const figure = add(new THREE.Group(), platform);
  let mixer: THREE.AnimationMixer | null = null;
  let disposed = false;
  new GLTFLoader().load(
    "/models/patient.glb",
    (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const k = figH / Math.max(0.001, box.max.y - box.min.y);
      model.scale.multiplyScalar(k);
      model.position.y = -box.min.y * k;
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const old = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        old.forEach((m) => m.dispose());
        mesh.material = holo;
      });
      figure.add(model);
      mixer = new THREE.AnimationMixer(model);
      const clip = THREE.AnimationClip.findByName(gltf.animations, "HumanArmature|Female_Idle") ?? gltf.animations[0];
      if (clip) mixer.clipAction(clip).play();
      requestAnimationFrame(onReady);
    },
    undefined,
    () => requestAnimationFrame(onReady), // the labels still tell the story without the figure
  );

  // ── The record beside it.
  const name = nameTexture();
  const nameCard = add(labelSprite(name.tex, name.aspect, narrow ? 0.42 : 0.46), stage);
  nameCard.position.set(labelX, floor + figH * 1.04 + (narrow ? 0.12 : 0), 0.4);

  const anchorX = figX + 0.16 * (figH / FIG_H);
  const entries = ENTRIES.map((e, i) => {
    const cd = cardTexture(e.icon, e.title, e.sub, e.warn);
    const card = add(labelSprite(cd.tex, cd.aspect, cardH), stage);
    const y = floor + figH * 0.86 - i * (narrow ? 0.56 : 0.6);
    card.position.set(labelX + 0.25, y, 0.4);
    const anchor = new THREE.Vector3(anchorX, floor + figH * e.at, 0.25);
    const elbow = new THREE.Vector3(labelX - 0.1, y, 0.35);
    const end = new THREE.Vector3(labelX + 0.22, y, 0.4);
    const color = e.warn ? "#fbbf24" : COLORS.tealGlow;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([anchor, anchor.clone(), anchor.clone()]);
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false, depthTest: false });
    const line = add(new THREE.Line(lineGeo, lineMat), stage);
    line.renderOrder = 15;
    const dot = add(glowSprite(color, 0.26, 0), stage);
    dot.position.copy(anchor);
    return { i, card, lineGeo, lineMat, dot, pts: { anchor, elbow, end }, y };
  });

  // Motes rising through the beam.
  const motes = Array.from({ length: 22 }, (_, i) => {
    const s = add(glowSprite(COLORS.tealGlow, 0.05 + (i % 3) * 0.03, 0), pad);
    return { s, a: i * 2.4, r: 0.3 + ((i * 0.37) % 1) * 0.55, sp: 0.25 + (i % 4) * 0.08, ph: (i * 0.618) % 1 };
  });

  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();

  return {
    update(time, delta, px, py) {
      const t = time % CYCLE;
      const out = 1 - win(t, T_OUT, CYCLE - 0.25);
      uniforms.uTime.value = time;
      mixer?.update(delta);

      // Build the figure with the scan ring, bottom to top.
      const b = ease(win(t, T_BUILD[0], T_BUILD[1]));
      const reveal = floor - 0.05 + b * (figH + 0.2);
      uniforms.uReveal.value = t < T_BUILD[1] ? reveal : floor + figH + 1;
      uniforms.uOpacity.value = out;
      const scanning = t >= T_BUILD[0] && t <= T_BUILD[1] + 0.2 ? 1 : 0;
      scan.position.y = reveal - floor;
      scanGlow.position.y = scan.position.y;
      scanMat.opacity = scanning * 0.9 * out;
      (scanGlow.material as THREE.SpriteMaterial).opacity = scanning * 0.55;
      beamMat.uniforms.uOpacity.value = (0.6 + 0.4 * Math.sin(time * 1.7)) * out + 0.2;

      // A slow turn, so the hologram reads as 3D.
      figure.rotation.y = Math.sin(time * 0.45) * 0.55;
      rings.forEach((r, i) => (r.rotation.z = time * (i % 2 ? -0.4 : 0.6)));
      ringMats[0].opacity = 0.7 + 0.2 * Math.sin(time * 3);

      // Name card, then each entry: the line draws out from the body, then the card slides in.
      const nIn = ease(win(t, T_NAME, T_NAME + 0.5)) * out;
      (nameCard.material as THREE.SpriteMaterial).opacity = nIn;
      nameCard.position.y = floor + figH * 1.04 + (narrow ? 0.12 : 0) + 0.12 * (1 - nIn);
      for (const en of entries) {
        const s = T_ENTRY(en.i);
        const draw = ease(win(t, s, s + 0.45));
        const show = ease(win(t, s + 0.3, s + 0.75)) * out;
        const d1 = Math.min(1, draw * 2);
        const d2 = Math.max(0, draw * 2 - 1);
        p1.lerpVectors(en.pts.anchor, en.pts.elbow, d1);
        p2.lerpVectors(en.pts.elbow, en.pts.end, d2);
        if (d1 < 1) p2.copy(p1);
        const pos = en.lineGeo.attributes.position as THREE.BufferAttribute;
        pos.setXYZ(1, p1.x, p1.y, p1.z);
        pos.setXYZ(2, p2.x, p2.y, p2.z);
        pos.needsUpdate = true;
        en.lineMat.opacity = 0.85 * win(t, s, s + 0.1) * out;
        (en.dot.material as THREE.SpriteMaterial).opacity = win(t, s, s + 0.15) * out * (0.75 + 0.25 * Math.sin(time * 4 + en.i));
        en.dot.scale.setScalar(0.26 * (1 + 0.6 * (1 - win(t, s, s + 0.5))));
        (en.card.material as THREE.SpriteMaterial).opacity = show;
        en.card.position.x = labelX + 0.25 + 0.25 * (1 - show);
        en.card.position.y = en.y + Math.sin(time * 1.2 + en.i) * 0.015;
      }

      for (const m of motes) {
        const u = (time * m.sp * 0.25 + m.ph) % 1;
        m.s.position.set(Math.cos(m.a + time * 0.4) * m.r, u * figH, Math.sin(m.a + time * 0.4) * m.r);
        (m.s.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI) * 0.7 * out;
      }

      root.rotation.y = lerp(root.rotation.y, px * 0.12, 0.05);
      root.rotation.x = lerp(root.rotation.x, -py * 0.05, 0.05);
    },
    dispose() {
      disposed = true;
      mixer?.stopAllAction();
      holo.dispose();
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
    const built = build(root, narrow, () => readyRef.current());
    api.current = built;
    return () => {
      api.current = null;
      built.dispose();
      root.clear();
    };
  }, [narrow]);
  useFrame(({ clock, pointer }, delta) => api.current?.update(clock.elapsedTime, Math.min(delta, 0.1), pointer.x, pointer.y));
  return <group ref={holder} />;
}

export default function PatientHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1.25, 2])}
      camera={{ position: [0, 0.05, 7.2], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#cdf3ff", "#041428", 1.1]} />
      <directionalLight position={[3, 5, 6]} intensity={1.6} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
