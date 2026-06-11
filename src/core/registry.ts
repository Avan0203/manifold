import type { CaseMeta } from './types';

/**
 * 案例注册表：全局唯一的 key → CaseMeta 映射。
 * 案例文件通过 registerCase 注册，Sidebar/CaseManager 通过 getCase/getAllCases 读取。
 */
const registry = new Map<string, CaseMeta>();

export function registerCase(meta: CaseMeta): void {
  if (registry.has(meta.key)) {
    console.warn(`[registry] Case "${meta.key}" 已注册，将被覆盖`);
  }
  registry.set(meta.key, meta);
}

export function getCase(key: string): CaseMeta | undefined {
  return registry.get(key);
}

export function getAllCases(): CaseMeta[] {
  return Array.from(registry.values());
}
