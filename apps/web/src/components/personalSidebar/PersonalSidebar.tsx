import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { ContextMenuItem } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, SquarePenIcon } from "lucide-react";
import { useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import {
  useDelegatedUnderParent,
  useQuietThreadShells,
  useServerConfigs,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../../threadRoutes";
import { formatRelativeTime } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import {
  filterSidebarV2VisibleThreads,
  resolveSidebarFolderDot,
  resolveSidebarThreadSection,
  resolveThreadLastVisitedAt,
  useSnoozeWakeClock,
} from "../Sidebar.logic";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SidebarContent, SidebarGroup, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  GROUP_TAG_PREFIX,
  layoutPersonalSidebar,
  threadGroupLabel,
  threadGroupTags,
  type PersonalSection,
} from "./personalSidebarLayout";

// Server-side thread tags are at most 64 characters and a single line.
const MAX_GROUP_LABEL_LENGTH = 64 - GROUP_TAG_PREFIX.length;
const NO_PROJECT_LABEL = "Unknown project";

// Open state per section key. Missing keys fall back to SECTION_OPEN_BY_DEFAULT.
const OPEN_STORAGE_KEY = "personal_sidebar_open_sections";
const OpenSections = Schema.Record(Schema.String, Schema.Boolean);
const SNOOZED_KEY = "shelf:snoozed";
const SETTLED_KEY = "shelf:settled";
const groupKey = (label: string) => `group:${label}`;
const SECTION_OPEN_BY_DEFAULT = (key: string) => key !== SNOOZED_KEY && key !== SETTLED_KEY;

const DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
} as const;

type MenuAction =
  | "move-menu"
  | "remove-group"
  | "new-group"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "unsnooze"
  | "mark-unread"
  | `move:${string}`;

