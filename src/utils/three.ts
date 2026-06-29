import * as THREE from 'three';

/**
 * 创建标准透视相机（fov=75, near=0.1, far=1000）。
 */
export function createCamera(aspect: number): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
}

const textureLoader = new THREE.TextureLoader();
export function getTexture(path: string): THREE.Texture {
  return textureLoader.load(path);
}

/**
 * 递归释放一个 Object3D 子树中所有 mesh 的 geometry / material / texture。
 * 在 unmount 中调用，防止 GPU 资源泄漏。
 */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => disposeMaterial(m));
      } else if (mesh.material) {
        disposeMaterial(mesh.material);
      }
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  // 释放材质引用的贴图
  for (const key of Object.keys(material)) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}