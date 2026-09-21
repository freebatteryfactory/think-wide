// Browser view transport only; these controls do not exercise or replace backend authorization.

import { createContext, useContext } from "react";
import type { ResultEnvelope } from "../../../generated/types";
export const ViewAuth = createContext({
	isLoading: false,
	isAuthenticated: true,
	isRefreshing: false,
});
export const events: string[] = [];
const project = {
	repositoryId: "shared",
	displayName: "Shared demo",
	provider: "local-git",
	dataLabel: "public",
	syncStatus: "ready",
	snapshots: [
		{
			snapshotId: "shared",
			commit: "a".repeat(40),
			rootTreeId: "b".repeat(40),
			hashAlgorithm: "sha1",
			indexedAt: 1,
			coverage: "not_indexed",
		},
	],
};
const result: ResultEnvelope = {
	kind: "projects",
	scope: { snapshotIds: ["shared"] },
	entries: [project],
	coverage: { status: "not_indexed" },
	nextCursor: null,
	truncated: { is: false },
};
const claim = async () => {
	events.push("claim");
	return result;
};
export const useMutation = () => claim;
export const useQuery = () => {
	events.push("query");
	return result;
};
export const useConvexAuth = () => useContext(ViewAuth);
export const useConvexConnectionState = () => ({ isWebSocketConnected: true });
