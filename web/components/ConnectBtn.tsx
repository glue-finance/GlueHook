"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 * Wallet button in the site's sticker-button style.
 * No chain selector up here — the network is picked inside the page itself;
 * only a genuinely unsupported wallet network surfaces as an error state.
 */
export function ConnectBtn() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <div
            aria-hidden={!ready}
            style={!ready ? { opacity: 0, pointerEvents: "none", userSelect: "none" } : undefined}
          >
            {!connected ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openConnectModal}>
                Connect Wallet
              </button>
            ) : chain.unsupported ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: "var(--t-bad)", borderColor: "var(--t-bad)" }}
                onClick={openChainModal}
              >
                wrong network
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm mono" onClick={openAccountModal}>
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
                </span>
                {account.displayName}
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
