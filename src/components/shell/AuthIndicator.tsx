import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { browserIdentityMode } from "../../lib/identity-mode";

/** Route served by src/routes/api/auth/sign-in.tsx: redirects to hosted AuthKit. */
export const SIGN_IN_PATH = "/api/auth/sign-in";

/**
 * I01: who is signed in, from the AuthKit session only. Identity mode "none" renders nothing:
 * there is no placeholder user and no fixture principal to show.
 */
export function AuthIndicator() {
	if (browserIdentityMode !== "workos") {
		return null;
	}
	return <WorkOSAuthIndicator />;
}

function WorkOSAuthIndicator() {
	const { user, loading, signOut } = useAuth();
	if (loading) {
		return <span aria-live="polite">Checking sign-in</span>;
	}
	if (!user) {
		// A plain anchor on purpose: this is a server route that answers with a redirect to
		// WorkOS, not a client-side navigation.
		return (
			<a href={SIGN_IN_PATH} className="underline underline-offset-4">
				Sign in
			</a>
		);
	}
	return (
		<>
			<span>{user.email}</span>
			<button
				type="button"
				className="underline underline-offset-4"
				onClick={() => {
					void signOut();
				}}
			>
				Sign out
			</button>
		</>
	);
}
