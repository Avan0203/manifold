import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case, CaseContext } from '../../core/types';
import type { Manifold } from 'manifold-3d';
// manifoldCAD 的 high-level API：内部 importManifold
import { importManifold } from 'manifold-3d/manifoldCAD';
// @gltf-transform/core：用于把 JSON 格式 .gltf 转成 GLB 再走 manifold 的二进制 importer
import { NodeIO } from '@gltf-transform/core';
// fflate：3MF 是 ZIP 包，需要解包 → 修改 XML → 重新打包预处理（剥除命名空间前缀）
import { unzipSync, zipSync } from 'fflate';

/**
 * manifold-3d 的 import-3mf 用 fast-xml-parser 解析 3D/3dmodel.model，
 * 但只查 `parsed.model.resources?.object` 这条固定路径。
 * 网上下载的 3MF 通常带显式命名空间（xmlns:m="http://schemas.3mf.io/..."），
 * 因为生产 / materials / beam-lattice 等扩展都依赖命名空间。
 * 带前缀的 XML 解析后会变成 m:model / m:resources / m:object 等，
 * manifold 的代码完全找不到 model.resources.object，最后 fallback 也只能拿到空 objects Map，
 * 整个 Document 没有 mesh → 报 "Model contains no meshes!"。
 *
 * 预处理：解压 → 改 3D/3dmodel.model 剥掉前缀与 xmlns:* 声明 → 重新打包。
 */
const preprocess3mf = (buf: ArrayBuffer): ArrayBuffer => {
  const files = unzipSync(new Uint8Array(buf));
  // 3MF 是 OPC 包，模型 entry 路径通常为 3D/3dmodel.model；少数工具用绝对路径 /3D/3dmodel.model
  const entryKey = files['3D/3dmodel.model']
    ? '3D/3dmodel.model'
    : files['/3D/3dmodel.model']
      ? '/3D/3dmodel.model'
      : null;
  if (!entryKey) {
    throw new Error('3MF 中未找到 3D/3dmodel.model');
  }
  let xml = new TextDecoder().decode(files[entryKey]);
  // 1) 移除 xmlns:prefix="..." 属性声明（保留默认 xmlns="..."，不影响解析）
  xml = xml.replace(/\s+xmlns:[a-zA-Z][\w-]*="[^"]*"/g, '');
  // 2) 把标签前缀 ns:tag → tag；正则只在 < 或 </ 后匹配标签名，不会误伤属性值中的 ":"
  xml = xml.replace(/<([a-zA-Z][\w-]*):([a-zA-Z][\w-]*)/g, '<$2');
  xml = xml.replace(/<\/([a-zA-Z][\w-]*):([a-zA-Z][\w-]*)/g, '</$2');

  files[entryKey] = new TextEncoder().encode(xml);
  const zipped = zipSync(files, { level: 6 });
  // zipSync 返回 Uint8Array 视图，需要拷贝出独立的 ArrayBuffer（避免底层 buffer 被回收）
  const out = new ArrayBuffer(zipped.byteLength);
  new Uint8Array(out).set(zipped);
  return out;
};
// scene-builder 把 Manifold 转成 GLTF-Transform Document（导出所需中间格式）
import { manifoldToGLTFDoc } from 'manifold-3d/lib/scene-builder';
// export-model 负责把 Document 序列化为二进制 Blob（支持 .gltf / .glb / .3mf）
import { toBlob } from 'manifold-3d/lib/export-model';

let cleanup: (() => void) | null = null;

// 固定的默认场景：2×2×2 立方体减去一根横向贯穿的圆柱 —— 单 Manifold，视觉上明显是实体
const buildDefaultManifold = (M: typeof window.wasm.Manifold): Manifold => {
  const cube = M.cube([2, 2, 2], true);
  // 圆柱长 2.2 略大于立方体尺寸，保证贯穿；rotate 让圆柱沿 X 轴
  const hole = M.cylinder(1, 2.2, 2.2, 48, false).rotate([90, 0, 0]);
  return cube.subtract(hole);
};

