/*
 * @Author: wuyifan wuyifan@udschina.com
 * @Date: 2026-06-10 10:25:32
 * @LastEditors: wuyifan wuyifan@udschina.com
 * @LastEditTime: 2026-06-10 16:20:36
 * @FilePath: \manifold\src\main.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import './style.css';
import './cases';
import { SceneApp } from './core/SceneApp';

window.onload = async () => {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('根节点 #app 未找到');
  }

  const app = await SceneApp.create(root);
  app.start();

  window.__app = app;
}

