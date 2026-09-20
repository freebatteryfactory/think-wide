import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useId, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type {
	Investigation,
	PrepareHandoffRequest,
	Project,
} from "../../../generated/types";
import { Project as isProject } from "../../../generated/validators.js";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { operationError, workbenchError } from "./workbench";

export function PrepareBrief({
	investigation,
}: {
	investigation: Investigation;
}) {
	const id = useId();
	const navigate = useNavigate();
	const [cursor, setCursor] = useState<string>();
	const page = useQuery(api.projects.listProjects, {
		request: cursor ? { cursor } : {},
	});
	const prepare = useMutation(api.handoffs.prepareHandoff);
	const [target, setTarget] = useState("");
	const [pending, setPending] = useState<PrepareHandoffRequest>();
	const [saving, setSaving] = useState(false);
	const busy = useRef(false);
	const [message, setMessage] = useState("");
	const projects = (page?.entries ?? [])
		.map((value) => {
			if (!isProject(value)) {
				throw new Error("Invalid project");
			}
			return value as Project;
		})
		.filter((project) =>
			project.snapshots.some((snapshot) =>
				investigation.snapshotIds.includes(snapshot.snapshotId),
			),
		);
	async function save() {
		if (
			busy.current ||
			(!pending && !projects.some((project) => project.repositoryId === target))
		) {
			return;
		}
		const request = pending ?? {
			investigationId: investigation.investigationId,
			expectedRevision: investigation.revision,
			targetRepositoryId: target,
			audience: "private_download" as const,
			requestKey: crypto.randomUUID(),
		};
		busy.current = true;
		setSaving(true);
		setPending(request);
		setMessage("");
		try {
			const saved = await prepare({ request });
			setPending(undefined);
			await navigate({
				to: "/handoffs/$handoffId",
				params: { handoffId: saved.handoffId },
			});
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
	return (
		<section className="space-y-3 rounded border p-5">
			<h2 className="text-xl">Implementation brief</h2>
			<p>
				Freeze revision {investigation.revision} with its complete decision
				ledger and verified evidence.
			</p>
			<Label htmlFor={id}>Target repository</Label>
			<select
				id={id}
				value={target}
				disabled={saving || !!pending}
				onChange={(event) => setTarget(event.target.value)}
			>
				<option value="">Select a target</option>
				{projects.map((project) => (
					<option key={project.repositoryId} value={project.repositoryId}>
						{project.displayName}
					</option>
				))}
			</select>
			{!page ? (
				<output>Loading targets…</output>
			) : !projects.length ? (
				<p>No investigation targets on this project page.</p>
			) : null}
			{page?.nextCursor ? (
				<Button
					variant="outline"
					disabled={saving || !!pending}
					onClick={() => {
						setCursor(page.nextCursor ?? undefined);
						setTarget("");
					}}
				>
					Next target page
				</Button>
			) : null}
			{cursor ? (
				<Button
					variant="outline"
					disabled={saving || !!pending}
					onClick={() => {
						setCursor(undefined);
						setTarget("");
					}}
				>
					First target page
				</Button>
			) : null}
			<div className="flex flex-wrap gap-3">
				<Button
					disabled={
						saving ||
						(!pending &&
							!projects.some((project) => project.repositoryId === target))
					}
					onClick={() => void save()}
				>
					{saving
						? "Preparing…"
						: pending
							? "Retry the same preparation"
							: "Prepare private brief"}
				</Button>
				<Button variant="outline" disabled>
					Publish GitHub issue
				</Button>
			</div>
			<p className="field-help">
				Issue publication is not connected. File-level scope and implementation
				tests require specialist review.
			</p>
			<output className="block" aria-live="polite">
				{message}
			</output>
		</section>
	);
}
