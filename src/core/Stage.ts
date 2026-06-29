import * as THREE from 'three';

/**
 * 右侧展示舞台。负责：
 * - 创建 stage 容器 DOM
 * - 创建共享 WebGLRenderer（canvas 永久挂在容器中，所有 case 复用同一个 WebGL context）
 *
 * WebGLRenderer 由 Stage 持有，整个应用生命周期内不重建，
 * 避免多个 case 切换时累积 WebGL context 触发浏览器上限警告。
 */
export class Stage {
  private el: HTMLElement;
  private renderer: THREE.WebGLRenderer;

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'stage';

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a1a, 1.0);
    // canvas 初始尺寸由首个 case 在 mount 中通过 setSize 设置
    this.el.appendChild(this.renderer.domElement);
  }

  getElement(): HTMLElement {
    return this.el;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }
}