import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createRenderer, createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case } from '../../core/types';
import type { ManifoldToplevel, Manifold, Mesh, Smoothness } from 'manifold-3d';

let cleanup: (() => void) | null = null;

type ShapeKind = 'cube' | 'tetrahedron' | 'octahedron' | 'icosahedron';

// 构造低面数 Manifold。cube / tetrahedron 走内置 API，octahedron / icosahedron
// 通过 wasm.Mesh 手动定义三角剖分后用 Manifold.ofMesh 入库。
const buildShape = (wasm: ManifoldToplevel, kind: ShapeKind): Manifold => {
  const M = wasm.Manifold;
  switch (kind) {
    case 'cube':
      return M.cube(1, true);
    case 'tetrahedron':
      return M.tetrahedron();
    case 'octahedron': {
      // 6 顶点 / 8 三角形 / 12 边；按"顶-前-右"等 CCW 顺序定义
      const v = new Float32Array([
         0,  1,  0, // 0 top
         0, -1,  0, // 1 bottom
         1,  0,  0, // 2 right
        -1,  0,  0, // 3 left
         0,  0,  1, // 4 front
         0,  0, -1  // 5 back
      ]);
      const tris = new Uint32Array([
         0, 4, 2,  0, 2, 5,  0, 5,  3,  0, 3, 4, // 上面 4 个三角形
         1, 2, 4,  1, 4, 3,  1, 3,  5,  1, 5, 2  // 下面 4 个三角形
      ]);
      const m = new wasm.Mesh({ numProp: 3, vertProperties: v, triVerts: tris });
      return M.ofMesh(m);
    }
    case 'icosahedron': {
      // 12 顶点 / 20 三角形 / 30 边；黄金比例构造并归一化到单位球
      const t = (1 + Math.sqrt(5)) / 2;
      const len = Math.sqrt(1 + t * t);
      const v = new Float32Array([
        -1,  t,  0,   1,  t,  0,  -1, -t,  0,   1, -t,  0,
         0, -1,  t,   0,  1,  t,   0, -1, -t,   0,  1, -t,
         t,  0, -1,   t,  0,  1,  -t,  0, -1,  -t,  0,  1
      ]);
      for (let i = 0; i < v.length; i++) v[i] /= len;
      const tris = new Uint32Array([
         0, 11,  5,   0,  5,  1,   0,  1,  7,   0,  7, 10,   0, 10, 11,
         1,  5,  9,   5, 11,  4,  11, 10,  2,  10,  7,  6,   7,  1,  8,
         3,  9,  4,   3,  4,  2,   3,  2,  6,   3,  6,  8,   3,  8,  9,
         4,  9,  5,   2,  4, 11,   6,  2, 10,   8,  6,  7,   9,  8,  1
      ]);
      const m = new wasm.Mesh({ numProp: 3, vertProperties: v, triVerts: tris });
      return M.ofMesh(m);
    }
  }
};

// 计算"保留硬边"时需要锁定的半边集合。
//   - cube：锁定 y=+0.5 / y=-0.5 两个面的 4 条周长边（即半边的两个端点都在同一极面）
//   - 其他形状：锁定 max-y 顶点和 min-y 顶点相邻的所有边
// 返回的 Smoothness 列表可直接作为 M.smooth 的第二个参数。
const findLockableHalfedges = (mesh: Mesh, shape: ShapeKind): Smoothness[] => {
  const verts = mesh.vertProperties;
  const tris = mesh.triVerts;
  const result: Smoothness[] = [];
  const eps = 1e-6;

  if (shape === 'cube') {
    for (let t = 0; t < tris.length / 3; t++) {
      const tri: [number, number, number] = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
      for (let e = 0; e < 3; e++) {
        const [a, b] = edges[e];
        const ya = verts[tri[a] * 3 + 1];
        const yb = verts[tri[b] * 3 + 1];
        const topFace = Math.abs(ya - 0.5) < eps && Math.abs(yb - 0.5) < eps;
        const bottomFace = Math.abs(ya + 0.5) < eps && Math.abs(yb + 0.5) < eps;
        if (topFace || bottomFace) {
          result.push({ halfedge: t * 3 + e, smoothness: 0 });
        }
      }
    }
  } else {
    // 找 y 最大 / 最小的顶点（视作"顶 / 底"极）
    let topVert = -1;
    let bottomVert = -1;
    let topY = -Infinity;
    let bottomY = Infinity;
    const numVerts = verts.length / 3;
    for (let v = 0; v < numVerts; v++) {
      const y = verts[v * 3 + 1];
      if (y > topY) {
        topY = y;
        topVert = v;
      }
      if (y < bottomY) {
        bottomY = y;
        bottomVert = v;
      }
    }
    for (let t = 0; t < tris.length / 3; t++) {
      const tri: [number, number, number] = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      const edges: [number, number][] = [[0, 1], [1, 2], [2, 0]];
      for (let e = 0; e < 3; e++) {
        const [a, b] = edges[e];
        if (
          tri[a] === topVert ||
          tri[b] === topVert ||
          tri[a] === bottomVert ||
          tri[b] === bottomVert
        ) {
          result.push({ halfedge: t * 3 + e, smoothness: 0 });
        }
      }
    }
  }
  return result;
};

