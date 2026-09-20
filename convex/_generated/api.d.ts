/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as capabilities from "../capabilities.js";
import type * as decisions from "../decisions.js";
import type * as handoffs from "../handoffs.js";
import type * as investigations from "../investigations.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_handoffs from "../lib/handoffs.js";
import type * as lib_operation from "../lib/operation.js";
import type * as lib_publication from "../lib/publication.js";
import type * as lib_receipts from "../lib/receipts.js";
import type * as lib_source_cursors from "../lib/source_cursors.js";
import type * as lib_source_registration from "../lib/source_registration.js";
import type * as lib_sources from "../lib/sources.js";
import type * as lib_validation from "../lib/validation.js";
import type * as projects from "../projects.js";
import type * as proposals from "../proposals.js";
import type * as receipts from "../receipts.js";
import type * as runs from "../runs.js";
import type * as snapshots from "../snapshots.js";
import type * as sourceCache from "../sourceCache.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  capabilities: typeof capabilities;
  decisions: typeof decisions;
  handoffs: typeof handoffs;
  investigations: typeof investigations;
  "lib/authz": typeof lib_authz;
  "lib/handoffs": typeof lib_handoffs;
  "lib/operation": typeof lib_operation;
  "lib/publication": typeof lib_publication;
  "lib/receipts": typeof lib_receipts;
  "lib/source_cursors": typeof lib_source_cursors;
  "lib/source_registration": typeof lib_source_registration;
  "lib/sources": typeof lib_sources;
  "lib/validation": typeof lib_validation;
  projects: typeof projects;
  proposals: typeof proposals;
  receipts: typeof receipts;
  runs: typeof runs;
  snapshots: typeof snapshots;
  sourceCache: typeof sourceCache;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
