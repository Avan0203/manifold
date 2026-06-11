/**
 * 右侧展示舞台。持有一个 HTMLElement，所有 case 的 mount 会拿到这个容器。
 */
export class Stage {
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement('section');
    this.el.className = 'stage';
  }

  getElement(): HTMLElement {
    return this.el;
  }
}
