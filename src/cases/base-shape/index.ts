import * as THREE from 'three';
import { GUI } from 'lil-gui';
import { createRenderer, createCamera, disposeObject, getTexture } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case } from '../../core/types';
import { ManifoldToplevel } from 'manifold-3d/manifold.js';
import { OrbitControls } from 'three/examples/jsm/Addons.js';
import xPng from '../../assets/x.png';


let cleanup: (() => void) | null = null;

const caseDef: Case = {
  name: '基础几何体',
  description: 'Manifold 内置基本图形',
  mount(container: HTMLElement, wasm: ManifoldToplevel) {
    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.z = 7;



    const renderer = createRenderer(container);

    const controls = new OrbitControls(camera, renderer.domElement);


    // 物理材质需要灯光才能着色，从而看清边界
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 3);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    const texture = getTexture(xPng);

    // 通过 Manifold 构造 5 个内置基本图形
    const M = wasm.Manifold;
    const manifolds = [
      M.tetrahedron(),
      M.cube(1, true),
      M.cylinder(1, 0.5, 0.5, 32, true),
      M.sphere(0.6, 32)
    ];
    const colors = [0xff5577, 0x00ff88, 0x4488ff, 0xffcc00];
    const spacing = 2;
    // 4 个形状是否启用 flatShading：硬边几何 (tetrahedron/cube) 启用，曲面几何 (cylinder/sphere) 关闭
    //  - cylinder 侧面顶点法线在径向上已连续，关掉后侧壁插值光滑；顶/底帽平面三角形法线都一致，平均后还是法向 → 帽天然平
    //  - sphere 顶点法线在球面上连续，关掉后 GPU 在三角形间插值即得光滑球面
    const shapeConfigs = [
      { flat: true,  color: colors[0] }, // tetrahedron
      { flat: true,  color: colors[1] }, // cube
      { flat: true, color: colors[2] }, // cylinder
      { flat: true, color: colors[3] }, // sphere
    ];

    const meshes: THREE.Mesh[] = manifolds.map((m, i) => {
      const geometry = manifoldMesh2geometry(m.getMesh());
      geometry.computeVertexNormals(); // flatShading 下会被 fragment shader 的 dFdx/dFdy 忽略，但保留对 matcap/normal 之外的材质兜底
      const cfg = shapeConfigs[i];
      const material = new THREE.MeshMatcapMaterial({
        color: cfg.color,
        matcap: texture,
        flatShading: cfg.flat,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = (i - (manifolds.length - 1) / 2) * spacing;
      return mesh;
    });
    meshes.forEach((mesh) => scene.add(mesh));

    // 调试用：法线可视化的 Normal 材质，所有几何体共享同一份实例
    // 关闭 flatShading：直接显示 vertex normal 实际数据（sphere 渐变 / cube 角点 averaged 后的对角色）
    // 要确认硬边渲染则切回 Matcap 模式（cube 仍 flatShading: true）
    const normalMaterial = new THREE.MeshNormalMaterial();
    // 材质下拉：Matcap 维持当前 4 份带色实例，Normal 切换时所有 mesh 共用一份
    const materialPresets: Record<string, THREE.Material | THREE.Material[]> = {
      Matcap: meshes.map((m) => m.material as THREE.Material),
      Normal: normalMaterial,
    };

    const gui = new GUI({ title: '基础几何参数' });
    gui
      .add({ material: 'Matcap' }, 'material', Object.keys(materialPresets))
      .name('材质')
      .onChange((type: string) => {
        const preset = materialPresets[type];
        meshes.forEach((mesh, i) => {
          mesh.material = Array.isArray(preset) ? preset[i] : preset;
        });
      });

    const normals = meshes[1].geometry.getAttribute('normal');
    console.log('normals: ', normals);

    let raf = 0;
    const animate = () => {
      meshes.forEach((mesh, i) => {
        mesh.rotation.y += 0.005 + i * 0.002;
      });
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
      disposeObject(scene);
      renderer.dispose();
      manifolds.forEach((m) => m.delete());
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
