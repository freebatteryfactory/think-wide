import {
	useConvexAuth,
	useConvexConnectionState,
	useMutation,
	useQuery,
} from "convex/react";
import { useId, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type {
	OpenInvestigationRequest,
	Project,
} from "../../../generated/types";
import {
	OpenInvestigationRequest as isOpenRequest,
	Project as isProject,
} from "../../../generated/validators.js";
import { browserIdentityMode } from "../../lib/identity-mode";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { CatalogClaimGate } from "./CatalogClaimGate";
import { SnapshotBrowser } from "./SnapshotBrowser";
import { operationError, workbenchError } from "./workbench";

export function ProjectPortfolio(props: { onOpen: (id: string) => void }) {
	return browserIdentityMode === "workos" ? (
		<AuthenticatedPortfolio {...props} />
	) : (
		<PortfolioContents {...props} />
	);
}
function AuthenticatedPortfolio(props: { onOpen: (id: string) => void }) {
	const auth = useConvexAuth();
	const claim = useMutation(api.catalog.claimDemoAccess);
	if (auth.isLoading) {
		return <output>Connecting…</output>;
	}
	if (!auth.isAuthenticated) {
		return <output>Sign in to see your repositories.</output>;
	}
	return (
		<CatalogClaimGate claim={claim}>
			<PortfolioContents {...props} />
		</CatalogClaimGate>
	);
}
function PortfolioContents({ onOpen }: { onOpen: (id: string) => void }) {
	const id = useId();
	const connection = useConvexConnectionState();
	const [cursor, setCursor] = useState<string>();
	const page = useQuery(api.projects.listProjects, {
		request: cursor ? { cursor } : {},
	});
	const open = useMutation(api.investigations.openInvestigation);
	const [selected, setSelected] = useState<string[]>([]);
	const [question, setQuestion] = useState("");
	const [browsing, setBrowsing] = useState<string>();
	const [pending, setPending] = useState<OpenInvestigationRequest>();
	const [saving, setSaving] = useState(false);
	const busy = useRef(false);
	const [message, setMessage] = useState("");
	async function create() {
		if (busy.current) {
			return;
		}
		const value = pending ?? {
			snapshotIds: selected,
			question,
			requestKey: crypto.randomUUID(),
		};
		if (!question.trim() || !isOpenRequest(value)) {
			setMessage("Select one to eight snapshots and enter a question.");
			return;
		}
		const request = value as OpenInvestigationRequest;
		busy.current = true;
		setSaving(true);
		setPending(request);
		try {
			const result = await open({ request });
			setPending(undefined);
			onOpen(result.investigationId);
		} catch (error) {
			setMessage(workbenchError(error));
			if (operationError(error)) {
				setPending(undefined);
			}
		} finally {
			busy.current = false;
			setSaving(false);
		}
	}
	if (!connection.isWebSocketConnected) {
		return <output>Connecting to the project service…</output>;
	}
	if (!page) {
		return <output>Loading authorized projects…</output>;
	}
	const projects = page.entries.map((value) => {
		if (!isProject(value)) {
			throw new Error("Invalid project");
		}
		return value as Project;
	});
	return (
		<section className="space-y-4">
			<h2 className="text-xl">Start from repository snapshots</h2>
			<p className="field-help">
				Only repositories you can access are listed. Source ingestion is managed
				by the configured operator.
			</p>
			<form
				className="space-y-4"
				onSubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<fieldset disabled={saving || !!pending} className="space-y-4">
					{projects.map((project) => (
						<article
							className="rounded border p-4 space-y-2"
							key={project.repositoryId}
						>
							<h3>
								{project.displayName} · {project.dataLabel ?? "unlabeled"}
							</h3>
							{project.snapshots.map((snapshot) => (
								<div key={snapshot.snapshotId} className="space-y-2">
									<label className="flex items-start gap-2">
										<input
											type="checkbox"
											checked={selected.includes(snapshot.snapshotId)}
											disabled={
												!selected.includes(snapshot.snapshotId) &&
												selected.length >= 8
											}
											onChange={(event) =>
												setSelected(
													event.target.checked
														? [...selected, snapshot.snapshotId]
														: selected.filter(
																(value) => value !== snapshot.snapshotId,
															),
												)
											}
										/>
										<span className="break-all">
											{snapshot.commit} · {snapshot.coverage}
										</span>
									</label>
									<Button
										type="button"
										variant="outline"
										onClick={() => setBrowsing(snapshot.snapshotId)}
									>
										Browse exact source
									</Button>
								</div>
							))}
						</article>
					))}
					{!projects.length ? (
						<p>No authorized snapshots on this page.</p>
					) : null}
					<p>{selected.length} selected across pages</p>
					{selected.length ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => setSelected([])}
						>
							Clear selection
						</Button>
					) : null}
					{page.nextCursor ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => setCursor(page.nextCursor ?? undefined)}
						>
							Next project page
						</Button>
					) : null}
					{cursor ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => setCursor(undefined)}
						>
							First project page
						</Button>
					) : null}
					<Label htmlFor={id}>Investigation question</Label>
					<Textarea
						id={id}
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						maxLength={16384}
						required
					/>
				</fieldset>
				<Button
					type="submit"
					disabled={
						saving || (!pending && (!selected.length || !question.trim()))
					}
				>
					{saving
						? "Opening…"
						: pending
							? "Retry the same request"
							: "Open investigation"}
				</Button>
				<output className="block" aria-live="polite">
					{message}
				</output>
			</form>
			{browsing ? (
				<SnapshotBrowser key={browsing} snapshotId={browsing} />
			) : null}
		</section>
	);
}
