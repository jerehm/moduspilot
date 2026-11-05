'use client';

// Inside the dashboard layout, so a crash in one page keeps the sidebar and
// navigation instead of replacing the whole app with the root 500 screen.
export { default } from '../error';
