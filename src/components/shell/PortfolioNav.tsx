import { Link } from "@tanstack/react-router";

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
		</nav>
	);
}
