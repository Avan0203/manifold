/**
 * 路由工具。统一处理 #/case/<key> 这种 hash 路由的解析与序列化。
 *
 * 设计原则：
 * - 解析失败（包括空 hash）返回 null，由调用方决定 fallback 策略
 * - 序列化只在这里，避免散落的字符串拼接
 */

const ROUTE_PATTERN = /^#\/case\/([\w-]+)$/;

export interface CaseRoute {
  caseKey: string;
}

/** 解析 hash。返回 { caseKey } 或 null（空 hash / 格式不匹配） */
export function parseRoute(hash: string): CaseRoute | null {
  if (!hash) return null;
  const m = ROUTE_PATTERN.exec(hash);
  if (!m) return null;
  return { caseKey: m[1] };
}

/** 序列化路由 → hash 字符串（不含 # 号前面的部分） */
export function buildRoute(key: string): string {
  return `#/case/${key}`;
}