const caseDef: Case = {
  name: '平滑 / Smooth',
  description: 'Manifold.smooth 构造切线 + refine 插值得到 G1 连续曲面，可选择保留硬边',
  mount(container: HTMLElement, wasm: ManifoldToplevel) {
    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.set(1.6, 1.4, 2.4);
    camera.lookAt(0, 0, 0);

    const renderer = createRenderer(container);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 灯光：smooth 后的曲面需要光照才能看出明暗变化
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(5, 5, 5);
    camera.add(dirLight);
    scene.add(camera);

    const params: {
      shape: ShapeKind;
      refine: number;
      lockTopBottom: boolean;
      wireframe: boolean;
    } = {
      shape: 'cube',
      refine: 3,
      lockTopBottom: false,
      wireframe: false
    };

    let currentManifold: Manifold | null = null;
    let currentMesh: THREE.Mesh | null = null;

    const rebuild = () => {
      // 释放旧资源
      if (currentManifold) {
        currentManifold.delete();
        currentManifold = null;
      }
      if (currentMesh) {
        scene.remove(currentMesh);
        currentMesh.geometry.dispose();
        (currentMesh.material as THREE.Material).dispose();
        currentMesh = null;
      }

      const M = wasm.Manifold;

      // 1) 构造低面数基础体
      const baseM = buildShape(wasm, params.shape);
      const baseMesh = baseM.getMesh();

      // 2) 调用 smooth，可选传入锁定的硬边
      const sharpenedEdges = params.lockTopBottom
        ? findLockableHalfedges(baseMesh, params.shape)
        : undefined;
      let manifold: Manifold = M.smooth(baseMesh, sharpenedEdges);

      // 3) refine 把切线插值成可见曲面；refine(0) 等价于"切线已加但未插值"
      if (params.refine > 0) {
        manifold = manifold.refine(params.refine);
      }

      // 4) 构造 Three.js 网格
      const finalMesh = manifold.getMesh();
      const geometry = manifoldMesh2geometry(finalMesh);
      const material = new THREE.MeshPhongMaterial({
        color: 0x44aaff,
        flatShading: false, // 必须关闭，否则插值出来的曲面被法线当量覆盖回硬边
        shininess: 80,
        wireframe: params.wireframe
      });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      currentManifold = manifold;
      currentMesh = mesh;

      // 5) 释放中间 Manifold；baseMesh 内部数据随 baseM 释放
      baseM.delete();
    };

    rebuild();

    const gui = new GUI({ title: 'Smooth 参数' });
    gui
      .add(params, 'shape', ['cube', 'tetrahedron', 'octahedron', 'icosahedron'] as ShapeKind[])
      .name('基础形状')
      .onChange(rebuild);
    gui
      .add(params, 'refine', 0, 25, 1)
      .name('refine 次数 (0–25)')
      .onChange(rebuild);
    gui
      .add(params, 'lockTopBottom')
      .name('保留顶/底硬边')
      .onChange(rebuild);
    gui
      .add(params, 'wireframe')
      .name('线框模式')
      .onChange((v: boolean) => {
        if (currentMesh) {
          (currentMesh.material as THREE.MeshPhongMaterial).wireframe = v;
        }
      });

    let raf = 0;
    const animate = () => {
      if (currentMesh) currentMesh.rotation.y += 0.006;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', onResize);

    cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      gui.destroy();
      controls.dispose();
      if (currentManifold) currentManifold.delete();
      if (currentMesh) {
        currentMesh.geometry.dispose();
        (currentMesh.material as THREE.Material).dispose();
      }
      disposeObject(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  }
};

export default caseDef;
