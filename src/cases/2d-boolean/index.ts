import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createRenderer, createCamera, disposeObject } from '../../utils/three';
import type { Case } from '../../core/types';
import type { ManifoldToplevel, CrossSection } from 'manifold-3d';

let cleanup: (() => void) | null = null;

// 颜色：重置时 A 红（实线）/ B 蓝（虚线）；布尔结果紫（实线）
const COLOR_A = 0xff4466;
const COLOR_B = 0x4488ff;
const COLOR_RESULT = 0x8844ff;

const caseDef: Case = {
  name: '2D 布尔',
  description: 'CrossSection 交并差补（线渲染）',
  mount(container: HTMLElement, wasm: ManifoldToplevel) {
    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    // 顶视：从 +Z 看向原点，y 在屏幕上向上
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);

    const renderer = createRenderer(container);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false; // 2D 不旋转
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;

    const CS = wasm.CrossSection;

    // 输入形状：A 圆 + B 矩形，位置使二者部分重叠
    //   A: 圆心 (0, 0), r = 0.8
    //   B: 矩形 1.0 × 1.6，向右平移 (0.3, 0)
    //   → A 与 B 的交集是个"右侧被矩形裁剪的圆"
    const aCS = CS.circle(0.8, 64);
    const bCS = CS.square([1.0, 1.6], true).translate([0.3, 0]);
    // 包围框：3.0 × 3.0，覆盖两个形状
    const bbox = CS.square([3.0, 3.0], true);

    // 当前显示的 Line；当前持有的结果 CS（用于 delete）
    const lines: THREE.Line[] = [];
    let resultCS: CrossSection | null = null;

    const clearLines = () => {
      lines.forEach((l) => {
        scene.remove(l);
        l.geometry.dispose();
      });
      lines.length = 0;
    };

    // CrossSection -> 一组闭合 Line（每个 contour 一条线）
    // three@0.184 已移除 LineDashed 类（但 LineDashedMaterial 仍在）。
    // LineDashedMaterial 在 shader 中只读 `lineDistance` attribute，与对象类型无关；
    // 因此用普通 THREE.Line + 手动写入 lineDistance attribute 即可渲染虚线。
    const computeLineDistances = (geometry: THREE.BufferGeometry): void => {
      const positions = geometry.attributes.position;
      const count = positions.count;
      const lineDistance = new Float32Array(count);
      let dist = 0;
      lineDistance[0] = 0;
      for (let i = 1; i < count; i++) {
        const dx = positions.getX(i) - positions.getX(i - 1);
        const dy = positions.getY(i) - positions.getY(i - 1);
        const dz = positions.getZ(i) - positions.getZ(i - 1);
        dist += Math.sqrt(dx * dx + dy * dy + dz * dz);
        lineDistance[i] = dist;
      }
      geometry.setAttribute('lineDistance', new THREE.BufferAttribute(lineDistance, 1));
    };

    const drawCS = (
      cs: CrossSection,
      material: THREE.Material
    ): THREE.Line[] => {
      // toPolygons(): Polygons = Vec2[][]（外层是独立区域，内层是 contour 顶点）
      const polygons = cs.toPolygons();
      const out: THREE.Line[] = [];
      const isDashed = material instanceof THREE.LineDashedMaterial;
      for (const contour of polygons) {
        if (contour.length < 2) continue;
        const pts: THREE.Vector3[] = [];
        for (const v of contour) {
          // Vec2 = [x, y] → (x, y, 0)
          pts.push(new THREE.Vector3(v[0], v[1], 0));
        }
        // 闭合：首尾未重合时补一段
        const first = contour[0];
        const last = contour[contour.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          pts.push(new THREE.Vector3(first[0], first[1], 0));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(pts);
        if (isDashed) {
          computeLineDistances(geometry);
        }
        out.push(new THREE.Line(geometry, material));
      }
      return out;
    };

    // 材质（在整个 case 生命周期内复用，仅在 cleanup 释放）
    const matA = new THREE.LineBasicMaterial({ color: COLOR_A });
    const matB = new THREE.LineDashedMaterial({
      color: COLOR_B,
      dashSize: 0.08,
      gapSize: 0.05
    });
    const matResult = new THREE.LineBasicMaterial({ color: COLOR_RESULT });

    // 当前操作：'reset' | 'union' | 'intersect' | 'a-b' | 'b-a' | 'complement'
    const params = { op: 'reset' as string };

    const rebuild = () => {
      // 1) 释放旧 Line 和旧结果 CS
      clearLines();
      if (resultCS) {
        resultCS.delete();
        resultCS = null;
      }

      const op = params.op;

      // 2) reset：显示 A、B 各自（无结果）
      if (op === 'reset') {
        drawCS(aCS, matA).forEach((l) => {
          scene.add(l);
          lines.push(l);
        });
        drawCS(bCS, matB).forEach((l) => {
          scene.add(l);
          lines.push(l);
        });
        return;
      }

      // 3) 布尔操作：CrossSection 不支持 face ID 区分 A/B 源 → 只显示结果（紫色实线）
      let cs: CrossSection;
      if (op === 'union') {
        cs = aCS.add(bCS);
      } else if (op === 'intersect') {
        cs = aCS.intersect(bCS);
      } else if (op === 'a-b') {
        cs = aCS.subtract(bCS);
      } else if (op === 'b-a') {
        cs = bCS.subtract(aCS);
      } else {
        // complement: (bbox - A) ∪ (bbox - B)
        // 非 manifold-3d 官方 API（无现成 complement），通过"两个差集的并"近似
        const aComp = bbox.subtract(aCS);
        const bComp = bbox.subtract(bCS);
        cs = aComp.add(bComp);
        aComp.delete();
        bComp.delete();
      }

      resultCS = cs;
      drawCS(cs, matResult).forEach((l) => {
        scene.add(l);
        lines.push(l);
      });
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

    const gui = new GUI({ title: '2D 布尔' });
    gui.add(actions, 'union').name('并 (Union)');
    gui.add(actions, 'intersect').name('交 (Intersect)');
    gui.add(actions, 'aMinusB').name('差 A − B');
    gui.add(actions, 'bMinusA').name('差 B − A');
    gui.add(actions, 'complement').name('补 (Complement)');
    gui.add(actions, 'reset').name('重置 (Reset)');

    // 顶部小字提示
    container.style.position = 'relative';
    const note = document.createElement('div');
    note.innerHTML =
      'A 圆（红实线） + B 矩形（蓝虚线）' +
      '<br>注: 补 = (包围框 − A) ∪ (包围框 − B)，非官方 API';
    note.style.cssText =
      'position:absolute;top:12px;left:12px;background:rgba(0,0,0,0.55);' +
      'color:#bbb;padding:6px 10px;border-radius:4px;font-size:12px;' +
      'z-index:10;pointer-events:none;max-width:280px;line-height:1.6;';
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
      clearLines();
      if (resultCS) {
        resultCS.delete();
        resultCS = null;
      }
      disposeObject(scene); // 场景内无 mesh，noop
      renderer.dispose();
      aCS.delete();
      bCS.delete();
      bbox.delete();
      matA.dispose();
      matB.dispose();
      matResult.dispose();
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
