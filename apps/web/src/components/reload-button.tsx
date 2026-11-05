'use client';

/** Reloads the page, so it picks up the server actions of a deploy that happened while it was open. */
export function ReloadButton({ className }: { className?: string | undefined }) {
  return (
    <button type="button" className={className} onClick={() => window.location.reload()}>
      Reload
    </button>
  );
}
