import { createFileRoute } from "@tanstack/react-router";
import { useConvex, useConvexConnectionState, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { HandoffExport } from "../components/behavior/HandoffExport";
import { OperationPanel } from "../components/behavior/OperationPanel";
import { PortfolioNav } from "../components/shell/PortfolioNav";

export const Route = createFileRoute("/handoffs/$handoffId")({
	component: HandoffPage,
});
function HandoffPage() {
	const { handoffId } = Route.useParams();
	return (
		<main className="mx-auto max-w-5xl space-y-6 p-6">
			<PortfolioNav />
			<h1 className="text-3xl">Saved implementation brief</h1>
			<OperationPanel key={handoffId}>
				<SavedBrief handoffId={handoffId} />
			</OperationPanel>
		</main>
	);
}
function SavedBrief({ handoffId }: { handoffId: string }) {
	const client = useConvex();
	const connection = useConvexConnectionState();
	const brief = useQuery(api.handoffs.readHandoff, {
		request: { handoffId, detail: "summary" },
	});
	if (!connection.isWebSocketConnected) {
		return <output>Connecting to saved brief service…</output>;
	}
	if (!brief) {
		return <output>Loading saved brief…</output>;
	}
	if (!("targetRepository" in brief) || !("bodyByteLength" in brief)) {
		throw new Error("Invalid brief summary");
	}
	return (
		<div className="space-y-4">
			<p>
				Investigation {brief.investigationId} · revision{" "}
				{brief.investigationRevision}
			</p>
			<p className="break-all">
				Target {brief.targetRepository.repositoryId} at{" "}
				{brief.targetRepository.baseCommit}
			</p>
			<p>
				{brief.bodyByteLength} exact UTF-8 bytes. Bookmark this page to reopen
				the immutable brief.
			</p>
			<HandoffExport
				selection={brief}
				read={(request) => client.query(api.handoffs.readHandoff, { request })}
			/>
		</div>
	);
}
