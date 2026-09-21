import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ResultEnvelope } from "../../../generated/types";
import { CatalogClaimGate } from "../../../src/components/behavior/CatalogClaimGate";
import { ProjectPortfolio } from "../../../src/components/behavior/ProjectPortfolio";
import {
	CatalogSessionProvider,
	type ClaimCatalog,
} from "../../../src/integrations/convex/catalog-session";
import { events, ViewAuth } from "./catalog-view-client";

const waits = new Map<
	string,
	{ resolve: (value: ResultEnvelope) => void; reject: (error: Error) => void }
>();
const calls: Record<string, string[]> = { A: [], B: [] };
const invoke =
	(account: string): ClaimCatalog =>
	({ request }) => {
		calls[account].push(request.requestKey);
		return new Promise((resolve, reject) =>
			waits.set(account, { resolve, reject }),
		);
	};
const mutations = { A: invoke("A"), B: invoke("B") };
const result: ResultEnvelope = {
	kind: "projects",
	scope: { snapshotIds: ["shared"] },
	entries: [],
	coverage: { status: "not_indexed" },
	nextCursor: null,
	truncated: { is: false },
};
function App() {
	const [account, setAccount] = useState<"A" | "B">("A");
	const [authenticated, setAuthenticated] = useState(false);
	const [shown, setShown] = useState(true);
	const [tick, setTick] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setAuthenticated(true)}>
				Authenticate
			</button>
			<button type="button" onClick={() => setAccount("B")}>
				Switch to B
			</button>
			<button type="button" onClick={() => setShown((value) => !value)}>
				Toggle portfolio
			</button>
			<button type="button" onClick={() => setTick((value) => value + 1)}>
				Rerender
			</button>
			{(["A", "B"] as const).map((who) => (
				<span key={who}>
					<button type="button" onClick={() => waits.get(who)?.resolve(result)}>
						Resolve {who}
					</button>
					<button
						type="button"
						onClick={() => waits.get(who)?.reject(new Error("Grant revoked"))}
					>
						Reject {who}
					</button>
				</span>
			))}
			<button type="button" onClick={() => setRefreshing((value) => !value)}>
				Toggle refresh
			</button>
			<output data-testid="events">{JSON.stringify(events)}</output>
			<output data-testid="calls">{JSON.stringify(calls)}</output>
			<span>{tick}</span>
			<CatalogSessionProvider key={account}>
				{new URLSearchParams(window.location.search).has("portfolio") ? (
					<ViewAuth.Provider
						value={{
							isLoading: false,
							isAuthenticated: authenticated,
							isRefreshing: refreshing,
						}}
					>
						<ProjectPortfolio onOpen={() => undefined} />
					</ViewAuth.Provider>
				) : authenticated && shown ? (
					<CatalogClaimGate claim={mutations[account]}>
						<div data-testid="portfolio">Portfolio {account}</div>
					</CatalogClaimGate>
				) : (
					<p>Waiting for authentication or navigation</p>
				)}
			</CatalogSessionProvider>
		</>
	);
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
