/**
 * Shared YOLO mode state.
 *
 * When enabled, gate extensions (git-push-gate, confirm-destructive) skip
 * their confirmation prompts for the rest of the session.
 */

let yolo = false;

export function isYolo(): boolean {
	return yolo;
}

export function setYolo(value: boolean): void {
	yolo = value;
}
