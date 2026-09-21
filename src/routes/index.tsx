import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { InvestigationAccess } from "../components/behavior/InvestigationAccess";
import { OperationPanel } from "../components/behavior/OperationPanel";
import { ProjectPortfolio } from "../components/behavior/ProjectPortfolio";
import { ConnectAgent } from "../components/catalog/ConnectAgent";
import {
	browserClipboard,
	copyMcpServerUrl,
} from "../components/catalog/connect-agent";
import { PortfolioNav } from "../components/shell/PortfolioNav";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	const [copyStatus, setCopyStatus] = useState("");
	const openInvestigation = (investigationId: string) => {
		void navigate({
			to: "/investigations/$investigationId",
			params: { investigationId },
		});
	};
	return (
		<main className="home-intro">
			<PortfolioNav />
			<p className="eyebrow">Cross-project perspective</p>
			<h1>Think-wide</h1>
			<p>
				Think-wide gives people and their AI agents a shared, permissioned view
				across several repositories, so work already done in one can be found
				and cited from another.
			</p>
			<p>
				Evidence is exact: a repository, a full commit, a byte range and the
				sha256 of those bytes, never a paraphrase. Human decisions are durable
				and win over anything an agent regenerates later.
			</p>
			<p>It never edits, builds or runs the repositories it reads.</p>
			<ConnectAgent
				copyStatus={copyStatus}
				onCopy={() => {
					// Cleared first so a repeated copy is announced again by the live region.
					setCopyStatus("");
					void copyMcpServerUrl(browserClipboard()).then(setCopyStatus);
				}}
			/>
			<section className="home-repositories" aria-label="Repositories">
				<OperationPanel>
					<ProjectPortfolio onOpen={openInvestigation} />
				</OperationPanel>
			</section>
			<div className="home-secondary">
				<InvestigationAccess onOpen={openInvestigation} />
			</div>
		</main>
	);
}
