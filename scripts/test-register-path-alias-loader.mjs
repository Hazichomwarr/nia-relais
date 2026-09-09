// Registers ./test-path-alias-loader.mjs as a module customization hook via
// the current (non-deprecated) API. Load with `node --import
// ./scripts/test-register-path-alias-loader.mjs --test ...`.
//
// Also loads .env here, before any test file or the production modules it
// imports (e.g. src/prisma.ts) ever read process.env -- src/prisma.ts reads
// DATABASE_URL directly with no dotenv import of its own (Next.js loads .env
// for the running app; plain `node --test` does not), so without this an
// undefined DATABASE_URL silently falls through to the pg driver's own
// local-Postgres default instead of the real configured database.
import { register } from "node:module";
import "dotenv/config";

register("./test-path-alias-loader.mjs", import.meta.url);