const caseDef: Case = {
  name: '导入导出',
  description: 'Manifold 模型 gltf / glb / 3mf 导入导出',
  mount(ctx: CaseContext) {
    const { container, renderer, wasm } = ctx;
    renderer.setSize(container.clientWidth, container.clientHeight);

    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
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

    // 当前显示的 manifold + mesh —— 每次导入会替换并释放旧的
    let currentManifold: Manifold | null = null;
    let currentMesh: THREE.Mesh | null = null;

    const buildMesh = (m: Manifold): THREE.Mesh => {
      const geometry = manifoldMesh2geometry(m.getMesh());
      const material = new THREE.MeshPhongMaterial({
        color: 0x44aaff,
        shininess: 80,
        flatShading: false
      });
      return new THREE.Mesh(geometry, material);
    };

    // 替换场景：释放旧 manifold/mesh，根据新模型 bbox 自动调整相机距离
    const replaceScene = (newManifold: Manifold) => {
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

      const mesh = buildMesh(newManifold);
      scene.add(mesh);
      currentManifold = newManifold;
      currentMesh = mesh;

      // bbox 驱动相机距离：包围盒最大边 * 2.5，保证完整入镜
      const bbox = new THREE.Box3().setFromObject(mesh);
      const size = bbox.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const dist = maxDim * 2.5;
      camera.position.set(dist, dist * 0.8, dist);
      camera.lookAt(0, 0, 0);
      controls.update();
    };

    // 初始化默认场景
    replaceScene(buildDefaultManifold(M));

    // 触发浏览器下载的工具方法
    const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // GUI
    const gui = new GUI({ title: '导入导出' });
    const params = {
      format: 'glb' as 'gltf' | 'glb' | '3mf',
      status: '就绪'
    };

    gui.add(params, 'format', ['glb', 'gltf', '3mf']).name('导出格式');

    const statusCtrl = gui.add(params, 'status').name('状态').disable();

    const actions = {
      export: async () => {
        if (!currentManifold) return;
        try {
          params.status = '导出中...';
          statusCtrl.updateDisplay();
          const doc = await manifoldToGLTFDoc(currentManifold);
          const blob = await toBlob(doc, { extension: params.format });
          downloadBlob(blob, `manifold.${params.format}`);
          params.status = `已导出 manifold.${params.format}（${(blob.size / 1024).toFixed(1)} KB）`;
        } catch (err) {
          console.error('[import-export] 导出失败', err);
          params.status = `导出失败：${(err as Error).message}`;
        }
        statusCtrl.updateDisplay();
      }
    };
    gui.add(actions, 'export').name('导出当前模型');

    // 文件选择器：lil-gui 不直接支持 file input，把按钮放进 GUI 触发一个隐藏 input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.gltf,.glb,.3mf';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        params.status = `导入 ${file.name} 中...`;
        statusCtrl.updateDisplay();
        const lower = file.name.toLowerCase();

        // manifold-3d 的 gltf-io importer 只注册了 GLB 二进制格式（model/gltf-binary），
        // JSON 格式的 .gltf 直接传 ArrayBuffer 会被 readBinary 当坏 GLB 解析，返回空 Document。
        // 所以 .gltf 走：TextDecoder → JSON.parse → NodeIO.readJSON → writeBinary → 走 GLB 通道
        let buf: ArrayBuffer;
        let mimetype: string;
        if (lower.endsWith('.gltf')) {
          const text = new TextDecoder().decode(await file.arrayBuffer());
          const jsonDoc = { json: JSON.parse(text), resources: {} };
          const doc = await new NodeIO().readJSON(jsonDoc);
          const glb = await new NodeIO().writeBinary(doc);
          buf = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
          mimetype = 'model/gltf-binary';
        } else if (lower.endsWith('.glb')) {
          buf = await file.arrayBuffer();
          mimetype = 'model/gltf-binary';
        } else if (lower.endsWith('.3mf')) {
          // manifold 的 import-3mf 不处理 XML 命名空间前缀；剥除后再交给 importManifold
          buf = preprocess3mf(await file.arrayBuffer());
          mimetype = 'model/3mf';
        } else {
          throw new Error(`不支持的文件扩展名：${file.name}`);
        }

        // importManifold 内部会 union 所有子节点；tolerance 用于闭合小缺口帮助流形化
        const manifold = await importManifold(buf, { mimetype, tolerance: 0.001 });
        replaceScene(manifold);
        params.status = `已导入 ${file.name}`;
      } catch (err) {
        console.error('[import-export] 导入失败', err);
        params.status = `导入失败：${(err as Error).message}`;
      }
      statusCtrl.updateDisplay();
      fileInput.value = ''; // 重置以便同名文件可再次选择
    });
    document.body.appendChild(fileInput);

    const importActions = { import: () => fileInput.click() };
    gui.add(importActions, 'import').name('导入 gltf / glb / 3mf');

    // 动画 + resize
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
      if (fileInput.parentNode) fileInput.parentNode.removeChild(fileInput);
      // renderer 与 canvas 由 Stage 永久持有，不要 dispose / removeChild
    };
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  }
};

export default caseDef;