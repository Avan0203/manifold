/*
 * @Author: wuyifan wuyifan@udschina.com
 * @Date: 2026-06-10 10:24:01
 * @LastEditors: wuyifan wuyifan@udschina.com
 * @LastEditTime: 2026-06-11 10:13:58
 * @FilePath: \manifold\vite.config.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/manifold/',
  server: {
    port: 5100,
    open: false
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'vendor-gui', test: /[\\/]node_modules[\\/]lil-gui[\\/]/ }
          ]
        }
      }
    }
  }
});
