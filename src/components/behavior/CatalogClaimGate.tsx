import { type ReactNode, useEffect, useState } from "react";
import {
	type ClaimCatalog,
	useCatalogSession,
} from "../../integrations/convex/catalog-session";
import { Button } from "../ui/button";
import { workbenchError } from "./workbench";

/** Only the portfolio waits for catalog enrollment; existing investigations stay independent. */
export function CatalogClaimGate({
	claim,
	children,
}: {
	claim: ClaimCatalog;
	children: ReactNode;
}) {
	const session = useCatalogSession();
	const [attempt, setAttempt] = useState(0);
	return (
		<CatalogClaimAttempt
			key={attempt}
			claim={claim}
			onRetry={() => {
				session.retry();
				setAttempt((value) => value + 1);
			}}
		>
			{children}
		</CatalogClaimAttempt>
	);
}
function CatalogClaimAttempt({
	claim,
	children,
	onRetry,
}: {
	claim: ClaimCatalog;
	children: ReactNode;
	onRetry: () => void;
}) {
	const session = useCatalogSession();
	const [state, setState] = useState<{
		status: "loading" | "ready" | "failed";
		error?: unknown;
	}>({ status: "loading" });
	useEffect(() => {
		let active = true;
		setState({ status: "loading" });
		// StrictMode's second setup must subscribe to the same in-flight promise.
		void session.claim(claim).then(
			() => {
				if (active) {
					setState({ status: "ready" });
				}
			},
			(error: unknown) => {
				if (active) {
					setState({ status: "failed", error });
				}
			},
		);
		return () => {
			active = false;
		};
	}, [session, claim]);
	if (state.status === "ready") {
		return <>{children}</>;
	}
	if (state.status === "loading") {
		return <output>Preparing your demo repositories…</output>;
	}
	return (
		<section className="space-y-3 rounded border p-4">
			<p role="alert">
				Demo repositories could not be added. {workbenchError(state.error)}
			</p>
			<Button type="button" onClick={onRetry}>
				Retry demo access
			</Button>
			<Button
				type="button"
				variant="outline"
				onClick={() => setState({ status: "ready" })}
			>
				Continue to my existing repositories
			</Button>
		</section>
	);
}
