import {
	useConvex,
	useConvexConnectionState,
	useMutation,
	useQuery,
} from "convex/react";
import { useId, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type {
	Decision,
	Investigation,
	RecordDecisionRequest,
	SourceRef,
} from "../../../generated/types";
import { DecisionEditor } from "./DecisionEditor";
import {
	InvestigationEvidence,
	SourceReferences,
} from "./InvestigationEvidence";
import { OperationPanel } from "./OperationPanel";
import { PrepareBrief } from "./PrepareBrief";
import { SnapshotBrowser } from "./SnapshotBrowser";
import {
	appendDecisionPage,
	decisionCommand,
	decisionLabels,
	operationError,
	workbenchError,
} from "./workbench";

const control =
	"rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
const button = `${control} cursor-pointer disabled:cursor-not-allowed`;

export function InvestigationWorkbench({
	investigationId,
}: {
	investigationId: string;
}) {
	const client = useConvex();
	const connection = useConvexConnectionState();
	const recordDecision = useMutation(api.decisions.recordDecision);
	// A live authorized query owns the visible revision and removes the view if
	// access is revoked. No localStorage, fixture principal, or parallel state store.
	const investigation = useQuery(api.investigations.readInvestigation, {
		request: { investigationId },
	});
	const fieldId = useId();
	const [draft, setDraft] = useState<
		Pick<RecordDecisionRequest, "kind" | "statement">
	>({ kind: "constraint", statement: "" });
	const [references, setReferences] = useState<SourceRef[]>([]);
	const [sourceSnapshot, setSourceSnapshot] = useState<string>();
	const [baseRevision, setBaseRevision] = useState<number>();
	const [pending, setPending] = useState<RecordDecisionRequest>();
	const [saving, setSaving] = useState(false);
	const inFlight = useRef(false);
	const [message, setMessage] = useState("");
	const [pageError, setPageError] = useState("");
	const [loadingPage, setLoadingPage] = useState(false);
	const [history, setHistory] = useState<{
		base: Investigation;
		connectionCount: number;
		decisions: Decision[];
		cursor: string | null;
	}>();
	if (!connection.isWebSocketConnected) {
		return (
			<output>
				Connecting to the investigation service… Saved content will appear when
				the connection is available.
			</output>
		);
	}
	if (!investigation) {
		return <output>Loading investigation…</output>;
	}
	// An updated authorized result invalidates previously fetched pages even when
	// the revision is unchanged (e.g. a proposal or grant change).
	const activeHistory =
		history?.base === investigation &&
		history.connectionCount === connection.connectionCount
			? history
			: undefined;
	const decisions =
		activeHistory?.decisions ??
		appendDecisionPage([], investigation, investigation);
	const cursor = activeHistory
		? activeHistory.cursor
		: investigation.page?.nextCursor;
	const staleDraft =
		baseRevision !== undefined && baseRevision !== investigation.revision;

	async function save() {
		if (!investigation || inFlight.current) {
			return;
		}
		let request: RecordDecisionRequest;
		try {
			request =
				pending ??
				decisionCommand(
					{ investigationId, revision: baseRevision ?? investigation.revision },
					draft,
					crypto.randomUUID(),
					references,
				);
		} catch {
			setMessage(
				"Write a decision within the 16,384 character limit before saving.",
			);
			return;
		}
		inFlight.current = true;
		setSaving(true);
		setPending(request);
		setMessage("");
		try {
			const saved = await recordDecision({ request });
			setDraft({ kind: draft.kind, statement: "" });
			setReferences([]);
			setBaseRevision(undefined);
			setPending(undefined);
			setMessage(
				`Decision saved at revision ${saved.resultingRevision}. It will remain when you reopen this investigation.`,
			);
		} catch (error) {
			setMessage(workbenchError(error));
			// Known operation failures roll back the transaction. A transport failure
			// may follow a committed write: keep the exact request/key for replay.
			if (operationError(error)) {
				setPending(undefined);
			}
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	}

	async function loadMore() {
		if (!investigation || !cursor || loadingPage) {
			return;
		}
		setLoadingPage(true);
		setPageError("");
		try {
			const page = await client.query(api.investigations.readInvestigation, {
				request: { investigationId, cursor },
			});
			setHistory({
				base: investigation,
				connectionCount: connection.connectionCount,
				decisions: appendDecisionPage(decisions, page, investigation),
				cursor: page.page?.nextCursor ?? null,
			});
		} catch {
			setHistory(undefined);
			setPageError(
				"Could not load more history. The investigation may have changed; retry from the current page.",
			);
		} finally {
			setLoadingPage(false);
		}
	}

	return (
		<div className="space-y-8">
			<header className="space-y-3">
				<p className="text-sm text-muted-foreground">
					Investigation · revision {investigation.revision}
				</p>
				<h1 className="whitespace-pre-wrap break-words text-3xl font-semibold">
					{investigation.question}
				</h1>
				<p className="text-sm">
					Saved decisions belong to this investigation. No model call is needed
					to record your judgment.
				</p>
			</header>
			<div className="grid gap-6 lg:grid-cols-2">
				<DecisionEditor
					draft={draft}
					onDraftChange={(next) => {
						setDraft(next);
						setBaseRevision(baseRevision ?? investigation.revision);
					}}
					onSave={() => void save()}
					locked={saving || !!pending}
					saveDisabled={
						saving || (!pending && (staleDraft || !draft.statement.trim()))
					}
					submitLabel={
						saving
							? "Saving…"
							: pending
								? "Retry the same save"
								: "Save decision"
					}
					message={message}
					review={
						staleDraft && !pending
							? {
									revision: investigation.revision,
									onConfirm: () => {
										setBaseRevision(investigation.revision);
										setMessage("");
									},
								}
							: undefined
					}
				/>
				<section
					className="space-y-4 rounded-lg border bg-card p-5"
					aria-labelledby={`${fieldId}-history`}
				>
					<h2 id={`${fieldId}-history`} className="text-xl font-semibold">
						Saved decision history
					</h2>
					<p className="text-sm text-muted-foreground">
						Showing {decisions.length} saved decisions
						{cursor ? "; more available" : ""}. Prior decisions remain in the
						ledger.
					</p>
					<ol className="space-y-4">
						{decisions.map((decision) => (
							<li key={decision.decisionId} className="space-y-2 border-t pt-3">
								<p className="font-medium">
									{decisionLabels[decision.kind]} · revision{" "}
									{decision.resultingRevision}
								</p>
								<p className="whitespace-pre-wrap break-words">
									{decision.statement}
								</p>
								<SourceReferences references={decision.refs ?? []} />
							</li>
						))}
					</ol>
					{cursor ? (
						<button
							type="button"
							className={button}
							disabled={loadingPage}
							onClick={() => void loadMore()}
						>
							{loadingPage ? "Loading…" : "Load more decisions"}
						</button>
					) : null}
					<output className="block text-sm">{pageError}</output>
				</section>
			</div>
			<InvestigationEvidence findings={investigation.acceptedFindings ?? []} />
			<section className="space-y-3">
				<label className="block">
					Browse investigation source{" "}
					<select
						value={sourceSnapshot ?? ""}
						onChange={(event) =>
							setSourceSnapshot(event.target.value || undefined)
						}
					>
						<option value="">Select a snapshot</option>
						{investigation.snapshotIds.map((id) => (
							<option key={id} value={id}>
								{id}
							</option>
						))}
					</select>
				</label>
				{sourceSnapshot ? (
					<OperationPanel key={sourceSnapshot}>
						<SnapshotBrowser
							snapshotId={sourceSnapshot}
							onUse={
								saving || pending
									? undefined
									: (ref) => {
											if (references.length >= 16) {
												setMessage(
													"A decision can reference at most 16 source windows.",
												);
												return;
											}
											setReferences([...references, ref]);
											setBaseRevision(baseRevision ?? investigation.revision);
										}
							}
						/>
					</OperationPanel>
				) : null}
				{references.length ? (
					<div>
						<p>
							{references.length} exact source windows attached to this draft.
						</p>
						<SourceReferences references={references} />
						<button
							type="button"
							className={button}
							disabled={saving || !!pending}
							onClick={() => setReferences([])}
						>
							Clear draft references
						</button>
					</div>
				) : null}
			</section>
			<OperationPanel key={`brief:${investigationId}`}>
				<PrepareBrief investigation={investigation} />
			</OperationPanel>
		</div>
	);
}
