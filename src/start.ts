import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

const csrfMiddleware = createCsrfMiddleware({
	filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, authkitMiddleware()],
}));
