/*
 * @Author: wuyifan wuyifan@udschina.com
 * @Date: 2026-06-10 10:25:23
 * @LastEditors: wuyifan wuyifan@udschina.com
 * @LastEditTime: 2026-06-11 11:03:34
 * @FilePath: \manifold\src\core\Sidebar.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { getAllCases } from './registry';
import type { CaseMeta } from './types';

type SelectHandler = (key: string) => void;

/**
 * 左侧案例导航栏。从注册表读取案例列表，渲染条目并响应点击。
 */
export class Sidebar {
  private el: HTMLElement;
  private listEl: HTMLElement;
  private onSelect: SelectHandler;

  constructor(onSelect: SelectHandler) {
    this.onSelect = onSelect;
    this.el = document.createElement('aside');
    this.el.className = 'sidebar';

    this.el.innerHTML = `
      <div class="sidebar-header">
        <h1>Manifold-3d</h1>
        <p>power by Three.js</p>
      </div>
      <ul class="case-list"></ul>
    `;

    this.listEl = this.el.querySelector('.case-list') as HTMLElement;
    this.render();
  }

  private render(): void {
    const cases = getAllCases();
    this.listEl.innerHTML = '';
    cases.forEach((meta) => {
      const li = this.createItem(meta);
      this.listEl.appendChild(li);
    });
  }

  private createItem(meta: CaseMeta): HTMLElement {
    const li = document.createElement('li');
    li.className = 'case-item';
    li.dataset.key = meta.key;
    li.innerHTML = `
      <span class="case-name">${escapeHtml(meta.name)}</span>
      ${meta.description ? `<span class="case-desc">${escapeHtml(meta.description)}</span>` : ''}
    `;
    li.addEventListener('click', () => this.onSelect(meta.key));
    return li;
  }

  /** 高亮当前激活的案例条目 */
  setActive(key: string): void {
    const items = this.listEl.querySelectorAll<HTMLElement>('.case-item');
    items.forEach((item) => {
      item.classList.toggle('active', item.dataset.key === key);
    });
  }

  getElement(): HTMLElement {
    return this.el;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
