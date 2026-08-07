import { CANONICAL_HOOK, NETS } from "@/lib/chains";
import { NetIcon } from "@/components/NetIcon";

const SHORT_HOOK = `${CANONICAL_HOOK.slice(0, 6)}…${CANONICAL_HOOK.slice(-4)}`;

export function AddressesTable() {
  return (
    <div className="panel overflow-hidden">
      <div className="chead">
        <span>deployments — {NETS.length} networks</span>
        <span className="pill hi">same address everywhere</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="mono text-[10.5px] uppercase tracking-[0.14em] text-dim2">
              <th className="px-5 py-3">network</th>
              <th className="px-5 py-3">hook</th>
              <th className="px-5 py-3 max-sm:hidden">env</th>
            </tr>
          </thead>
          <tbody className="mono text-[12px]">
            {NETS.map((n) => (
              <tr key={n.chain.id} className="border-t border-[var(--line)]/60">
                <td className="px-5 py-2.5 text-txt">
                  <span className="flex items-center gap-2">
                    <NetIcon slug={n.slug} label={n.label} chainId={n.chain.id} size={18} />
                    {n.label}
                  </span>
                </td>
                <td className="px-5 py-2.5">
                  <a
                    href={`${n.explorer}/address/${n.hook}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-magenta hover:underline"
                  >
                    {SHORT_HOOK}
                  </a>
                </td>
                <td className="px-5 py-2.5 max-sm:hidden">
                  <span className={`pill ${n.testnet ? "" : "hi"}`}>{n.testnet ? "testnet" : "mainnet"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mono border-t border-[var(--line)] px-5 py-3 text-[11px] text-dim2">
        canonical <span className="text-magenta">{CANONICAL_HOOK}</span> — every network, no exceptions
      </div>
    </div>
  );
}
