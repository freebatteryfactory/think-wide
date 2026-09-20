import { createFileRoute, Link } from "@tanstack/react-router";
import { InvestigationWorkbench } from "../components/behavior/InvestigationWorkbench";
import { OperationPanel } from "../components/behavior/OperationPanel";
import {
	operationError,
	workbenchError,
} from "../components/behavior/workbench";
import { PortfolioNav } from "../components/shell/PortfolioNav";

export const Route = createFileRoute("/investigations/$investigationId")({
	component: InvestigationPage,
	errorComponent: ({ error, reset }) => (
		<main className="mx-auto max-w-5xl space-y-4 p-6">
			<h1 className="text-2xl font-semibold">Investigation unavailable</h1>
			<p role="alert">
				{operationError(error)
					? workbenchError(error)
					: "The investigation could not be loaded. Try again when the connection is available."}
			</p>
			<button
				type="button"
				className="rounded border px-4 py-2"
				onClick={reset}
			>
				Try again
			</button>
			<p>
				<Link to="/">Back to home</Link>
			</p>
		</main>
	),
});

function InvestigationPage() {
	const { investigationId } = Route.useParams();
	return (
		<main className="mx-auto max-w-6xl space-y-6 p-4 text-foreground sm:p-8">
			<PortfolioNav />
			<OperationPanel key={investigationId}>
				<InvestigationWorkbench
					key={investigationId}
					investigationId={investigationId}
				/>
			</OperationPanel>
		</main>
	);
}
