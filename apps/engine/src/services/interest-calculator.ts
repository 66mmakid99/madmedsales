// v1.0 - 2026-02-20
// Lead interest level calculation based on engagement signals

import type { InterestLevel } from '@madmedsales/shared';

interface LeadEngagement {
  replyCount: number;
  clickCount: number;
  openCount: number;
  demoPageVisits: number;
  pricePageVisits: number;
  lastReplySentiment: string | null;
}

export function calculateInterestLevel(lead: LeadEngagement): InterestLevel {
  // hot: positive reply or demo_page_visits >= 2
  if (
    lead.lastReplySentiment === 'positive' ||
    lead.demoPageVisits >= 2
  ) {
    return 'hot';
  }

  // warm: click_count >= 1 or price_page_visits >= 1 or any reply
  if (
    lead.clickCount >= 1 ||
    lead.pricePageVisits >= 1 ||
    lead.replyCount >= 1
  ) {
    return 'warm';
  }

  // warming: open_count >= 1
  if (lead.openCount >= 1) {
    return 'warming';
  }

  // cold: default
  return 'cold';
}
