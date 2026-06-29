import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { createCamera, disposeObject } from '../../utils/three';
import { manifoldMesh2geometry } from '../../utils/manifold';
import type { Case, CaseContext } from '../../core/types';
import type { CrossSection, Manifold, Vec2 } from 'manifold-3d';

let cleanup: (() => void) | null = null;

const caseDef: Case = {
  name: '面拉伸 / Extrude',
  description: 'Manifold 2D 截面沿 Z 轴拉伸为 3D 实体',
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

    // 灯光（Phong 材质需要）
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 4);
    dirLight.position.set(5, 5, 5);
    camera.add(dirLight);
    scene.add(camera);

    // 构造 4 个 2D 截面，统一居中
    // 注意：所有 CrossSection 实例（含中间临时对象）都需在 cleanup 中显式 .delete()
    const CS = wasm.CrossSection;
    // 圆环：分别持有外圆/内圆引用，便于在 cleanup 中释放
    const ringOuter = CS.circle(0.7, 48);
    const ringInner = CS.circle(0.35, 48);
    const ring = ringOuter.subtract(ringInner);
    // 五角星轮廓（外接圆半径 0.8，10 个顶点交错）
    const starPoints: Vec2[][] = [[]];
    const starOuter = 0.8;
    const starInner = 0.35;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? starOuter : starInner;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      starPoints[0].push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const star = new CS(starPoints);
    // 4 个主体截面
    const circleMain = CS.circle(0.7, 48);
    const squareMain = CS.square([1.4, 1.4]);

    const crossSections: Array<{ cs: CrossSection; color: number; x: number }> = [
      { cs: circleMain, color: 0xff4466, x: -3.75 },
      { cs: squareMain, color: 0x44ff88, x: -1.25 },
      { cs: ring, color: 0x4488ff, x: 1.25 },
      { cs: star, color: 0xffcc00, x: 3.75 }
    ];

    const M = wasm.Manifold;
    const params = { height: 1.2 };
    let manifolds: Manifold[] = crossSections.map(({ cs }) =>
      M.extrude(cs, params.height, 1, 0, [1, 1], true)
    );

    const meshes: THREE.Mesh[] = crossSections.map((item, i) => {
      const geometry = manifoldMesh2geometry(manifolds[i].getMesh());
      const material = new THREE.MeshPhongMaterial({ color: item.color, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.x = item.x;
      return mesh;
    });
    meshes.forEach((mesh) => scene.add(mesh));

    // GUI：实时控制拉伸高度（每个 case 自带 GUI 实例，mount 创建 / unmount 销毁，跟随案例生命周期）
    const gui = new GUI({ title: '面拉伸参数' });
    gui
      .add(params, 'height', 0.2, 5.0, 0.05)
      .name('高度 height')
      .onChange((height: number) => {
        // 释放旧 manifold
        manifolds.forEach((m) => m.delete());
        // 重新拉伸
        manifolds = crossSections.map(({ cs }) =>
          M.extrude(cs, height, 1, 0, [1, 1], true)
        );
        // 替换 mesh.geometry
        meshes.forEach((mesh, i) => {
          const geom = manifoldMesh2geometry(manifolds[i].getMesh());
          mesh.geometry.dispose();
          mesh.geometry = geom;
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
      disposeObject(scene);
      // 显式释放 Manifold；CrossSection（含中间临时对象）随 JS 闭包 GC 自动释放 C++ 端，
      // 避免重复 delete 触发 "instance already deleted"
      manifolds.forEach((m) => m.delete());
      // renderer 与 canvas 由 Stage 永久持有，不要 dispose / removeChild
    };
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  }
};

export default caseDef;