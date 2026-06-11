/**
 * 案例集中式注册中心。
 *
 * 新增案例只需两步：
 * 1. 在 src/cases/ 下创建文件夹 + index.ts，export default 一个 Case 实例
 * 2. 在下方新增一条 registerCase，name/description 填侧边栏展示文案，load 用 dynamic import
 *
 * 注意：name/description 与 case 文件内部 caseDef 的 name/description 重复 2 行，
 * 这是 lazy 注册表模式的固有代价——壳阶段必须先知道名称才能渲染侧边栏，
 * 此时 case 模块尚未下载。case 文件本身保持自描述、不依赖此处。
 */
import { registerCase } from '../core/registry';

registerCase({
  key: 'base-shape',
  name: '基础几何体',
  description: 'Manifold 内置基本图形',
  load: () => import('./base-shape').then((m) => m.default),
});
registerCase({
  key: 'extrude-shape',
  name: '面拉伸 / Extrude',
  description: 'Manifold 2D 截面沿 Z 轴拉伸为 3D 实体',
  load: () => import('./extrude-shape').then((m) => m.default),
});
registerCase({
  key: 'revolve',
  name: '车削 / Revolve',
  description: '2D 截面绕 Y 轴旋转生成 3D 实体',
  load: () => import('./revolve').then((m) => m.default),
});
registerCase({
  key: '2d-boolean',
  name: '2D 布尔',
  description: 'CrossSection 交并差补（线渲染）',
  load: () => import('./2d-boolean').then((m) => m.default),
});
registerCase({
  key: '3d-boolean',
  name: '3D 布尔',
  description: 'Manifold 交并差补',
  load: () => import('./3d-boolean').then((m) => m.default),
});
registerCase({
  key: 'smooth',
  name: '平滑 / Smooth',
  description: 'Manifold.smooth 构造切线 + refine 插值得到 G1 连续曲面，可选择保留硬边',
  load: () => import('./smooth').then((m) => m.default),
});
