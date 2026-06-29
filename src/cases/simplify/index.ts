import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case, CaseContext } from '../../core/types';
import type { ManifoldToplevel, Manifold } from 'manifold-3d';

let cleanup: (() => void) | null = null;

type ShapeKind = 'cube' | 'sphere' | 'cylinder';
// 容差下拉选项：
//   数值（0.1 / 0.01 / 0.001）→ simplify(数值)
//   'auto'                      → simplify() 不传参，使用原 mesh 当前容差
//   -1                          → 不调用 simplify，直接渲染原始细分 mesh
type ToleranceOpt = 0.1 | 0.01 | 0.001 | 'auto' | -1;
const TOLERANCE_OPTIONS: ToleranceOpt[] = [-1, 0.1, 0.01, 0.001, 'auto'];

// 调色板：每个形状一种颜色，方便横向对比
const COLORS = [0x44aaff, 0xff6644, 0x44dd88];
const SPACING = 2.4;

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

const caseDef: Case = {
  name: '简化 / Simplify',
  description: 'asOriginal + simplify 对已细分模型做容差简化',
  mount(ctx: CaseContext) {
    const { container, renderer, wasm } = ctx;
    renderer.setSize(container.clientWidth, container.clientHeight);

    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.set(0, 2.2, 9);
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

    const params: {
      tolerance: ToleranceOpt;
      wireframe: boolean;
    } = {
      // 0.001 给一个能看出细节差异但又不太卡的默认值
      tolerance: -1,
      wireframe: true
    };

    // 基础形状：只在 mount 时构建一次
    const baseManifolds = new Map<ShapeKind, Manifold>();
    // "原始细分 mesh"：每个基础形状经 refine + asOriginal 后的结果。
    // asOriginal 会合并共面相邻面 + 重置 originalID，得到一个干净的"原始"，
    // 后续 simplify 永远基于它（不会受前一次简化的影响）。
    // 该 Map 持有的 Manifold 在整个 case 生命周期内不释放。
    const originalSubdivided = new Map<ShapeKind, Manifold>();
    // 当前显示的简化结果：每次容差变化都重新 simplify + 替换
    const currentManifolds = new Map<ShapeKind, Manifold>();
    const currentMeshes = new Map<ShapeKind, THREE.Mesh>();

    // 初始化：构建 base → refine → asOriginal → 首次 simplify → 渲染
    shapes.forEach((kind) => {
      const baseM = buildBaseShape(wasm, kind);
      baseManifolds.set(kind, baseM);
      // refine 把基础形状细分成大量三角面；asOriginal 把 refine 产生的共面相邻三角形合并掉
      const original = baseM.refine(8).asOriginal();
      originalSubdivided.set(kind, original);
    });

    // 把"用数值选项还是 undefined"统一在一个地方
    const resolveTolerance = (opt: ToleranceOpt): number | undefined =>
      opt === 'auto' ? undefined : opt;

    const applySimplify = () => {
      // 释放旧的简化结果与 Three.js 网格
      currentManifolds.forEach((m) => m.delete());
      currentManifolds.clear();
      currentMeshes.forEach((mesh) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      currentMeshes.clear();

      const opt = params.tolerance;
      // -1：跳过 simplify，直接显示原始细分 mesh；其它选项才走 simplify
      const skipSimplify = opt === -1;
      const t = skipSimplify ? undefined : resolveTolerance(opt);

      shapes.forEach((kind, i) => {
        // 关键：永远从 originalSubdivided 出发，保证每次都基于"原始细分 mesh"
        const source = originalSubdivided.get(kind)!;
        const displayManifold = skipSimplify ? source : source.simplify(t);

        const geometry = manifoldMesh2geometry(displayManifold.getMesh());
        const material = new THREE.MeshPhongMaterial({
          color: COLORS[i],
          shininess: 60,
          flatShading: false,
          wireframe: params.wireframe
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.x = (i - (shapes.length - 1) / 2) * SPACING;

        scene.add(mesh);
        // -1 时 displayManifold 就是 originalSubdivided 中的引用，不能放进 currentManifolds
        // 否则下一轮 applySimplify 会把它当成简化结果 delete 掉，连带毁掉原始 mesh
        if (!skipSimplify) {
          currentManifolds.set(kind, displayManifold);
        }
        currentMeshes.set(kind, mesh);
      });
    };

    applySimplify();

    const gui = new GUI({ title: 'Simplify 参数' });
    gui
      .add(params, 'tolerance',
        {
          'original (no simplify)': -1,
          '0.1': 0.1,
          '0.01': 0.01,
          '0.001': 0.001,
          auto: 'auto',
        }
      )
      .name('容差')
      .onChange(applySimplify);
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
      // 释放顺序：先释放当前简化结果，再释放稳定的"原始细分"，最后释放基础形状
      currentManifolds.forEach((m) => m.delete());
      originalSubdivided.forEach((m) => m.delete());
      baseManifolds.forEach((m) => m.delete());
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