import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  sortActiveThreadsByOrderKey,
  sortPinnedThreadsByOrderKey,
  sortSettledThreads,
} from "@t3tools/client-runtime/state/thread-sort";

// A custom group is a thread tag with this prefix. Upstream stores tags on the server and the
// official app ignores them, so grouping stays compatible with it.
export const GROUP_TAG_PREFIX = "group:";

export type PersonalSection = "pinned" | "active" | "snoozed" | "settled";

export type PersonalLayoutThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "createdAt"
  | "updatedAt"
  | "pinOrderKey"
  | "activeOrderKey"
  | "unsettledAt"
  | "settledAt"
  | "snoozedUntil"
  | "latestUserMessageAt"
  | "latestRun"
> & { readonly source: { readonly tags?: ReadonlyArray<string> | undefined } };

export interface PersonalGroup<T> {
  readonly label: string;
  readonly threads: readonly T[];
}

export interface PersonalSidebarLayout<T> {
  readonly groups: readonly PersonalGroup<T>[];
  readonly snoozed: readonly T[];
  readonly settled: readonly T[];
}

export function groupTagLabel(tag: string): string | null {
  if (!tag.startsWith(GROUP_TAG_PREFIX)) return null;
  const label = tag.slice(GROUP_TAG_PREFIX.length).trim();
  return label === "" ? null : label;
}

export function threadGroupTags(thread: PersonalLayoutThread): string[] {
  return (thread.source.tags ?? []).filter((tag) => groupTagLabel(tag) !== null);
}

// The first group tag wins, so a thread tagged twice by hand still sits in exactly one group.
export function threadGroupLabel(thread: PersonalLayoutThread, projectLabel: string): string {
  for (const tag of thread.source.tags ?? []) {
    const label = groupTagLabel(tag);
    if (label !== null) return label;
  }
  return projectLabel;
}

// Groups sort by label so they never jump around while threads update.
// Inside a group, pinned threads come first, each run in upstream's sidebar order.
export function layoutPersonalSidebar<T extends PersonalLayoutThread>(input: {
  readonly threads: readonly T[];
  readonly sectionOf: (thread: T) => PersonalSection;
  readonly projectLabelOf: (thread: T) => string;
}): PersonalSidebarLayout<T> {
  const byLabel = new Map<string, { pinned: T[]; active: T[] }>();
  const snoozed: T[] = [];
  const settled: T[] = [];
  for (const thread of input.threads) {
    const section = input.sectionOf(thread);
    switch (section) {
      case "snoozed":
        snoozed.push(thread);
        break;
      case "settled":
        settled.push(thread);
        break;
      case "pinned":
      case "active": {
        const label = threadGroupLabel(thread, input.projectLabelOf(thread));
        let bucket = byLabel.get(label);
        if (bucket === undefined) {
          bucket = { pinned: [], active: [] };
          byLabel.set(label, bucket);
        }
        bucket[section].push(thread);
        break;
      }
      default:
        throw new Error(`Unknown personal sidebar section: ${section satisfies never}`);
    }
  }
  const groups = [...byLabel]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map(([label, bucket]) => ({
      label,
      threads: [
        ...sortPinnedThreadsByOrderKey(bucket.pinned),
        ...sortActiveThreadsByOrderKey(bucket.active),
      ],
    }));
  return {
    groups,
    snoozed: snoozed.toSorted(
      (left, right) => Date.parse(left.snoozedUntil ?? "") - Date.parse(right.snoozedUntil ?? ""),
    ),
    settled: sortSettledThreads(settled),
  };
}
