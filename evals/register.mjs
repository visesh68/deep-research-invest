/**
 * Lets the eval harness import the app's own `lib/*.ts` modules under plain
 * `node`, so the scorers test the real code rather than a copy of it.
 *
 * Node runs TypeScript natively but resolves relative specifiers literally, and
 * the app is written for a bundler that fills in extensions (`./cache`, not
 * `./cache.ts`). A resolve hook adds the extension back. This lives in evals/
 * on purpose: the alternative — rewriting every import in lib/ — would change
 * shipping code to suit the test harness.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[a-z0-9]+$/i.test(specifier)) {
      for (const ext of EXTENSIONS) {
        try {
          const resolved = nextResolve(specifier + ext, context);
          if (existsSync(fileURLToPath(resolved.url))) return resolved;
        } catch {
          // Try the next extension; fall through to the unmodified specifier.
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
