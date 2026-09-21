import type { ReactNode } from "react";
// Avoid booting TanStack server functions in this standalone browser component harness.
export const backendConfigured = true;
export default function Backend({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
