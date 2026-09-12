"use client";

import { timeAgoLabel } from "@/lib/referral-labels";

export function TimeAgoDisplay({ date }: { date: Date }) {
  return <>{timeAgoLabel(date)}</>;
}
