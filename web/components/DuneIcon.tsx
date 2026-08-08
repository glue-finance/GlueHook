/** Dune Analytics mark — orange disc with the navy "dune" wave. */
export function DuneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#F4603E" />
      <path
        d="M1.2 24.6c6.6-2.6 12.2-1.4 18.1-5.1 5-3.1 8.2-7.5 11.6-10.4A16 16 0 0 1 1.2 24.6Z"
        fill="#181660"
      />
    </svg>
  );
}

export const DUNE_DASHBOARD_URL = "https://dune.com/lalilulel0x0869/gluehook-live";
