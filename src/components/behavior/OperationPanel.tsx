import { useConvexAuth } from "convex/react";
import { Component, type ReactNode } from "react";
import { backendConfigured } from "../../integrations/convex/provider";
import { browserIdentityMode } from "../../lib/identity-mode";
import { Button } from "../ui/button";
import { workbenchError } from "./workbench";

/** With WorkOS identity the Convex client receives its token a moment AFTER the page mounts.
 * A query issued in that window is sent without a token, answers `unauthenticated`, and the
 * error boundary below then sticks on "Retry loading" for a user who is in fact signed in
 * (observed in a real browser login). So backend reads wait until Convex says auth is settled.
 * This gate grants nothing: it only delays the request; Convex still decides every call. */
function WhenAuthSettled({ children }: { children: ReactNode }) {
	const { isLoading, isAuthenticated } = useConvexAuth();
	if (isLoading) {
		return <output className="block rounded border p-4">Connecting…</output>;
	}
	if (!isAuthenticated) {
		return (
			<output className="block rounded border p-4">
				Sign in to see your repositories, investigations and briefs.
			</output>
		);
	}
	return <>{children}</>;
}

/** A failed optional read must not discard the parent decision draft. */
export class OperationPanel extends Component<
	{ children: ReactNode },
	{ error?: unknown; failed: boolean }
> {
	state: { error?: unknown; failed: boolean } = { failed: false };
	static getDerivedStateFromError(error: unknown) {
		return { error, failed: true };
	}
	render() {
		// A bundle built without VITE_CONVEX_URL has no Convex client in context; say so instead
		// of letting useConvex() throw and take the page down.
		if (!backendConfigured) {
			return (
				<output className="block rounded border p-4">
					The backend is not configured for this build, so saved investigations,
					snapshots and briefs are unavailable here.
				</output>
			);
		}
		if (this.state.failed) {
			return (
				<div className="space-y-3 rounded border p-4">
					<p role="alert">{workbenchError(this.state.error)}</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => this.setState({ failed: false, error: undefined })}
					>
						Retry loading
					</Button>
				</div>
			);
		}
		// Mode "none" keeps the previous behavior: requests go out and the backend answers them.
		if (browserIdentityMode === "workos") {
			return <WhenAuthSettled>{this.props.children}</WhenAuthSettled>;
		}
		return this.props.children;
	}
}
