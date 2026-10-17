import * as THREE from "three";
import { ROAD_HALF_WIDTH, SAMPLE_SPACING, SHOULDER_WIDTH, newFrame, valueNoise2, type Track } from "@rr/shared";

/** Procedural asphalt with edge lines and a double yellow centre line. */
function asphaltTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const W = 512;
  const H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Wrap noise vertically so the texture tiles along the road.
      const n = valueNoise2(x * 0.35, (y % H) * 0.35, 1) * 0.5 + valueNoise2(x * 0.04, y * 0.02, 2) * 0.5;
      const grain = Math.random() * 18;
      const v = 58 + n * 14 + grain;
      const k = (y * W + x) * 4;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v + 3;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Tyre-worn darker bands in each lane.
  g.globalAlpha = 0.18;
  g.fillStyle = "#000";
  for (const lane of [0.18, 0.34, 0.66, 0.82]) g.fillRect(lane * W - 14, 0, 28, H);
  g.globalAlpha = 1;
  const px = (d: number) => ((d + ROAD_HALF_WIDTH) / (ROAD_HALF_WIDTH * 2)) * W;
  // Edge lines.
  g.fillStyle = "rgba(238,236,228,0.92)";
  g.fillRect(px(-ROAD_HALF_WIDTH + 0.25), 0, 0.15 * (W / (ROAD_HALF_WIDTH * 2)), H);
  g.fillRect(px(ROAD_HALF_WIDTH - 0.4), 0, 0.15 * (W / (ROAD_HALF_WIDTH * 2)), H);
  // Double yellow.
  g.fillStyle = "rgba(232,184,40,0.95)";
  const lw = 0.12 * (W / (ROAD_HALF_WIDTH * 2));
  g.fillRect(px(-0.18) - lw / 2, 0, lw, H);
  g.fillRect(px(0.18) - lw / 2, 0, lw, H);
  // Scuffs and patches.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "120,120,120"},${0.05 + Math.random() * 0.08})`;
    g.beginPath();
    g.ellipse(Math.random() * W, Math.random() * H, 10 + Math.random() * 60, 6 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.generateMipmaps = true;
  return tex;
}

const TEX_LENGTH = 24; // metres of road per texture repeat
const SEG = 120; // samples per road mesh piece

/** The road surface, gravel shoulders and a skirt that hides gaps against the terrain. */
export function buildRoad(track: Track, renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(renderer), roughness: 0.88, metalness: 0 });
  const shoulder = new THREE.MeshStandardMaterial({ color: 0x8f8574, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const f = newFrame();
  const edge = ROAD_HALF_WIDTH + SHOULDER_WIDTH;

  for (let start = 0; start < track.count - 1; start += SEG) {
    const end = Math.min(track.count - 1, start + SEG);
    const rows = end - start + 1;
    // Asphalt strip.
    const ap = new Float32Array(rows * 2 * 3);
    const au = new Float32Array(rows * 2 * 2);
    // Shoulder + skirt: per side 3 verts (road edge, shoulder edge, skirt bottom).
    const sp = new Float32Array(rows * 6 * 3);
    for (let r = 0; r < rows; r++) {
      const s = (start + r) * SAMPLE_SPACING;
      track.frame(s, f);
      const y = f.y + 0.02;
      for (let k = 0; k < 2; k++) {
        const d = k === 0 ? -ROAD_HALF_WIDTH : ROAD_HALF_WIDTH;
        const o = (r * 2 + k) * 3;
        ap[o] = f.x + f.rx * d;
        ap[o + 1] = y;
        ap[o + 2] = f.z + f.rz * d;
        au[(r * 2 + k) * 2] = k;
        au[(r * 2 + k) * 2 + 1] = s / TEX_LENGTH;
      }
      const ring = [
        [-ROAD_HALF_WIDTH, y - 0.005],
        [-edge, y - 0.08],
        [-edge - 0.6, y - 1.6],
        [ROAD_HALF_WIDTH, y - 0.005],
        [edge, y - 0.08],
        [edge + 0.6, y - 1.6],
      ];
      ring.forEach(([d, yy], k) => {
        const o = (r * 6 + k) * 3;
        sp[o] = f.x + f.rx * d;
        sp[o + 1] = yy;
        sp[o + 2] = f.z + f.rz * d;
      });
    }
    const ai: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      const a = r * 2;
      // right × forward = up, so (left, right, next-left) faces the sky.
      ai.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.BufferAttribute(ap, 3));
    ag.setAttribute("uv", new THREE.BufferAttribute(au, 2));
    ag.setIndex(ai);
    ag.computeVertexNormals();
    const am = new THREE.Mesh(ag, asphalt);
    am.receiveShadow = true;
    group.add(am);

    const si: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      const a = r * 6;
      const b = a + 6;
      // Left side: verts 0,1,2 run outward to the left.
      for (const [i, j] of [[0, 1], [1, 2]]) si.push(a + i, a + j, b + i, a + j, b + j, b + i);
      // Right side: verts 3,4,5 run outward to the right (opposite winding).
      for (const [i, j] of [[3, 4], [4, 5]]) si.push(a + i, b + i, a + j, a + j, b + i, b + j);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, shoulder);
    sm.receiveShadow = true;
    group.add(sm);
  }
  return group;
}
