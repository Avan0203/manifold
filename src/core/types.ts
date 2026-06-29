import type * as THREE from 'three';
import type { ManifoldToplevel } from 'manifold-3d';

/**
 * 案例挂载上下文。WebGLRenderer 由 Stage 创建一次并永久持有，所有 case 复用同一个
 * WebGL context，避免切换时累积 context 触发浏览器警告。
 */
export interface CaseContext {
  /** 案例挂载的 DOM 容器（stage 元素） */
  container: HTMLElement;
  /** 共享的 WebGLRenderer（canvas 已挂在 container 中） */
  renderer: THREE.WebGLRenderer;
  /** Manifold WASM 顶层命名空间 */
  wasm: ManifoldToplevel;
}

/**
 * 案例接口契约：每个 case 文件必须 export default 一个 Case 实例。
 *
 * 用户只需要关注：name / description（UI 展示）+ mount（写 three.js 场景）+ unmount（释放资源）
 */
export interface Case {
  /** 侧边栏显示的主标题 */
  name: string;
  /** 侧边栏显示的副标题（可选） */
  description?: string;
  /**
   * 挂载案例。每个 case 在 mount 中：
   * 1. 使用 ctx.renderer 创建 scene / camera / controls（renderer 是共享的，不要 new WebGLRenderer）
   * 2. 创建并添加 mesh
   * 3. 调用 renderer.setSize 适配容器
   * 4. 启动动画循环
   * 5. 注册 resize 事件
   * 6. 将 cleanup 逻辑保留以便 unmount 调用
   */
  mount: (ctx: CaseContext) => void;
  /**
   * 卸载案例。必须：
   * 1. cancelAnimationFrame
   * 2. removeEventListener resize
   * 3. disposeObject(scene) 释放本案例的 geometry / material / texture（renderer 共享，不要 dispose）
   * 4. controls.dispose() / gui.destroy()
   * 5. 释放 Manifold / CrossSection
   * 6. 移除本案例自己添加到 container 的 DOM 元素（renderer.domElement 不要动）
   */
  unmount: () => void;
}

/**
 * 案例注册元数据。注册表只持有 Meta（轻量），实际 Case 通过 load() 懒加载。
 * 这样壳启动阶段不需要下载所有 case 模块。
 */
export interface CaseMeta {
  /** 唯一 key，路由 #/case/<key> */
  key: string;
  /** 侧边栏主标题 */
  name: string;
  /** 侧边栏副标题（可选） */
  description?: string;
  /** 懒加载案例模块，返回完整 Case 实例 */
  load: () => Promise<Case>;
}
