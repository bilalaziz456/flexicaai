"use client";

import { capDpr } from "../story/webgl";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { HANDSET_PATH, WHATSAPP_GREEN } from "../contact/whatsapp-icon";
import { COLORS, disposeDeep, glowTexture, lerp, loadLogoMark, siteFont } from "./scene-kit";
import { MAP_BBOX, PK_CITIES, PK_OUTLINE, PROVINCES, insidePk, toScene } from "./pakistan-map";

/**
 * WhatsApp hero: messages from all over Pakistan. A raised map of Pakistan lies in
 * space; WhatsApp messages pop up from cities across the country and arc into the
 * FlexicaAI hub, where the diary is checked, and replies arc back. Sample only.
 */

const DEPTH = 0.14;
const TOP = DEPTH + 0.03;
const HUB = new THREE.Vector3(1.9, 1.55, 1.0);
const EVERY = 0.62; // a new message every … seconds
const LIFE = 2.7;
const CHIPS = ["Booking request", "Reschedule", "Reply: YES", "Booking request", "Confirmed  ✓✓", "Reminder sent"];

const win = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const ease = (x: number) => 1 - Math.pow(1 - x, 3);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, siteFont());
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pill(text: string, fg: string, bg: string, ring: string) {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `600 34px ${siteFont()}`;
  const w = Math.ceil(probe.measureText(text).width) + 86;
  const tex = canvasTex(w, 80, (g, font) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(3, 3, w - 6, 74, 37);
    g.fill();
    g.strokeStyle = ring;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = WHATSAPP_GREEN;
    g.beginPath();
    g.arc(36, 41, 9, 0, Math.PI * 2);
    g.fill();
    g.font = `600 34px ${font}`;
    g.fillStyle = fg;
    g.textBaseline = "middle";
    g.fillText(text, 56, 42);
  });
  return { tex, aspect: 80 / w };
}

