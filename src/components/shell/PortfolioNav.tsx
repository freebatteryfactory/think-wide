import { Link } from "@tanstack/react-router";
import { AuthIndicator } from "./AuthIndicator";

export function PortfolioNav() {
	return (
		<nav
			aria-label="Workspace navigation"
			className="flex flex-wrap gap-5 text-sm"
		>
			<Link to="/" className="underline underline-offset-4">
				Investigations
			</Link>
			<Link to="/workshop" className="underline underline-offset-4">
				Component workshop
			</Link>
			<AuthIndicator />
		</nav>
	);
}
