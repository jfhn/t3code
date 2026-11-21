import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  groupTagLabel,
  layoutPersonalSidebar,
  type PersonalLayoutThread,
  type PersonalSection,
} from "./personalSidebarLayout.ts";

type TestThread = PersonalLayoutThread & {
  readonly section: PersonalSection;
  readonly project: string;
};

function makeThread(
  id: string,
  input: {
    section?: PersonalSection;
    project?: string;
    tags?: string[];
    createdAt?: string;
    pinOrderKey?: string;
    snoozedUntil?: string;
    settledAt?: string;
  } = {},
): TestThread {
  return {
    environmentId: EnvironmentId.make("environment-local"),
    id: ThreadId.make(id),
    createdAt: input.createdAt ?? "2026-11-01T10:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-11-01T10:00:00.000Z",
    pinOrderKey: input.pinOrderKey ?? null,
    activeOrderKey: null,
    unsettledAt: null,
    settledAt: input.settledAt ?? null,
    snoozedUntil: input.snoozedUntil ?? null,
    latestUserMessageAt: null,
    latestRun: null,
    source: { tags: input.tags ?? [] },
    section: input.section ?? "active",
    project: input.project ?? "No project",
  };
}

const layout = (threads: TestThread[]) => {
  const result = layoutPersonalSidebar({
    threads,
    sectionOf: (thread) => thread.section,
    projectLabelOf: (thread) => thread.project,
  });
  return {
    groups: result.groups.map((group) => [group.label, group.threads.map((thread) => thread.id)]),
    snoozed: result.snoozed.map((thread) => thread.id),
    settled: result.settled.map((thread) => thread.id),
  };
};

describe("groupTagLabel", () => {
  it.each([
    ["group:news", "news"],
    ["group: tools ", "tools"],
    ["group:", null],
    ["private", null],
    ["Group:news", null],
  ])("%s -> %s", (tag, label) => {
    expect(groupTagLabel(tag)).toBe(label);
  });
});

describe("layoutPersonalSidebar", () => {
  it("groups by group tag, else by project, and keeps snoozed and settled apart", () => {
    expect(
      layout([
        makeThread("soundtrack", { project: "cosmic-horror-game" }),
        makeThread("models", { tags: ["group:news"] }),
        makeThread("youtube", { tags: ["private", "group:tools", "group:news"] }),
        makeThread("migration", { tags: ["group:tools"], createdAt: "2026-11-02T10:00:00.000Z" }),
        makeThread("horror-score", { project: "No project", tags: ["group:music-forge"] }),
        makeThread("tower", { project: "music-forge" }),
        makeThread("gameplay", {
          project: "cosmic-horror-game",
          section: "pinned",
          pinOrderKey: "a0",
        }),
        makeThread("later", { section: "snoozed", snoozedUntil: "2026-12-02T10:00:00.000Z" }),
        makeThread("sooner", { section: "snoozed", snoozedUntil: "2026-12-01T10:00:00.000Z" }),
        makeThread("old", { section: "settled", settledAt: "2026-10-01T10:00:00.000Z" }),
        makeThread("recent", { section: "settled", settledAt: "2026-11-01T10:00:00.000Z" }),
      ]),
    ).toEqual({
      groups: [
        ["cosmic-horror-game", ["gameplay", "soundtrack"]],
        ["music-forge", ["horror-score", "tower"]],
        ["news", ["models"]],
        ["tools", ["migration", "youtube"]],
      ],
      snoozed: ["sooner", "later"],
      settled: ["recent", "old"],
    });
  });
});
