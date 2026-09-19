/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auditInternals from "../auditInternals.js";
import type * as auth from "../auth.js";
import type * as authInternals from "../authInternals.js";
import type * as content from "../content.js";
import type * as media from "../media.js";
import type * as profiles from "../profiles.js";
import type * as safetyCore from "../safetyCore.js";
import type * as security from "../security.js";
import type * as sessionsInternals from "../sessionsInternals.js";
import type * as social from "../social.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auditInternals: typeof auditInternals;
  auth: typeof auth;
  authInternals: typeof authInternals;
  content: typeof content;
  media: typeof media;
  profiles: typeof profiles;
  safetyCore: typeof safetyCore;
  security: typeof security;
  sessionsInternals: typeof sessionsInternals;
  social: typeof social;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
