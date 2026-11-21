# Personal fork

This fork adds one thing to T3 Code: a **grouped sidebar view**. A button in the sidebar header switches
between upstream's inbox sidebar and the grouped one.

The fork changes web-client code only. The official T3 Code app keeps running the server and owns all
data in `~/.t3`. Switching back to the official UI at any time loses nothing.

## How groups work

- A thread belongs to its project's group, unless it has a `group:<name>` thread tag. Then it belongs to
  the group `<name>`.
- Group tags are ordinary upstream thread tags. The server stores them, and the official app ignores them.
- Groups with the same name merge, so tagging a no-project thread `group:music-forge` puts it into the
  music-forge project group.
- Right-click a thread to move it. "New group…" creates a group. A group disappears with its last thread.
- Snoozed and Settled are collapsed sections below the groups. Open and closed state is kept per browser.

## Code

- `apps/web/src/components/personalSidebar/` holds everything new:
  - `personalSidebarLayout.ts` is the pure grouping logic, with a table test beside it.
  - `PersonalSidebar.tsx` is the view, its one-line rows, and the context menu.
  - `personalSidebarToggle.tsx` is the header button and the on/off state. It is a separate file
    because the shared header imports it.
- Upstream files touched, a few lines each:
  - `apps/web/src/components/AppSidebarLayout.tsx` picks which sidebar to render.
  - `apps/web/src/components/sidebar/SidebarChrome.tsx` renders the toggle button.
  - `packages/client-runtime/src/{operations/commands.ts,state/threadCommands.ts}` add a `setTag` command.
    It sends upstream's existing `thread.tag.set`.

## Running it

1. Start the official T3 Code app.
2. In WSL, run `scripts/personal.sh web`. It serves the fork's UI on `http://localhost:5733` and forwards
   `/api` and `/ws` to the official server's port.
3. Once per browser: in the official app, create a pairing link (Settings, Sharing & access). Open it with
   its host changed to `http://localhost:5733`.

A browser tab lacks some desktop-only features: the in-app preview browser, native folder pickers, and
file drag-and-drop. Use the official app for those. Both UIs can be open at the same time.

## Staying current

The fork is based on the exact release tag of the installed official app. A newer client could call
server functions the installed server lacks. After the official app updates, run `scripts/personal.sh sync`.
It moves the fork's commits onto the matching tag and reinstalls dependencies. `scripts/personal.sh web`
warns when the two drift apart.
