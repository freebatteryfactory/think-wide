import { Copy } from "lucide-react";
import { useId } from "react";
import { Button } from "#/components/ui/button";
import { MCP_SERVER_URL } from "./connect-agent";

type ConnectAgentProps = {
	/** Shown in the polite live region. Empty until the person asks for a copy. */
	copyStatus: string;
	onCopy: () => void;
};

// Presentational, like its siblings: the owner holds the copy state and performs the copy
// (src/routes/index.tsx). The URL is printed once, from the constant.
export function ConnectAgent({ copyStatus, onCopy }: ConnectAgentProps) {
	const id = useId();

	return (
		<section className="connect-agent" aria-labelledby={`${id}-heading`}>
			<span className="eyebrow">Remote MCP server</span>
			<h2 id={`${id}-heading`}>Connect your agent</h2>
			<p>
				An MCP host such as ChatGPT, Claude.ai, Claude Code or Cursor connects
				to Think-wide directly. There is nothing to install.
			</p>
			<div className="connect-agent-url">
				<code id={`${id}-url`}>{MCP_SERVER_URL}</code>
				<Button
					type="button"
					variant="outline"
					size="sm"
					aria-describedby={`${id}-url`}
					onClick={onCopy}
				>
					<Copy aria-hidden="true" /> Copy MCP server URL
				</Button>
			</div>
			<output className="status-message" aria-live="polite">
				{copyStatus}
			</output>
			<ol className="connect-agent-steps">
				<li>
					Add the URL as a custom connector or MCP server in ChatGPT, Claude.ai
					or another MCP host.
				</li>
				<li>Sign in when the host opens the WorkOS page.</li>
				<li>
					Ask the agent to call <code>claimDemoAccess</code>, then{" "}
					<code>listProjects</code>, to see the public demo repositories.
				</li>
			</ol>
			<p className="field-help">
				A connector sign-in and a website sign-in are separate identities today,
				even for the same person. An investigation opened by an agent is not yet
				visible on this website.
			</p>
		</section>
	);
}
