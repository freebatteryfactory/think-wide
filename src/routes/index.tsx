import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { InvestigationAccess } from "../components/behavior/InvestigationAccess";
import { OperationPanel } from "../components/behavior/OperationPanel";
import { ProjectPortfolio } from "../components/behavior/ProjectPortfolio";
import { PortfolioNav } from "../components/shell/PortfolioNav";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const navigate = useNavigate();
	return (
		<main className="home-intro">
			<PortfolioNav />
			<p className="eyebrow">Cross-project perspective</p>
			<h1>Think-wide</h1>
			<p>Evidence, human decisions, and clearer implementation briefs.</p>
			<InvestigationAccess
				onOpen={(investigationId) => {
					void navigate({
						to: "/investigations/$investigationId",
						params: { investigationId },
					});
				}}
			/>
			<OperationPanel>
				<ProjectPortfolio
					onOpen={(investigationId) => {
						void navigate({
							to: "/investigations/$investigationId",
							params: { investigationId },
						});
					}}
				/>
			</OperationPanel>
		</main>
	);
}
