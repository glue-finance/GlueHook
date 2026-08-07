"use client";

/**
 * Progress for a log scan. The scanners report `scanned / total` in BLOCKS, so
 * `progress` is a whole percent — or null, which is not an error: a scan that
 * resumes from the cached frontier has no range left to walk and never emits a
 * window at all. That case animates instead of sitting at 0%.
 */
export function ScanBar({
  progress,
  label,
  note,
  thin = false,
}: {
  progress: number | null;
  label?: string;
  note?: string;
  thin?: boolean;
}) {
  return (
    <div>
      {label && (
        <div className="mono mb-2 flex items-center justify-between gap-3 text-[11.5px] text-dim2">
          <span className="truncate">{label}</span>
          {progress !== null && <span className="shrink-0 font-bold text-green">{progress}%</span>}
        </div>
      )}
      <div className={`meter ${thin ? "thin" : ""} ${progress === null ? "idle" : ""}`}>
        <i style={progress === null ? undefined : { width: `${progress}%` }} />
      </div>
      {note && <div className="mono mt-2 text-center text-[10px] text-dim2">{note}</div>}
    </div>
  );
}
