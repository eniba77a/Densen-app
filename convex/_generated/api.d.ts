/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as achievements from "../achievements.js";
import type * as achievementsInternals from "../achievementsInternals.js";
import type * as admin from "../admin.js";
import type * as arcade from "../arcade.js";
import type * as arcadeInternals from "../arcadeInternals.js";
import type * as arcadeWire from "../arcadeWire.js";
import type * as auditInternals from "../auditInternals.js";
import type * as auth from "../auth.js";
import type * as authInternals from "../authInternals.js";
import type * as catalog from "../catalog.js";
import type * as challenges from "../challenges.js";
import type * as challengesWire from "../challengesWire.js";
import type * as content from "../content.js";
import type * as credits from "../credits.js";
import type * as creditsInternals from "../creditsInternals.js";
import type * as creditsWire from "../creditsWire.js";
import type * as interactions from "../interactions.js";
import type * as interactionsWire from "../interactionsWire.js";
import type * as learning from "../learning.js";
import type * as learningWire from "../learningWire.js";
import type * as media from "../media.js";
import type * as practice from "../practice.js";
import type * as practiceWire from "../practiceWire.js";
import type * as privacy from "../privacy.js";
import type * as privacyInternals from "../privacyInternals.js";
import type * as profiles from "../profiles.js";
import type * as safetyCore from "../safetyCore.js";
import type * as security from "../security.js";
import type * as sessionsInternals from "../sessionsInternals.js";
import type * as social from "../social.js";
import type * as studio from "../studio.js";
import type * as studioWire from "../studioWire.js";
import type * as validators from "../validators.js";
import type * as videoInternals from "../videoInternals.js";
import type * as videos from "../videos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  achievements: typeof achievements;
  achievementsInternals: typeof achievementsInternals;
  admin: typeof admin;
  arcade: typeof arcade;
  arcadeInternals: typeof arcadeInternals;
  arcadeWire: typeof arcadeWire;
  auditInternals: typeof auditInternals;
  auth: typeof auth;
  authInternals: typeof authInternals;
  catalog: typeof catalog;
  challenges: typeof challenges;
  challengesWire: typeof challengesWire;
  content: typeof content;
  credits: typeof credits;
  creditsInternals: typeof creditsInternals;
  creditsWire: typeof creditsWire;
  interactions: typeof interactions;
  interactionsWire: typeof interactionsWire;
  learning: typeof learning;
  learningWire: typeof learningWire;
  media: typeof media;
  practice: typeof practice;
  practiceWire: typeof practiceWire;
  privacy: typeof privacy;
  privacyInternals: typeof privacyInternals;
  profiles: typeof profiles;
  safetyCore: typeof safetyCore;
  security: typeof security;
  sessionsInternals: typeof sessionsInternals;
  social: typeof social;
  studio: typeof studio;
  studioWire: typeof studioWire;
  validators: typeof validators;
  videoInternals: typeof videoInternals;
  videos: typeof videos;
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