export default function PersonalSidebar() {
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const serverConfigs = useServerConfigs();
  const projectGroups = useSidebarProjectGroups();
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const nowMinute = useNowMinute();
  const snoozeWakeClockMs = useSnoozeWakeClock(threads);
  const [openSections, setOpenSections] = useLocalStorage(OPEN_STORAGE_KEY, {}, OpenSections);
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const routeThreadRef = resolveThreadRouteRef(useParams({ strict: false }));
  const routeThreadKey = routeThreadRef === null ? null : scopedThreadKey(routeThreadRef);
  const {
    settleThread,
    unsettleThread,
    unsnoozeThread,
    pinThread,
    confirmAndUnpinThread,
    markThreadUnread,
  } = useThreadActions();
  const setThreadTag = useOrchestrationCommand(threadEnvironment.setTag, { reportFailure: false });
  const [namingThread, setNamingThread] = useState<EnvironmentThreadShell | null>(null);

  const projectLabelByKey = new Map(
    projectGroups.flatMap((group) =>
      group.memberProjectRefs.map(
        (ref) => [`${ref.environmentId}:${ref.projectId}`, group.displayName] as const,
      ),
    ),
  );
  const projectLabelOf = (thread: EnvironmentThreadShell) =>
    projectLabelByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? NO_PROJECT_LABEL;
  // The wake clock advances exactly when a snooze ends; the minute clock covers the rest.
  const now = new Date(
    Math.max(snoozeWakeClockMs, Date.parse(`${nowMinute}:00.000Z`)),
  ).toISOString();
  // Without a loaded server config a thread's snooze and settle state is unknown, so it
  // stays in its group, as in upstream's sidebar.
  const sectionOf = (thread: EnvironmentThreadShell): PersonalSection => {
    const configLoaded = serverConfigs.has(thread.environmentId);
    const section = resolveSidebarThreadSection({
      snoozed: configLoaded && effectiveSnoozed(thread, { now }),
      settled: configLoaded && thread.settledOverride === "settled",
      pinned: thread.pinnedAt != null,
    });
    if (section === "working") {
      throw new Error("resolveSidebarThreadSection never returns the working shelf.");
    }
    return section;
  };
  const visibleThreads = filterSidebarV2VisibleThreads(threads, null, delegatedUnderParent);
  const layout = layoutPersonalSidebar({ threads: visibleThreads, sectionOf, projectLabelOf });
  // Includes groups whose threads are all snoozed or settled, so they stay reachable.
  const groupLabels = [
    ...new Set(visibleThreads.map((thread) => threadGroupLabel(thread, projectLabelOf(thread)))),
  ].toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  const isOpen = (key: string) => openSections[key] ?? SECTION_OPEN_BY_DEFAULT(key);
  const toggle = (key: string) => setOpenSections((open) => ({ ...open, [key]: !isOpen(key) }));
  const dotOf = (threadsToSummarize: readonly EnvironmentThreadShell[]) =>
    resolveSidebarFolderDot(
      threadsToSummarize.map((thread) => ({
        ...thread,
        lastVisitedAt: resolveThreadLastVisitedAt(
          thread.lastVisitedAt,
          localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
        ),
      })),
    );

  // Returns whether the action succeeded, so a multi-step move can stop early.
  const reported = (result: AtomCommandResult<unknown, unknown>, title: string) => {
    if (result._tag !== "Failure") return true;
    if (!isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: errorMessage(squashAtomCommandFailure(result)),
        }),
      );
    }
    return false;
  };
  const openThread = (thread: EnvironmentThreadShell) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  // A thread keeps at most one group tag. Moving to its own project's group needs no tag.
  // The new tag goes on before the old ones come off: a move that fails halfway leaves the
  // thread in its old group (the first group tag wins) instead of in no group.
  const moveToGroup = async (thread: EnvironmentThreadShell, label: string | null) => {
    const wantedTag =
      label === null || label === projectLabelOf(thread) ? null : `${GROUP_TAG_PREFIX}${label}`;
    const send = (tag: string, tagged: boolean) =>
      setThreadTag({
        environmentId: thread.environmentId,
        input: { threadId: thread.id, tag, tagged },
      });
    if (wantedTag !== null && !(thread.source.tags ?? []).includes(wantedTag)) {
      if (!reported(await send(wantedTag, true), "Failed to move thread")) return;
    }
    for (const tag of threadGroupTags(thread)) {
      if (tag === wantedTag) continue;
      if (!reported(await send(tag, false), "Failed to move thread")) return;
    }
  };

  const openThreadMenu = async (
    thread: EnvironmentThreadShell,
    section: PersonalSection,
    position: { x: number; y: number },
  ) => {
    const api = readLocalApi();
    if (api === undefined) return;
    const ref = scopeThreadRef(thread.environmentId, thread.id);
    const currentLabel = threadGroupLabel(thread, projectLabelOf(thread));
    const targets = groupLabels.filter((label) => label !== currentLabel);
    const items: ContextMenuItem<MenuAction>[] = [
      {
        id: "move-menu",
        label: "Move to group",
        children: [
          ...targets.map((label) => ({ id: `move:${label}` as const, label })),
          { id: "new-group", label: "New group…", separatorBefore: targets.length > 0 },
        ],
      },
      ...(threadGroupTags(thread).length > 0
        ? [{ id: "remove-group" as const, label: "Back to project group" }]
        : []),
      section === "snoozed"
        ? { id: "unsnooze" as const, label: "Unsnooze", separatorBefore: true }
        : section === "settled"
          ? { id: "unsettle" as const, label: "Unsettle", separatorBefore: true }
          : { id: "settle" as const, label: "Settle", separatorBefore: true },
      ...(section === "pinned"
        ? [{ id: "unpin" as const, label: "Unpin" }]
        : section === "active"
          ? [{ id: "pin" as const, label: "Pin" }]
          : []),
      { id: "mark-unread", label: "Mark unread" },
    ];
    const clicked = await api.contextMenu.show(items, position);
    if (clicked === null) return;
    if (clicked.startsWith("move:")) {
      await moveToGroup(thread, clicked.slice("move:".length));
      return;
    }
    switch (clicked) {
      case "new-group":
        setNamingThread(thread);
        return;
      case "remove-group":
        await moveToGroup(thread, null);
        return;
      case "pin":
        reported(await pinThread(ref), "Failed to pin thread");
        return;
      case "unpin":
        reported(await confirmAndUnpinThread(ref), "Failed to unpin thread");
        return;
      case "settle":
        reported(await settleThread(ref), "Failed to settle thread");
        return;
      case "unsettle":
        reported(await unsettleThread(ref), "Failed to unsettle thread");
        return;
      case "unsnooze":
        reported(await unsnoozeThread(ref), "Failed to unsnooze thread");
        return;
      case "mark-unread":
        markThreadUnread(ref);
        return;
      default:
        throw new Error(`Unhandled personal sidebar menu action: ${clicked}`);
    }
  };

  const renderSection = (
    key: string,
    label: string,
    section: PersonalSection | null,
    sectionThreads: readonly EnvironmentThreadShell[],
  ) => {
    const open = isOpen(key);
    return (
      <li key={key} className="mt-2 list-none first:mt-0">
        <SectionHeader
          label={label}
          open={open}
          count={sectionThreads.length}
          dot={open ? null : dotOf(sectionThreads)}
          onToggle={() => toggle(key)}
        />
        {open ? (
          <ul className="flex flex-col">
            {sectionThreads.map((thread) => {
              const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
              return (
                <ThreadRow
                  key={threadKey}
                  thread={thread}
                  active={threadKey === routeThreadKey}
                  pinned={thread.pinnedAt != null}
                  dot={dotOf([thread])}
                  nowMinute={nowMinute}
                  onOpen={() => openThread(thread)}
                  onContextMenu={(position) =>
                    void openThreadMenu(thread, section ?? sectionOf(thread), position)
                  }
                />
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="min-h-full"
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="flex h-8 items-center justify-between px-(--sidebar-row-content-inset)">
              <span className="text-xs font-medium text-sidebar-muted-foreground">Threads</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="New thread"
                      onClick={() => openCommandPalette({ open: "new-thread-in" })}
                    />
                  }
                >
                  <SquarePenIcon aria-hidden />
                </TooltipTrigger>
                <TooltipPopup>New thread</TooltipPopup>
              </Tooltip>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          <ul className="flex flex-col">
            {layout.groups.map((group) =>
              renderSection(groupKey(group.label), group.label, null, group.threads),
            )}
            {layout.snoozed.length > 0
              ? renderSection(SNOOZED_KEY, "Snoozed", "snoozed", layout.snoozed)
              : null}
            {layout.settled.length > 0
              ? renderSection(SETTLED_KEY, "Settled", "settled", layout.settled)
              : null}
          </ul>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
      {namingThread === null ? null : (
        <NewGroupDialog
          onCancel={() => setNamingThread(null)}
          onSubmit={(label) => {
            const thread = namingThread;
            setNamingThread(null);
            void moveToGroup(thread, label);
          }}
        />
      )}
    </>
  );
}

function SectionHeader(props: {
  label: string;
  open: boolean;
  count: number;
  dot: keyof typeof DOT_CLASS_NAME | null;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-(--control-radius) px-(--sidebar-row-content-inset) text-left outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
          !props.open && "-rotate-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-foreground/90">
        {props.label}
      </span>
      {props.dot ? (
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS_NAME[props.dot])} />
      ) : null}
      {props.open ? null : (
        <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
          {props.count}
        </span>
      )}
    </button>
  );
}

function ThreadRow(props: {
  thread: EnvironmentThreadShell;
  active: boolean;
  pinned: boolean;
  dot: keyof typeof DOT_CLASS_NAME | null;
  nowMinute: string;
  onOpen: () => void;
  onContextMenu: (position: { x: number; y: number }) => void;
}) {
  return (
    <li className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_--spacing(8)]">
      <button
        type="button"
        data-active={props.active}
        onClick={props.onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContextMenu({ x: event.clientX, y: event.clientY });
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-(--control-radius) ps-7 pe-(--sidebar-row-content-inset) text-left text-sm outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[active=true]:bg-sidebar-row-active"
      >
        <span className={cn("min-w-0 flex-1 truncate", props.pinned && "font-medium")}>
          {props.thread.title}
        </span>
        {props.dot ? (
          <span className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS_NAME[props.dot])} />
        ) : null}
        <RelativeTime
          timestamp={resolveThreadActivityTimestamp(props.thread)}
          nowMinute={props.nowMinute}
        />
      </button>
    </li>
  );
}

function RelativeTime(props: { timestamp: string | null; nowMinute: string }) {
  if (props.timestamp === null) return null;
  const parts = formatRelativeTime(props.timestamp, Date.parse(`${props.nowMinute}:00.000Z`));
  if (parts === null) return null;
  return (
    <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
      {parts.suffix === null ? "now" : parts.value}
    </span>
  );
}

function NewGroupDialog(props: { onCancel: () => void; onSubmit: (label: string) => void }) {
  const [label, setLabel] = useState("");
  const trimmed = label.trim();
  const valid =
    trimmed !== "" && trimmed.length <= MAX_GROUP_LABEL_LENGTH && !/\p{Cc}/u.test(trimmed);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) props.onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>New group</DialogTitle>
            <DialogDescription>Moves this thread into a new sidebar group.</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              nativeInput
              autoFocus
              aria-label="Group name"
              placeholder="news"
              maxLength={MAX_GROUP_LABEL_LENGTH}
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost-muted" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}
