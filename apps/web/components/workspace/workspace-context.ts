'use client';

import { createContext, useContext, useMemo } from 'react';
import type { WidgetTarget } from './WidgetPanel';

/**
 * The workspace panel's context, in its own module so MarkdownMessage (which
 * the panel itself renders) can open files without an import cycle.
 */
export type Tab = 'files' | 'preview' | 'widget' | 'mac';

export interface WorkspaceCtx {
  workspaceId?: string;
  /** Whether the panel is showing; the composer drops its key hint for room. */
  isOpen: boolean;
  openWidget: (t: WidgetTarget) => void;
  openFile: (path: string) => void;
  showFiles: () => void;
  toggleFiles: () => void;
  refresh: () => void;
}

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);
export function useWorkspacePanel(): WorkspaceCtx | null { return useContext(WorkspaceContext); }
/** Back-compat for the widget row in ToolActivity. */
export function useWidgetPanel(): { open: (t: WidgetTarget) => void } | null {
  const c = useContext(WorkspaceContext);
  return useMemo(() => (c ? { open: c.openWidget } : null), [c]);
}
