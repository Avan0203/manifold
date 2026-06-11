import type { Case } from './types';
import { getCase } from './registry';
import type { ManifoldToplevel } from 'manifold-3d';

/**
 * 案例生命周期管理器。
 * 核心职责：切换案例时先卸载旧案例、清空 stage，再挂载新案例。
 */
export class CaseManager {
  private currentKey: string | null = null;
  private currentCase: Case | null = null;
  private inflightKey: string | null = null;
  private stageEl: HTMLElement;

  constructor(stageEl: HTMLElement, private wasm: ManifoldToplevel) {
    this.stageEl = stageEl;
  }

  /**
   * 切换到指定 key 的案例。串行执行：unmount(old) → clear stage → load(new) → mount(new)
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

    // 2. 清空 stage DOM（包括旧 canvas 和旧 GUI）
    while (this.stageEl.firstChild) {
      this.stageEl.removeChild(this.stageEl.firstChild);
    }

    // 3. 加载并挂载新案例
    try {
      const nextCase = await meta.load();
      if (this.inflightKey !== key) return; // 期间用户切换到别的 case，丢弃本次结果
      nextCase.mount(this.stageEl, this.wasm);
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
