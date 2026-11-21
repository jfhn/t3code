import * as Schema from "effect/Schema";
import { FolderTreeIcon, InboxIcon } from "lucide-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// Kept apart from PersonalSidebar.tsx: the shared sidebar header imports this file, and
// PersonalSidebar imports that header.
const ENABLED_STORAGE_KEY = "personal_sidebar_enabled";

export function usePersonalSidebarEnabled() {
  return useLocalStorage(ENABLED_STORAGE_KEY, false, Schema.Boolean);
}

export function PersonalSidebarToggle() {
  const [enabled, setEnabled] = usePersonalSidebarEnabled();
  const label = enabled ? "Switch to the inbox sidebar" : "Switch to the grouped sidebar";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={label}
            onClick={() => setEnabled(!enabled)}
          />
        }
      >
        {enabled ? <InboxIcon aria-hidden /> : <FolderTreeIcon aria-hidden />}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
