/** Client-side gate — kept byte-for-byte compatible with the original app. */

export const ADMIN_PASSWORD_HASH =
  "d93e1653433b2a3a23c4ebcdded3a4fb566c6625cacdc4be468988df54b4f35a";
export const VIEWER_PASSWORD_HASH =
  "2738e1f7f179c457402c56414499aa1d8a59037c5f6042241e0188fd1633b412";
export const OPERATOR_PASSWORD_HASH =
  "fe9bbd400bb6cb314531e3462507661401959afc69aae96bc6aec2c213b83bc1";

export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function checkAuth() {
  return Boolean(sessionStorage.getItem("warehouse_role")) || sessionStorage.getItem("warehouse_admin") === "true";
}

export async function loginWithPassword(value: string) {
  const hash = await sha256Hex(value);
  const role =
    hash === ADMIN_PASSWORD_HASH ? "admin" : hash === OPERATOR_PASSWORD_HASH ? "operator" : hash === VIEWER_PASSWORD_HASH ? "viewer" : null;
  if (!role) return null;
  sessionStorage.setItem("warehouse_role", role);
  sessionStorage.setItem("warehouse_admin", role === "admin" ? "true" : "false");
  return role;
}

export function logoutSession() {
  sessionStorage.removeItem("warehouse_admin");
  sessionStorage.removeItem("warehouse_role");
}
