import { defineConfig } from "vite-plus";

const typescriptPackageUrl = import.meta.resolve("typescript/package.json");
const { default: getTscPath } = await import(
  new URL("lib/getExePath.js", typescriptPackageUrl).href
);

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://release-v1-0-0-rc-0-viteplus-dev.voidzero-docs.workers.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  pack: {
    entry: ["src/**/*.ts"],
    clean: true,
    deps: {
      resolveDepSubpath: true,
      neverBundle: true,
    },
    dts: {
      generator: "tsgo",
      tsgo: { path: getTscPath() },
    },
    fixedExtension: false,
    format: "esm",
    inputOptions: {
      external: (id) => id.startsWith("cloudflare:"),
    },
    tsconfig: "./tsconfig.json",
    unbundle: true,
  },
});
