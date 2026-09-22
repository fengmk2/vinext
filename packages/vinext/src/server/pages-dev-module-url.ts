import fs from "node:fs";
import path, { toSlash } from "pathslash";

function normalizeBase(base: string): string {
  if (!base || base === "/") return "/";
  return `/${base.replace(/^\/+|\/+$/g, "")}/`;
}

function encodePagesDevModulePath(modulePath: string): string {
  return encodeURI(modulePath)
    .replace(/%5B/gi, "[")
    .replace(/%5D/gi, "]")
    .replace(/\?/g, "%3F")
    .replace(/#/g, "%23");
}

export function createPagesDevAssetUrl(assetPath: string): string {
  const normalizedAssetPath = assetPath.replace(/^\/+/, "");
  return "/" + encodePagesDevModulePath(normalizedAssetPath);
}

export function createPagesDevModuleUrl(
  viteRoot: string,
  moduleFilePath: string,
  viteBase: string,
): string {
  // Drive-letter roots need win32 semantics even on POSIX hosts (tests feed
  // Windows shapes there); pathslash's win32 already emits "/" on any host.
  const pathImpl = /^[A-Za-z]:[\\/]/.test(viteRoot) ? path.win32 : path;
  let relativePath = pathImpl.relative(viteRoot, moduleFilePath);
  // Vite can resolve its root through a symlink (for example /var to
  // /private/var on macOS) while the route scanner keeps the original path.
  if (relativePath.startsWith("../")) {
    try {
      relativePath = pathImpl.relative(viteRoot, toSlash(fs.realpathSync.native(moduleFilePath)));
    } catch {
      // Keep Vite's existing outside-root URL if the file disappeared.
    }
  }
  return normalizeBase(viteBase) + encodePagesDevModulePath(relativePath);
}
