// 开发占位的客户身份（X-Customer-Id）：localStorage 可编辑，默认 demo-customer。
// 鉴权上线后由登录态（企业账户 owner/member）提供，届时本模块整体退场；
// UI 面上凡展示该值处均须注明「仅开发用」。
export const CUSTOMER_ID_STORAGE_KEY = "wire-web-customer-id";
export const DEFAULT_CUSTOMER_ID = "demo-customer";

/** 读取客户标识（缺省/空值回落 demo-customer）。 */
export function loadCustomerId(): string {
  try {
    const raw = localStorage.getItem(CUSTOMER_ID_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : DEFAULT_CUSTOMER_ID;
  } catch {
    return DEFAULT_CUSTOMER_ID;
  }
}

/** 保存客户标识（空值回落默认），返回归一化后的值。 */
export function saveCustomerId(raw: string): string {
  const normalized = raw.trim() || DEFAULT_CUSTOMER_ID;
  try {
    localStorage.setItem(CUSTOMER_ID_STORAGE_KEY, normalized);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
  return normalized;
}
