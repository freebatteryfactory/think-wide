import { Component, type ReactNode } from "react";
import { backendConfigured } from "../../integrations/convex/provider";
import { Button } from "../ui/button";
import { workbenchError } from "./workbench";

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
		return this.props.children;
	}
}
