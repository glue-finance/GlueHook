import type { ReactNode } from "react";
import { BuildApps, Integrate, Launch, Liquidity, Manage } from "./content/build";
import {
  BuybackManagement, Compound, CompoundMath, CompoundStrategies, Delivery, Donations, Harvest,
  HarvestMath, HarvestPayouts, Pump, Roles, Shield, ThePot,
} from "./content/machine";
import { FeesBurn, FeesFlow, FeesNeverStops, FeesRecipients } from "./content/lpfees";
import { Api, GlossaryPage, LicensePage, Security } from "./content/reference";
import { Networks, QuickStart, WhatIs, Why } from "./content/start";

/** slug → chapter body. Titles/blurbs/order live in lib/docsNav.ts. */
export const DOC_CONTENT: Record<string, () => ReactNode> = {
  "": WhatIs,
  why: Why,
  "quick-start": QuickStart,
  networks: Networks,
  "the-pot": ThePot,
  donations: Donations,
  pump: Pump,
  shield: Shield,
  delivery: Delivery,
  "buyback-management": BuybackManagement,
  "lp-fees": FeesFlow,
  "lp-recipients": FeesRecipients,
  "lp-burn": FeesBurn,
  "lp-never-stops": FeesNeverStops,
  compound: Compound,
  "compound-math": CompoundMath,
  "compound-strategies": CompoundStrategies,
  harvest: Harvest,
  "harvest-math": HarvestMath,
  "harvest-payouts": HarvestPayouts,
  roles: Roles,
  launch: Launch,
  manage: Manage,
  liquidity: Liquidity,
  integrate: Integrate,
  "build-apps": BuildApps,
  api: Api,
  security: Security,
  glossary: GlossaryPage,
  license: LicensePage,
};
