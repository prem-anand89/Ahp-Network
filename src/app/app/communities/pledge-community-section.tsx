"use client";

// Round 2 step 6 (plan decision 2) — "users propose a community; others
// pledge." Client component: pledging updates the count live without a
// full page reload, and the propose form needs its own submit state.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PLEDGE_COMMUNITY_DESCRIPTION_PLACEHOLDER,
  PLEDGE_COMMUNITY_NAME_PLACEHOLDER,
  PLEDGE_COMMUNITY_SECTION_BODY,
  PLEDGE_COMMUNITY_SECTION_TITLE,
  pledgeCommunityCountLabel,
} from "@/lib/copy";
import { getCommunityProposals, pledgeForCommunity, proposeCommunity } from "@/app/app/pledges/actions";

interface ProposalRow {
  id: string;
  name: string;
  description: string | null;
  pledgeCount: number;
}

export function PledgeCommunitySection() {
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pledgingId, setPledgingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCommunityProposals()
      .then((rows) => {
        setProposals(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function handlePropose() {
    setError(null);
    if (!name.trim()) {
      setError("Name the community you're proposing.");
      return;
    }
    setSubmitting(true);
    try {
      const proposal = await proposeCommunity(name.trim(), description.trim() || undefined);
      setProposals((prev) => [...prev, proposal]);
      setName("");
      setDescription("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePledge(proposalId: string) {
    setError(null);
    setPledgingId(proposalId);
    try {
      const { pledgeCount } = await pledgeForCommunity(proposalId);
      setProposals((prev) => prev.map((p) => (p.id === proposalId ? { ...p, pledgeCount } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPledgingId(null);
    }
  }

  return (
    <div className="rounded-md border p-4">
      <h2 className="font-medium">{PLEDGE_COMMUNITY_SECTION_TITLE}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{PLEDGE_COMMUNITY_SECTION_BODY}</p>

      {loaded && proposals.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {proposals.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                <p className="text-xs text-muted-foreground">{pledgeCommunityCountLabel(p.pledgeCount)}</p>
              </div>
              <Button size="sm" variant="outline" disabled={pledgingId === p.id} onClick={() => handlePledge(p.id)}>
                Pledge
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Label htmlFor="proposal-name">Propose a new one</Label>
        <Input id="proposal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={PLEDGE_COMMUNITY_NAME_PLACEHOLDER} />
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={PLEDGE_COMMUNITY_DESCRIPTION_PLACEHOLDER}
          rows={2}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button size="sm" disabled={submitting} onClick={handlePropose} className="self-start">
          {submitting ? "Proposing…" : "Propose"}
        </Button>
      </div>
    </div>
  );
}
