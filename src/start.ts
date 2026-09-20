import {
	createCsrfMiddleware,
	createIsomorphicFn,
	createStart,
} from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
import { browserIdentityMode, type IdentityMode } from "./lib/identity-mode";
import { serverIdentityMode } from "./server/auth/workos";

const csrfMiddleware = createCsrfMiddleware({
	filter: (context) => context.handlerType === "serverFn",
});

// I01: `authkitMiddleware()` validates WORKOS_* on its first request and throws when they
// are missing, which turned EVERY page of an unconfigured deployment, including the static
// ones, into HTTP 500 (observed on this branch before this change). The middleware is
// therefore installed only when the server is explicitly started with
// THINK_WIDE_IDENTITY=workos. Leaving it out removes sign-in; it cannot grant access,
// because Convex authorizes from a verified token and nothing else.
const identityMode = createIsomorphicFn()
	.server((): IdentityMode => serverIdentityMode())
	.client((): IdentityMode => browserIdentityMode);

export const startInstance = createStart(() => ({
	requestMiddleware:
		identityMode() === "workos"
			? [csrfMiddleware, authkitMiddleware()]
			: [csrfMiddleware],
}));