function glyph() {
  return canvasTex(160, 160, (g) => {
    g.fillStyle = WHATSAPP_GREEN;
    g.beginPath();
    g.arc(80, 76, 62, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(34, 112);
    g.lineTo(22, 146);
    g.lineTo(58, 132);
    g.fill();
    g.save();
    g.translate(48, 44);
    g.scale(2.7, 2.7);
    g.fillStyle = "#ffffff";
    g.fill(new Path2D(HANDSET_PATH));
    g.restore();
  });
}

type Api = { update: (time: number, px: number, py: number) => void; dispose: () => void };

function build(root: THREE.Group): Api {
  const glow = glowTexture(COLORS.tealGlow);
  const greenGlow = glowTexture(WHATSAPP_GREEN);
  const glyphTex = glyph();
  const sprite = (map: THREE.Texture, additive = false, opacity = 0) =>
    new THREE.Sprite(
      new THREE.SpriteMaterial({ map, transparent: true, opacity, depthWrite: false, toneMapped: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }),
    );
  const setO = (s: THREE.Sprite, o: number) => ((s.material as THREE.SpriteMaterial).opacity = o);

  // ── The map, lying back in space.
  const map = new THREE.Group();
  map.rotation.set(-0.72, 0, 0.06);
  map.position.set(-0.55, -0.8, 0);
  root.add(map);

  const V2 = ([x, y]: [number, number]) => new THREE.Vector2(...toScene(x, y));
  const shape = new THREE.Shape(PK_OUTLINE.map(V2));
  const land = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 }),
    new THREE.MeshPhysicalMaterial({ color: "#0c3463", roughness: 0.35, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.2 }),
  );
  map.add(land);

  // LED-dot surface.
  const dots: number[] = [];
  const [bx0, by0, bx1, by1] = MAP_BBOX;
  for (let y = by0; y <= by1; y += 7.5)
    for (let x = bx0; x <= bx1; x += 7.5)
      if (insidePk(x, y)) {
        const [sx, sy] = toScene(x, y);
        dots.push(sx, sy, TOP + 0.004);
      }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3));
  map.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({ color: "#39b6c9", size: 0.035, transparent: true, opacity: 0.55, depthWrite: false })));

  // Province borders (traced from the map design) and province names.
  {
    const [ax, ay] = toScene(bx0, by0);
    const [bx, by] = toScene(bx1, by1);
    const provTex = new THREE.TextureLoader().load("/maps/pakistan-provinces.png");
    provTex.anisotropy = 8;
    const prov = new THREE.Mesh(
      new THREE.PlaneGeometry(bx - ax, ay - by),
      new THREE.MeshBasicMaterial({ map: provTex, color: "#5fe0e4", transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }),
    );
    prov.position.set((ax + bx) / 2, (ay + by) / 2, TOP + 0.003);
    map.add(prov);
  }
  for (const p of PROVINCES) {
    const text = p.name.toUpperCase();
    const probe = document.createElement("canvas").getContext("2d")!;
    probe.font = `700 44px ${siteFont()}`;
    const w = Math.ceil(probe.measureText(text).width + text.length * 6) + 20;
    const tex = canvasTex(w, 72, (g, font) => {
      g.fillStyle = "rgba(124,240,196,0.55)";
      g.font = `700 44px ${font}`;
      g.letterSpacing = "6px";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, 38);
    });
    const h = 0.17 * p.size;
    const l = new THREE.Mesh(new THREE.PlaneGeometry((h * w) / 72, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    l.position.set(...toScene(p.x, p.y), TOP + 0.006);
    map.add(l);
  }

  // Glowing border.
  const border = new THREE.CatmullRomCurve3(
    PK_OUTLINE.map(([x, y]) => new THREE.Vector3(...toScene(x, y), TOP)),
    true,
    "catmullrom",
    0.1,
  );
  map.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(border, 900, 0.014, 6, true),
      new THREE.MeshBasicMaterial({ color: COLORS.tealGlow, toneMapped: false }),
    ),
  );
  const halo = sprite(glow, true, 0.3);
  halo.scale.set(7, 6, 1);
  halo.position.set(0, -0.6, -1);
  root.add(halo);

  // Cities: a light on each, labels on the major ones.
  const cities = PK_CITIES.map((c) => {
    const [x, y] = toScene(c.x, c.y);
    const local = new THREE.Vector3(x, y, TOP + 0.02);
    const light = sprite(greenGlow, true, 0.55);
    light.scale.set(0.2, 0.2, 1);
    light.position.copy(local);
    map.add(light);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.1, 40),
      new THREE.MeshBasicMaterial({ color: WHATSAPP_GREEN, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    );
    ring.position.copy(local);
    map.add(ring);
    if (c.label) {
      const tex = canvasTex(320, 80, (g, font) => {
        g.fillStyle = "#e2e8f0";
        g.font = `600 38px ${font}`;
        g.textBaseline = "middle";
        g.fillText(c.name, 8, 42);
      });
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
      l.position.set(x + 0.54, y - 0.02, TOP + 0.01);
      map.add(l);
    }
    return { c, local, light, ring };
  });

  // ── Hub: the FlexicaAI mark in a green ring, floating above the country.
  const hub = new THREE.Group();
  hub.position.copy(HUB);
  root.add(hub);
  const hubGlow = sprite(greenGlow, true, 0.5);
  hubGlow.scale.set(1.8, 1.8, 1);
  hub.add(hubGlow);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 64), new THREE.MeshBasicMaterial({ color: "#082957" }));
  hub.add(disc);
  const hubRingMat = new THREE.MeshBasicMaterial({ color: WHATSAPP_GREEN, toneMapped: false, transparent: true });
  const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 12, 96), hubRingMat);
  hub.add(hubRing);
  const markMat = new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mark = new THREE.Sprite(markMat);
  mark.scale.set(0.52, 0.52, 1);
  mark.position.z = 0.02;
  hub.add(mark);
  loadLogoMark((t) => {
    markMat.map = t;
    markMat.opacity = 1;
    markMat.needsUpdate = true;
  });
  const diaryP = pill("Diary checked", "#99f6e4", "rgba(8,51,68,0.92)", "rgba(95,224,228,0.6)");
  const diary = sprite(diaryP.tex);
  diary.scale.set(0.3 / diaryP.aspect, 0.3, 1);
  diary.position.set(0, -0.68, 0.05);
  hub.add(diary);

  // ── Message pool: each message pops from a city, flies up, a reply flies back.
  const chipTex = new Map<string, ReturnType<typeof pill>>();
  const SLOTS = Math.ceil(LIFE / EVERY) + 1;
  const pool = Array.from({ length: SLOTS }, () => {
    const g = sprite(glyphTex);
    g.scale.set(0.3, 0.3, 1);
    const up = sprite(greenGlow, true);
    up.scale.set(0.3, 0.3, 1);
    const down = sprite(glow, true);
    down.scale.set(0.26, 0.26, 1);
    const chip = sprite(glyphTex);
    const arcGeo = new THREE.BufferGeometry();
    const arcPts = new Float32Array(33 * 3);
    arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPts, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: WHATSAPP_GREEN, transparent: true, opacity: 0, toneMapped: false });
    const arc = new THREE.Line(arcGeo, arcMat);
    root.add(g, up, down, chip, arc);
    return { g, up, down, chip, arc, arcPts, arcMat, chipKey: "" };
  });
  // A fixed shuffled order so messages come from all over the country.
  // Includes the cities of Azad Kashmir and Gilgit-Baltistan (16–22).
  const order = [0, 16, 4, 1, 13, 7, 20, 2, 14, 17, 5, 9, 21, 3, 11, 19, 6, 15, 22, 8, 10, 18, 12];

  const world = new THREE.Vector3();
  const ctrl = new THREE.Vector3();
  const bez = (a: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3) => {
    const v = 1 - u;
    return out.set(v * v * a.x + 2 * v * u * ctrl.x + u * u * b.x, v * v * a.y + 2 * v * u * ctrl.y + u * u * b.y, v * v * a.z + 2 * v * u * ctrl.z + u * u * b.z);
  };

  return {
    update(time, px, py) {
      map.position.y = -0.8 + Math.sin(time * 0.6) * 0.05;
      map.updateMatrixWorld();
      hub.position.y = HUB.y + Math.sin(time * 1.1) * 0.06;
      hubRing.rotation.z = time * 0.5;

      for (const c of cities) {
        c.ring.material.opacity = 0;
        setO(c.light, 0.45);
      }

      let arrive = 0;
      const n = Math.floor(time / EVERY);
      for (let k = 0; k < SLOTS; k++) {
        const idx = n - k;
        const p = pool[((idx % SLOTS) + SLOTS) % SLOTS];
        const u = time - idx * EVERY;
        if (idx < 0 || u > LIFE) {
          setO(p.g, 0);
          setO(p.up, 0);
          setO(p.down, 0);
          setO(p.chip, 0);
          p.arcMat.opacity = 0;
          continue;
        }
        const city = cities[order[((idx % order.length) + order.length) % order.length]];
        world.copy(city.local);
        map.localToWorld(world);

        // Ping on the city.
        const ping = win(u, 0, 0.9);
        city.ring.scale.setScalar(1 + ping * 3.5);
        city.ring.material.opacity = Math.max(city.ring.material.opacity, (1 - ping) * 0.9);
        setO(city.light, 1);

        // The message pops up from the city.
        const pop = ease(win(u, 0, 0.35));
        p.g.position.copy(world).add(ctrl.set(0, 0.28 * pop, 0.1));
        setO(p.g, pop * (1 - win(u, 0.5, 0.7)));
        p.g.scale.setScalar(0.3 * (0.5 + 0.5 * pop));

        // Arc to the hub.
        const start = p.g.position.clone();
        ctrl.lerpVectors(start, hub.position, 0.5);
        ctrl.y += 0.5;
        ctrl.z += 0.6;
        for (let i = 0; i <= 32; i++) bez(start, hub.position, i / 32, world).toArray(p.arcPts, i * 3);
        p.arc.geometry.attributes.position.needsUpdate = true;
        const fly = win(u, 0.45, 1.3);
        const back = win(u, 1.5, 2.4);
        bez(start, hub.position, ease(fly), p.up.position);
        setO(p.up, fly > 0 && fly < 1 ? 1 : 0);
        bez(start, hub.position, 1 - ease(back), p.down.position);
        setO(p.down, back > 0 && back < 1 ? 1 : 0);
        p.arcMat.opacity = 0.35 * Math.sin(win(u, 0.4, 2.5) * Math.PI);
        p.arcMat.color.set(back > 0 ? COLORS.tealGlow : WHATSAPP_GREEN);
        arrive = Math.max(arrive, 1 - Math.min(1, Math.abs(u - 1.35) / 0.3));

        // Every other message shows what it is.
        if (idx % 2 === 0) {
          const text = `${CHIPS[(idx / 2) % CHIPS.length]} · ${city.c.name}`;
          if (p.chipKey !== text) {
            let ct = chipTex.get(text);
            if (!ct) {
              ct = pill(text, "#dcfce7", "rgba(6,40,30,0.9)", "rgba(37,211,102,0.65)");
              chipTex.set(text, ct);
            }
            const m = p.chip.material as THREE.SpriteMaterial;
            m.map = ct.tex;
            m.needsUpdate = true;
            p.chip.scale.set(0.26 / ct.aspect, 0.26, 1);
            p.chipKey = text;
          }
          p.chip.position.copy(start).add(ctrl.set(0, 0.32 + 0.1 * ease(win(u, 0, 0.4)), 0.15));
          setO(p.chip, win(u, 0.05, 0.3) * (1 - win(u, 1.5, 1.9)));
        } else setO(p.chip, 0);
      }

      setO(diary, 0.55 + 0.45 * arrive);
      setO(hubGlow, 0.4 + 0.4 * arrive);
      hub.scale.setScalar(1 + 0.06 * arrive);

      root.rotation.y = lerp(root.rotation.y, px * 0.12, 0.05);
      root.rotation.x = lerp(root.rotation.x, -py * 0.05, 0.05);
    },
    dispose() {
      disposeDeep(root);
      for (const c of chipTex.values()) c.tex.dispose();
      glow.dispose();
      greenGlow.dispose();
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
  useFrame(({ clock, pointer }) => api.current?.update(clock.elapsedTime, pointer.x, pointer.y));
  return <group ref={holder} />;
}

export default function WhatsAppHeroScene({ active, onReady }: { active: boolean; onReady: () => void }) {
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={capDpr([1, 1.75])}
      camera={{ position: [0, 0.2, 8.6], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
    >
      <hemisphereLight args={["#d4f5ff", "#041428", 1.1]} />
      <directionalLight position={[-3, 6, 7]} intensity={1.6} />
      <Scene onReady={onReady} />
    </Canvas>
  );
}
