import { isNonEmptyString } from "./config/type-guards.ts";

/**
 * A primary workspace this process saw Herdr open while creating a worktree.
 * The record lives only in this process. Another session is another process,
 * and a restart starts empty, so neither reports a claim. Nothing is persisted.
 */
export interface PrimaryWorkspaceClaim {
	workspaceId: string;
	repoKey: string;
	terminalId: string;
	checkoutPath: string;
}

export interface ReleasedPrimaryWorkspaceClaim {
	workspaceId: string;
	repoKey: string;
	terminalId: string;
}

/**
 * A report never closes a workspace. `note` is absent when nothing is safe to
 * suggest, and never states the attribution as fact.
 */
export interface OpenedPrimaryWorkspaceReport {
	note?: string;
	repoKey: string;
	releasedClaims: ReleasedPrimaryWorkspaceClaim[];
}

const openedPrimaryWorkspacesKey = Symbol.for(
	"pi-herdr-agents:opened-primary-workspaces",
);

interface OpenedPrimaryWorkspaceStore {
	claims: PrimaryWorkspaceClaim[];
}

function store(): OpenedPrimaryWorkspaceStore {
	// SAFETY: this extension alone writes this process-local symbol.
	const globalStore = globalThis as typeof globalThis & {
		[openedPrimaryWorkspacesKey]?: OpenedPrimaryWorkspaceStore;
	};
	return (globalStore[openedPrimaryWorkspacesKey] ??= { claims: [] });
}

export function isCompletePrimaryWorkspaceClaim(
	value: PrimaryWorkspaceClaim,
): boolean {
	return (
		isNonEmptyString(value.workspaceId) &&
		isNonEmptyString(value.repoKey) &&
		isNonEmptyString(value.terminalId) &&
		isNonEmptyString(value.checkoutPath)
	);
}

function sameClaim(
	left: PrimaryWorkspaceClaim,
	right: PrimaryWorkspaceClaim,
): boolean {
	return (
		left.workspaceId === right.workspaceId &&
		left.repoKey === right.repoKey &&
		left.terminalId === right.terminalId &&
		left.checkoutPath === right.checkoutPath
	);
}

export function rememberOpenedPrimaryWorkspace(
	claim: PrimaryWorkspaceClaim,
): void {
	if (!isCompletePrimaryWorkspaceClaim(claim)) return;
	const claims = store().claims;
	if (claims.some((existing) => sameClaim(existing, claim))) return;
	claims.push({
		workspaceId: claim.workspaceId,
		repoKey: claim.repoKey,
		terminalId: claim.terminalId,
		checkoutPath: claim.checkoutPath,
	});
}

export function openedPrimaryWorkspaceClaims(): PrimaryWorkspaceClaim[] {
	return store()
		.claims.filter(isCompletePrimaryWorkspaceClaim)
		.map((claim) => ({ ...claim }));
}

export function forgetOpenedPrimaryWorkspaceClaims(
	released: readonly ReleasedPrimaryWorkspaceClaim[],
): void {
	if (!released.length) return;
	const claims = store().claims;
	store().claims = claims.filter(
		(claim) =>
			!released.some(
				(entry) =>
					entry.workspaceId === claim.workspaceId &&
					entry.repoKey === claim.repoKey &&
					entry.terminalId === claim.terminalId,
			),
	);
}

export function clearOpenedPrimaryWorkspaceClaims(): void {
	store().claims = [];
}
