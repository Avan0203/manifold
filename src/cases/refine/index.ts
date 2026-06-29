import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case, CaseContext } from '../../core/types';
import type { ManifoldToplevel, Manifold } from 'manifold-3d';

let cleanup: (() => void) | null = null;

type ShapeKind = 'cube' | 'sphere' | 'cylinder';

const buildBaseShape = (wasm: ManifoldToplevel, kind: ShapeKind): Manifold => {
  const M = wasm.Manifold;
  switch (kind) {
    case 'cube':
      return M.cube(1, true);
    case 'sphere':
      return M.sphere(0.6, 32);
    case 'cylinder':
      return M.cylinder(1, 0.5, 0.5, 16, true);
  }
};

// 根据几何体位置生成渐变色 vertex colors
// 颜色根据 Y 坐标在 HSV 色彩空间插值（蓝 → 青 → 绿 → 黄 → 红）
const applyGradientColors = (geometry: THREE.BufferGeometry): void => {
  const positions = geometry.attributes.position;
  const count = positions.count;
  const colors = new Float32Array(count * 3);

  // 先计算 Y 坐标范围
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = positions.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = maxY - minY || 1;

  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const y = positions.getY(i);
    const t = (y - minY) / range; // 0..1
    // 使用 HSL 渐变：240° (蓝) -> 0° (红)
    color.setHSL(0.66 - t * 0.66, 0.85, 0.55);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
};

const caseDef: Case = {
  name: '细分 / Refine',
  description: 'Manifold refine / refineToLength / refineToTolerance 三种细分方法',
  mount(ctx: CaseContext) {
    const { container, renderer, wasm } = ctx;
    renderer.setSize(container.clientWidth, container.clientHeight);

    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.set(0, 2, 8);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(5, 5, 5);
    camera.add(dirLight);
    scene.add(camera);

    const shapes: ShapeKind[] = ['cube', 'sphere', 'cylinder'];
    const spacing = 2;

    const params: {
      n: number;
      length: number;
      tolerance: number;
      wireframe: boolean;
    } = {
      n: 2,
      length: 1,
      tolerance: 0.1,
      wireframe: true
    };

    let baseManifolds: Map<ShapeKind, Manifold> = new Map();
    let currentManifolds: Map<ShapeKind, Manifold> = new Map();
    let currentMeshes: Map<ShapeKind, THREE.Mesh> = new Map();

    const rebuild = () => {
      currentManifolds.forEach((m) => m.delete());
      currentManifolds.clear();

      currentMeshes.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      currentMeshes.clear();

      shapes.forEach((kind) => {
        let baseM = baseManifolds.get(kind);
        if (!baseM) {
          baseM = buildBaseShape(wasm, kind);
          baseManifolds.set(kind, baseM);
        }

        let manifold: Manifold = baseM.refine(params.n);
        manifold = manifold.refineToLength(params.length);
        manifold = manifold.refineToTolerance(params.tolerance);

        const finalMesh = manifold.getMesh();
        const geometry = manifoldMesh2geometry(finalMesh);
        applyGradientColors(geometry);
        const material = new THREE.MeshPhongMaterial({
          vertexColors: true,
          flatShading: false,
          shininess: 80,
          wireframe: params.wireframe
        });
        const mesh = new THREE.Mesh(geometry, material);

        const index = shapes.indexOf(kind);
        mesh.position.x = (index - (shapes.length - 1) / 2) * spacing;

        scene.add(mesh);
        currentManifolds.set(kind, manifold);
        currentMeshes.set(kind, mesh);
      });
    };

    rebuild();

    const gui = new GUI({ title: 'Refine 参数' });
    gui
      .add(params, 'n', [2, 4, 8, 16, 32])
      .name('refine')
      .onChange(rebuild);
    gui
      .add(params, 'length', 0.1, 1, 0.01)
      .name('RefineToLength')
      .onChange(rebuild);
    gui
      .add(params, 'tolerance', [1, 0.1, 0.01, 0.001])
      .name('RefineToTolerance')
      .onChange(rebuild);
    gui
      .add(params, 'wireframe')
      .name('线框模式')
      .onChange((v: boolean) => {
        currentMeshes.forEach((mesh) => {
          (mesh.material as THREE.MeshPhongMaterial).wireframe = v;
        });
      });

    let raf = 0;
    const animate = () => {
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
      baseManifolds.forEach((m) => m.delete());
      currentManifolds.forEach((m) => m.delete());
      currentMeshes.forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      disposeObject(scene);
      // renderer 与 canvas 由 Stage 永久持有，不要 dispose / removeChild
    };
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  }
};

export default caseDef;