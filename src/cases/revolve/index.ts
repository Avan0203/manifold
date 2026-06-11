import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createRenderer, createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case } from '../../core/types';
import type { ManifoldToplevel, Manifold, Vec2 } from 'manifold-3d';

let cleanup: (() => void) | null = null;

const caseDef: Case = {
  name: '车削 / Revolve',
  description: '2D 截面绕 Y 轴旋转生成 3D 实体',
  mount(container: HTMLElement, wasm: ManifoldToplevel) {
    const scene = new THREE.Scene();
    const camera = createCamera(container.clientWidth / container.clientHeight);
    camera.position.set(0, 1, 14);
    camera.lookAt(0, 0.75, 0);

    const renderer = createRenderer(container);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.75, 0);

    // 灯光（Phong 材质需要）
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(5, 5, 5);
    camera.add(dirLight);
    scene.add(camera);

    const CS = wasm.CrossSection;
    const M = wasm.Manifold;

    // 4 个 2D 截面轮廓：所有顶点 x >= 0（位于旋转轴正 X 侧）
    // 轮廓为逆时针绕轴侧的闭合多边形，所围区域即旋转生成的实体
    const profiles: Array<{ name: string; color: number; x: number; points: Vec2[] }> = [
      {
        name: '花瓶',
        color: 0xff5577,
        x: -4.5,
        points: [
          [0.5, 0.0],
          [0.55, 0.2],
          [0.7, 0.5],
          [0.4, 0.9],
          [0.6, 1.2],
          [0.5, 1.4],
          [0.3, 1.5]
        ]
      },
      {
        name: '高脚杯',
        color: 0x44ddaa,
        x: -1.5,
        points: [
          [0.0, 0.0],
          [0.5, 0.0],
          [0.5, 0.1],
          [0.1, 0.1],
          [0.1, 0.9],
          [0.6, 0.95],
          [0.6, 1.5],
          [0.0, 1.5]
        ]
      },
      {
        name: '瓶子',
        color: 0x4488ff,
        x: 1.5,
        points: [
          [0.4, 0.0],
          [0.4, 1.1],
          [0.35, 1.15],
          [0.2, 1.25],
          [0.2, 1.45],
          [0.25, 1.5]
        ]
      },
      {
        name: '圆环',
        color: 0xffcc44,
        x: 4.5,
        points: [
          [0.3, 0.6],
          [0.5, 0.6],
          [0.5, 0.8],
          [0.3, 0.8]
        ]
      }
    ];

    // 扫略角度 = 旋转总角度（0–360°）
    // 扫略半径 = 截面到旋转轴的距离：把每个截面的 x 坐标整体加上该值
    //            radius=0 → 标准车削；radius>0 → 绕距轴 radius 处的圆周扫掠，生成环面
    const params = { angle: 360, radius: 0 };

    const buildManifolds = (): Manifold[] => {
      return profiles.map((p) => {
        const offset: Vec2[] = p.points.map(([x, y]) => [x + params.radius, y] as Vec2);
        const cs = new CS([offset]);
        return M.revolve(cs, 64, params.angle);
      });
    };

    let manifolds = buildManifolds();
    const meshes: THREE.Mesh[] = profiles.map((p, i) => {
      const geometry = manifoldMesh2geometry(manifolds[i].getMesh());
      const material = new THREE.MeshPhongMaterial({
        color: p.color,
        flatShading: true,
        shininess: 60
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = p.x;
      return mesh;
    });
    meshes.forEach((m) => scene.add(m));

    const rebuild = () => {
      manifolds.forEach((m) => m.delete());
      manifolds = buildManifolds();
      meshes.forEach((mesh, i) => {
        const geom = manifoldMesh2geometry(manifolds[i].getMesh());
        mesh.geometry.dispose();
        mesh.geometry = geom;
      });
    };

    const gui = new GUI({ title: '车削参数' });
    gui
      .add(params, 'angle', 0, 360, 1)
      .name('扫略角度 (°)')
      .onChange(rebuild);
    gui
      .add(params, 'radius', 0, 2, 0.01)
      .name('扫略半径')
      .onChange(rebuild);

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
