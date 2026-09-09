// Node's built-in test runner (node --test) has no knowledge of the "@/*"
// path alias tsconfig.json defines for TypeScript/Next.js -- this loader
// hook teaches plain Node ESM resolution the same mapping, so test files can
// import production modules exactly as written (with "@/..." specifiers)
// instead of forking a parallel set of relative-only imports. Registered via
// `node --import ./scripts/test-path-alias-loader.mjs --test ...`.
//
// It also extension-probes plain relative specifiers ("./foo", "../foo")
// the same way, since TypeScript/Next.js source is written assuming a
// bundler resolves ".ts"/".tsx" from an extensionless import -- Node's own
// ESM resolver has no such behavior and fails closed on those specifiers
// otherwise.
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs"];

function resolveWithExtensionProbing(absoluteBasePath) {
  for (const extension of CANDIDATE_EXTENSIONS) {
    const candidate = absoluteBasePath + extension;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const absoluteBase = resolvePath(projectRoot, specifier.slice(2));
    const resolved = resolveWithExtensionProbing(absoluteBase);
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
    return nextResolve(specifier, context);
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const parentDirectory = dirname(fileURLToPath(context.parentURL));
    const absoluteBase = resolvePath(parentDirectory, specifier);
    const resolved = resolveWithExtensionProbing(absoluteBase);
    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }

  // Bare unscoped package subpath specifiers without an explicit extension
  // (e.g. "next/headers", "next/navigation") -- next's own package.json has
  // no "exports" map, so unlike a bundler (or Node's CJS resolver via
  // require.resolve), Node's plain ESM resolver will not find "headers.js"
  // from "next/headers" on its own. Retry with an explicit ".js" before
  // falling back to the unmodified specifier/error.
  if (!specifier.startsWith(".") && !specifier.startsWith("@") && !specifier.startsWith("node:") && specifier.includes("/")) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // Fall through -- not every bare subpath needs this, and the
      // unmodified nextResolve call below produces the real error when it
      // genuinely doesn't exist.
    }
  }

  return nextResolve(specifier, context);
}
