'use client';

import { Component, type ReactNode } from 'react';

/**
 * Contains a render crash to one block. Without this, one malformed card, tool
 * record or diagram in one message threw past every component and the route
 * error page replaced the whole app (sidebar, thread, composer draft).
 *
 * `resetKey` clears the error when the input changes, so a block that failed on
 * a half-streamed value renders normally once the full value arrives.
 */
export default class PartBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; resetKey?: unknown; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[modus:part-boundary]${this.props.label ? ` ${this.props.label}` : ''}`, error);
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[part-boundary${this.props.label ? `:${this.props.label}` : ''}] ${error?.message}`,
          stack: error?.stack,
          url: typeof window !== 'undefined' ? window.location.href : '',
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* reporting must never crash the boundary */
    }
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? (
      <div className="px-3 py-2 border border-border bg-panel rounded-lg text-xs text-muted">
        This block could not be shown.
      </div>
    );
  }
}
