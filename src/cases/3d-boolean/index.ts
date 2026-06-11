import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createRenderer, createCamera, disposeObject } from '../../utils/three';
import type { Case } from '../../core/types';
import type { ManifoldToplevel, Manifold, Mesh as ManifoldMesh } from 'manifold-3d';

let cleanup: (() => void) | null = null;

// 颜色：2 个材质 —— A 派生的面用 matA 红，B 派生的面用 matB 蓝
// bbox 派生面（complement 产生）fallback 到 matA 红
const COLOR_A = 0xff4466;
const COLOR_B = 0x4488ff;

const caseDef: Case = {
  name: '3D 布尔',
  description: 'Manifold 交并差补',
  mount(container: HTMLElement, wasm: ManifoldToplevel) {
    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.set(3, 3, 5);
    camera.lookAt(0, 0, 0);

    const renderer = createRenderer(container);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // 灯光（Phong 材质需要）
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(5, 5, 5);
    camera.add(dirLight);
    scene.add(camera);

    const M = wasm.Manifold;

    // 预分配 originalID：A、B、bbox 各一个
    //   manifold-3d 的 reserveIDs 只对"从 BufferGeometry 构造的 Manifold"有效。
    //   M.sphere / M.cube 等原生构造不响应预分配（其 originalID 由 manifold-3d 内部分配），
    //   boolean 后 b 派生的面会被分配新 ID，不再是 reserveIDs 的值，区分失效。
    //   因此改用 BufferGeometry + addGroup + 显式 runOriginalID 构造（参考 manifold three.ts 案例）。
    const firstID = M.reserveIDs(3);
    const ID_A = firstID;
    const ID_B = firstID + 1;
    const ID_BBOX = firstID + 2;
    // materialIndex → originalID（addGroup 内部用）
    const matIdx2ID = [ID_A, ID_B, ID_BBOX];

    // BufferGeometry -> ManifoldMesh（带显式 runOriginalID）
    // Mesh 运行时类在 wasm 命名空间上（ManifoldToplevel.Mesh），ESM 顶层无导出
    const geometry2mesh = (geom: THREE.BufferGeometry, ids: number[]): ManifoldMesh => {
      const vertProperties = geom.attributes.position.array as Float32Array;
      const triVerts = geom.index != null
        ? (geom.index.array as Uint32Array)
        : new Uint32Array(vertProperties.length / 3).map((_, idx) => idx);
      const starts = geom.groups.map((g) => g.start);
      const originalIDs = geom.groups.map((g) => ids[g.materialIndex!]);
      const indices = Array.from(starts.keys()).sort((a, b) => starts[a] - starts[b]);
      const runIndex = new Uint32Array(indices.map((i) => starts[i]));
      const runOriginalID = new Uint32Array(indices.map((i) => originalIDs[i]));
      const mesh = new wasm.Mesh({
        numProp: 3,
        vertProperties,
        triVerts,
        runIndex,
        runOriginalID
      });
      mesh.merge();
      return mesh;
    };

    // 输入形状：A 球 + B 立方体 + 包围框 bbox
    //   A: 球心 (0, 0, 0), r = 0.9
    //   B: 立方体 1.4³，向右平移 (0.3, 0, 0)
    //   → A 与 B 部分重叠：球左半伸出立方体，立方体右半伸出球
    const aSphereGeom = new THREE.SphereGeometry(0.9, 32, 16);
    aSphereGeom.clearGroups();
    aSphereGeom.addGroup(0, aSphereGeom.index!.count, 0); // materialIndex 0 → ID_A
    const aMan = new M(geometry2mesh(aSphereGeom, matIdx2ID));

    const bCubeGeom = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    bCubeGeom.clearGroups();
    bCubeGeom.addGroup(0, bCubeGeom.index!.count, 1); // materialIndex 1 → ID_B
    const bMan = new M(geometry2mesh(bCubeGeom, matIdx2ID)).translate([0.3, 0, 0]);

    // 包围框：覆盖两个形状的最大范围
    const bboxGeom = new THREE.BoxGeometry(3.4, 3.4, 3.4);
    bboxGeom.clearGroups();
    bboxGeom.addGroup(0, bboxGeom.index!.count, 2); // materialIndex 2 → ID_BBOX
    const bbox = new M(geometry2mesh(bboxGeom, matIdx2ID));

    // originalID → material index 映射
    //   A 用 mat[0] 红，B 用 mat[1] 蓝
    //   bbox 派生面（complement 产生）originalID = ID_BBOX → fallback 到 0 (matA 红)
    //   boolean 之后每个三角形 run 保留原 originalID，从而分到对应材质
    const id2matIndex = new Map<number, number>();
    id2matIndex.set(ID_A, 0);
    id2matIndex.set(ID_B, 1);

    // 2 个材质：与 id2matIndex 的 matIndex 一一对应
    const matA = new THREE.MeshPhongMaterial({ color: COLOR_A, flatShading: true });
    const matB = new THREE.MeshPhongMaterial({ color: COLOR_B, flatShading: true });
    const materials = [matA, matB];

    // Manifold Mesh -> BufferGeometry（按 originalID 分组 addGroup，使多材质按来源着色）
    const mesh2geometry = (mesh: ManifoldMesh): THREE.BufferGeometry => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertProperties, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));

      // mesh.runIndex / runOriginalID 已按 runOriginalID 排序；遍历合并相邻同 ID 的 run
      const runIndex = mesh.runIndex;
      const runOriginalID = mesh.runOriginalID;
      const numRun = mesh.numRun;
      let curID = runOriginalID[0];
      let curStart = runIndex[0];
      for (let run = 0; run < numRun; ++run) {
        const nextID = runOriginalID[run + 1];
        if (nextID !== curID) {
          const end = runIndex[run + 1];
          const matIndex = id2matIndex.get(curID) ?? 0;
          geometry.addGroup(curStart, end - curStart, matIndex);
          curID = nextID;
          curStart = end;
        }
      }
      return geometry;
    };

    // 当前显示的 mesh；当前持有的结果 Manifold（用于 delete）
    const meshes: THREE.Mesh[] = [];
    let resultMan: Manifold | null = null;

    const clearMeshes = () => {
      meshes.forEach((m) => {
        scene.remove(m);
        m.geometry.dispose();
        // mesh.material 是数组，由 materials 统一持有，cleanup 统一 dispose
      });
      meshes.length = 0;
    };

    // mesh 用 materials 数组；通过 addGroup 按 originalID 自动选用对应材质
    const makeMesh = (man: Manifold): THREE.Mesh => {
      const geometry = mesh2geometry(man.getMesh());
      return new THREE.Mesh(geometry, materials);
    };

    // 当前操作：'reset' | 'union' | 'intersect' | 'a-b' | 'b-a' | 'complement'
    const params = { op: 'reset' as string };

    const rebuild = () => {
      // 1) 释放旧 mesh 和旧结果
      clearMeshes();
      if (resultMan) {
        resultMan.delete();
        resultMan = null;
      }

      const op = params.op;

      if (op === 'reset') {
        // 重置：A 红 + B 蓝（保持默认重叠位置）
        const aMesh = makeMesh(aMan);
        const bMesh = makeMesh(bMan);
        scene.add(aMesh);
        scene.add(bMesh);
        meshes.push(aMesh, bMesh);
        return;
      }

      // 布尔结果
      let man: Manifold;
      if (op === 'union') {
        man = aMan.add(bMan);
      } else if (op === 'intersect') {
        man = aMan.intersect(bMan);
      } else if (op === 'a-b') {
        man = aMan.subtract(bMan);
      } else if (op === 'b-a') {
        man = bMan.subtract(aMan);
      } else {
        // complement: (bbox - A) ∪ (bbox - B)
        // 非 manifold-3d 官方 API（无现成 complement），通过"两个差集的并"近似
        const aComp = bbox.subtract(aMan);
        const bComp = bbox.subtract(bMan);
        man = aComp.add(bComp);
        aComp.delete();
        bComp.delete();
      }

      resultMan = man;
      const mesh = makeMesh(man);
      scene.add(mesh);
      meshes.push(mesh);
    };

    rebuild();

    // GUI：用"按钮"形式触发每个操作
    const actions = {
      union: () => {
        params.op = 'union';
        rebuild();
      },
      intersect: () => {
        params.op = 'intersect';
        rebuild();
      },
      aMinusB: () => {
        params.op = 'a-b';
        rebuild();
      },
      bMinusA: () => {
        params.op = 'b-a';
        rebuild();
      },
      complement: () => {
        params.op = 'complement';
        rebuild();
      },
      reset: () => {
        params.op = 'reset';
        rebuild();
      }
    };

    const gui = new GUI({ title: '3D 布尔' });
    gui.add(actions, 'union').name('并 (Union)');
    gui.add(actions, 'intersect').name('交 (Intersect)');
    gui.add(actions, 'aMinusB').name('差 A − B');
    gui.add(actions, 'bMinusA').name('差 B − A');
    gui.add(actions, 'complement').name('补 (Complement)');
    gui.add(actions, 'reset').name('重置 (Reset)');

    // 顶部小字提示：补 = (bbox − A) ∪ (bbox − B)，非官方 API
    container.style.position = 'relative';
    const note = document.createElement('div');
    note.textContent = '注: 补 = (包围框 − A) ∪ (包围框 − B)，非官方 API';
    note.style.cssText =
      'position:absolute;top:12px;left:12px;background:rgba(0,0,0,0.55);' +
      'color:#bbb;padding:6px 10px;border-radius:4px;font-size:12px;' +
      'z-index:10;pointer-events:none;max-width:260px;line-height:1.5;';
    container.appendChild(note);

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
      clearMeshes();
      if (resultMan) {
        resultMan.delete();
        resultMan = null;
      }
      disposeObject(scene);
      renderer.dispose();
      matA.dispose();
      matB.dispose();
      aMan.delete();
      bMan.delete();
      bbox.delete();
      if (note.parentNode === container) container.removeChild(note);
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
