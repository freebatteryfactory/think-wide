import { createContext, type ReactNode, useContext, useState } from "react";
import type {
	ClaimDemoAccessRequest,
	ResultEnvelope,
} from "../../../generated/types";

export type ClaimCatalog = (args: {
	request: ClaimDemoAccessRequest;
}) => Promise<ResultEnvelope>;

/** UI request deduplication only. No token, principal or response body is cached. */
export function createCatalogSession() {
	let requestKey: string | undefined;
	let pending: Promise<void> | undefined;
	return {
		claim(invoke: ClaimCatalog) {
			if (!pending) {
				requestKey ??= crypto.randomUUID();
				const request = { requestKey };
				pending = Promise.resolve()
					.then(() => invoke({ request }))
					.then(() => undefined);
			}
			return pending;
		},
		retry() {
			pending = undefined;
		},
	};
}

const CatalogSession = createContext<ReturnType<
	typeof createCatalogSession
> | null>(null);
export function CatalogSessionProvider({ children }: { children: ReactNode }) {
	const [session] = useState(createCatalogSession);
	return (
		<CatalogSession.Provider value={session}>
			{children}
		</CatalogSession.Provider>
	);
}
export function useCatalogSession() {
	const session = useContext(CatalogSession);
	if (!session) {
		throw new Error("Catalog session is unavailable");
	}
	return session;
}
