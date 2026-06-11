import type { ManifoldToplevel } from 'manifold-3d';
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
   * 挂载案例到容器。每个 case 在 mount 中：
   * 1. 创建 scene / camera / renderer
   * 2. 创建并添加 mesh
   * 3. 启动动画循环
   * 4. 注册 resize 事件
   * 5. 将 cleanup 逻辑保留以便 unmount 调用
   */
  mount: (container: HTMLElement, wasm: ManifoldToplevel) => void;
  /**
   * 卸载案例。必须：
   * 1. cancelAnimationFrame
   * 2. removeEventListener resize
   * 3. dispose geometry / material / texture
   * 4. renderer.dispose() 并移除 canvas
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
