import * as THREE from 'three';
import type { Case, CaseContext } from './types';
import { getCase } from './registry';
import type { ManifoldToplevel } from 'manifold-3d';

/**
 * 案例生命周期管理器。
 * 核心职责：切换案例时先卸载旧案例，再挂载新案例。
 *
 * WebGLRenderer 由 Stage 创建并永久持有，本类不创建/销毁 renderer，
 * 也不清空 stage DOM —— canvas 是共享资源，永远保留在 stage 中。
 * case 自己添加到 container 的辅助 DOM 元素（如 note / file input）由 case 自己的 cleanup 处理。
 */
export class CaseManager {
  private currentKey: string | null = null;
  private currentCase: Case | null = null;
  private inflightKey: string | null = null;
  private stageEl: HTMLElement;
  private renderer: THREE.WebGLRenderer;

  constructor(stageEl: HTMLElement, renderer: THREE.WebGLRenderer, private wasm: ManifoldToplevel) {
    this.stageEl = stageEl;
    this.renderer = renderer;
  }

  /**
   * 切换到指定 key 的案例。串行执行：unmount(old) → load(new) → mount(new)
   * load 是异步（动态 import case 模块）。inflightKey 防止用户快速连点时旧加载结果覆盖新切换。
   */
  async switchCase(key: string): Promise<void> {
    if (this.currentKey === key) return;
    this.inflightKey = key;

    const meta = getCase(key);
    if (!meta) {
      console.warn(`[CaseManager] Case "${key}" 未注册`);
      return;
    }

    // 1. 卸载旧案例
    if (this.currentCase) {
      try {
        this.currentCase.unmount();
      } catch (err) {
        console.error(`[CaseManager] 卸载 "${this.currentKey}" 出错:`, err);
      }
      this.currentCase = null;
      this.currentKey = null;
    }

    // 注意：不再清空 stage DOM —— canvas 是 Stage 持有的共享资源，case 切换时不动它。
    // case 自己 appendChild 的辅助 DOM 元素（如 note / file input）由该 case 的 cleanup 移除。

    // 2. 加载并挂载新案例
    try {
      const nextCase = await meta.load();
      if (this.inflightKey !== key) return; // 期间用户切换到别的 case，丢弃本次结果
      const ctx: CaseContext = { container: this.stageEl, renderer: this.renderer, wasm: this.wasm };
      nextCase.mount(ctx);
      this.currentCase = nextCase;
      this.currentKey = key;
    } catch (err) {
      console.error(`[CaseManager] 加载/挂载 "${key}" 出错:`, err);
      this.currentCase = null;
      this.currentKey = null;
    }
  }

  getCurrentKey(): string | null {
    return this.currentKey;
  }
}