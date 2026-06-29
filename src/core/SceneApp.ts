/*
 * @Author: wuyifan wuyifan@udschina.com
 * @Date: 2026-06-10 10:25:31
 * @LastEditors: wuyifan wuyifan@udschina.com
 * @LastEditTime: 2026-06-10 11:24:24
 * @FilePath: \manifold\src\core\SceneApp.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AEw
 */
import { Sidebar } from './Sidebar';
import { Stage } from './Stage';
import { CaseManager } from './CaseManager';
import { getAllCases } from './registry';
import { parseRoute, buildRoute } from './router';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/**
 * 应用主类。负责装配 Sidebar / Stage / CaseManager，并处理 #/case/<key> 路由。
 *
 * 路由行为：
 * - #/case/<key>   → 加载对应案例
 * - 空 / 非法 hash → fallback 到第一个案例，不改写 URL
 */
export class SceneApp {
  private root: HTMLElement;
  private sidebar: Sidebar;
  private stage: Stage;
  private caseManager: CaseManager;
  private firstKey: string | null = null;

  private constructor(root: HTMLElement, private wasm: ManifoldToplevel) {
    this.root = root;
    this.sidebar = new Sidebar((key) => this.handleSelect(key));
    this.stage = new Stage();
    this.caseManager = new CaseManager(
      this.stage.getElement(),
      this.stage.getRenderer(),
      this.wasm
    );

    window.addEventListener('hashchange', () => this.onHashChange());
  }

  static async create(root: HTMLElement): Promise<SceneApp> {
    const wasm = await Module();
    wasm.setup();
    window.wasm = wasm;
    return new SceneApp(root, wasm);
  }

  async start(): Promise<void> {
    this.root.appendChild(this.sidebar.getElement());
    this.root.appendChild(this.stage.getElement());

    const cases = getAllCases();
    if (cases.length === 0) return;
    this.firstKey = cases[0].key;

    // 渲染侧边栏（依赖 getAllCases 已被 cases/index.ts 触发注册）
    this.sidebar.setActive(this.firstKey);

    const route = parseRoute(window.location.hash);
    if (route && cases.some((c) => c.key === route.caseKey)) {
      await this.mountCase(route.caseKey);
    } else {
      if (window.location.hash) {
        console.warn(
          `[SceneApp] 无效路由 "${window.location.hash}"，fallback 到 "${this.firstKey}"`
        );
      }
      await this.mountCase(this.firstKey);
    }
  }

  private onHashChange(): void {
    const route = parseRoute(window.location.hash);
    if (route) {
      if (this.caseManager.getCurrentKey() === route.caseKey) return;
      if (getAllCases().some((c) => c.key === route.caseKey)) {
        void this.mountCase(route.caseKey);
      } else {
        console.warn(
          `[SceneApp] 无效 caseKey "${route.caseKey}"，fallback 到 "${this.firstKey}"`
        );
        void this.mountCase(this.firstKey!);
      }
    }
    // 空 hash 不处理（保留当前案例，避免误卸载）
  }

  private handleSelect(key: string): void {
    void this.mountCase(key);
    if (window.location.hash !== buildRoute(key)) {
      window.location.hash = buildRoute(key);
    }
  }

  private async mountCase(key: string): Promise<void> {
    await this.caseManager.switchCase(key);
    this.sidebar.setActive(key);
  }
}
