import {
	linkSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
	isFiniteNumber,
	isRecord,
	isString,
	type JsonObject,
} from "../../core/config/type-guards.ts";

/**
 * Immutable kernel facts naming one Pi child process for its whole life.
 * Mutable command-line text (Pi rewrites `process.title`) is never identity.
 */
export interface PiProcessIdentity {
	pid: number;
	/** `/proc/<pid>/stat` field 22: clock ticks after boot, fixed at fork. */
	startTime: string;
	/** `/proc/sys/kernel/random/boot_id`; start times are per boot. */
	bootId: string;
	/** `/proc/self/ns/pid` link target; PIDs are per PID namespace. */
	pidNamespace: string;
}

/** One sidecar per session, so a reused run ID can never inherit a record. */
export function getSubagentProcessIdentityFile(sessionFile: string): string {
	return `${sessionFile}.process.json`;
}

/** The child's self-recorded identity sidecar, bound to one run and session. */
export interface PiProcessIdentityRecord extends PiProcessIdentity {
	version: 1;
	id: string;
	sessionFile: string;
}

export interface ProcessStat {
	/** Single-letter state; Z (zombie) and X (dead) have exited. */
	state: string;
	ppid: number;
	startTime: string;
}

/** This host's kernel process facts; tests inject a fake. */
export interface ProcessIdentityProbe {
	/** The calling process's namespace facts; throws when unreadable or unsupported. */
	host(): { bootId: string; pidNamespace: string };
	/** `undefined` only when no such PID exists; throws on any other read failure. */
	stat(pid: number): ProcessStat | undefined;
	/** Sends SIGTERM to a PID; throws ESRCH when it is already gone. */
	terminate(pid: number): void;
}

export type ProcessIdentityState =
	| { kind: "alive" }
	| { kind: "exited" }
	| { kind: "unknown"; reason: string };

// `pid (comm) state ppid ...`: comm may hold spaces or parentheses, so fields
// are counted after the last `)`. Field 3 is index 0; starttime (22) is 19.
export function parseProcessStat(text: string): ProcessStat {
	const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
	const ppid = Number(fields[1]);
	const startTime = fields[19];
	if (
		!fields[0] ||
		!Number.isInteger(ppid) ||
		!startTime ||
		!/^\d+$/.test(startTime)
	)
		throw new Error("unparseable /proc stat");
	return { state: fields[0], ppid, startTime };
}

function errnoCode(error: Error): string | undefined {
	// SAFETY: fs and process.kill failures are Node errors with an optional code.
	return (error as NodeJS.ErrnoException).code;
}

/** Linux `/proc` facts; the reader is injectable only for error-path tests. */
export function createLinuxProcessProbe(
	read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ProcessIdentityProbe {
	return {
		host() {
			if (process.platform !== "linux")
				throw new Error(
					`process identity is unsupported on ${process.platform}; only Linux /proc is read`,
				);
			// /proc must describe this process's own PID namespace before any PID read
			// through it is evidence.
			const self = read("/proc/self/stat");
			parseProcessStat(self);
			if (Number(self.slice(0, self.indexOf(" "))) !== process.pid)
				throw new Error("/proc does not describe this process's PID namespace");
			return {
				bootId: read("/proc/sys/kernel/random/boot_id").trim(),
				pidNamespace: readlinkSync("/proc/self/ns/pid"),
			};
		},
		stat(pid) {
			let text: string;
			try {
				text = read(`/proc/${pid}/stat`);
			} catch (error) {
				const code = error instanceof Error ? errnoCode(error) : undefined;
				if (code === "ENOENT" || code === "ESRCH") return undefined;
				throw error;
			}
			return parseProcessStat(text);
		},
		terminate(pid) {
			process.kill(pid, "SIGTERM");
		},
	};
}

export const linuxProcessProbe = createLinuxProcessProbe();

/**
 * A process's environment as it was at exec. Unlike its command line, Pi's
 * process-title rewrite leaves this intact. `undefined` only when no such PID
 * exists; throws on non-Linux hosts and any other read failure.
 */
export type ProcessEnvironmentReader = (
	pid: number,
) => Map<string, string> | undefined;

export function createLinuxProcessEnvironmentReader(
	read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ProcessEnvironmentReader {
	return (pid) => {
		if (process.platform !== "linux")
			throw new Error(
				`process environment is unreadable on ${process.platform}; only Linux /proc is read`,
			);
		let text: string;
		try {
			text = read(`/proc/${pid}/environ`);
		} catch (error) {
			const code = error instanceof Error ? errnoCode(error) : undefined;
			if (code === "ENOENT" || code === "ESRCH") return undefined;
			throw error;
		}
		const environment = new Map<string, string>();
		for (const entry of text.split("\0")) {
			const separator = entry.indexOf("=");
			if (separator > 0 && !environment.has(entry.slice(0, separator)))
				environment.set(entry.slice(0, separator), entry.slice(separator + 1));
		}
		return environment;
	};
}

export const readLinuxProcessEnvironment =
	createLinuxProcessEnvironmentReader();

/** The calling process's identity; throws when this host cannot establish it. */
export function readOwnProcessIdentity(
	probe: ProcessIdentityProbe = linuxProcessProbe,
): PiProcessIdentity {
	const host = probe.host();
	const stat = probe.stat(process.pid);
	if (!stat) throw new Error("own /proc stat is missing");
	return { pid: process.pid, startTime: stat.startTime, ...host };
}

/**
 * Publish the record atomically and only once: a torn read is impossible and
 * a later writer (a reload in the same process, or any other process) never
 * replaces the first identity.
 */
export function writeProcessIdentityRecord(
	file: string,
	record: PiProcessIdentityRecord,
): void {
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, JSON.stringify(record), { flag: "wx" });
	try {
		linkSync(temporary, file);
	} catch (error) {
		if (!(error instanceof Error) || errnoCode(error) !== "EEXIST") throw error;
	} finally {
		unlinkSync(temporary);
	}
}

/** `undefined` until the child has published; throws on a malformed record. */
export function readProcessIdentityRecord(
	file: string,
): PiProcessIdentityRecord | undefined {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		if (error instanceof Error && errnoCode(error) === "ENOENT")
			return undefined;
		throw error;
	}
	let value: JsonObject | undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		if (isRecord(parsed)) value = parsed;
	} catch {
		// Malformed JSON is the same failure as a malformed record below.
	}
	if (
		!value ||
		value.version !== 1 ||
		!isString(value.id) ||
		!isString(value.sessionFile) ||
		!isFiniteNumber(value.pid) ||
		!Number.isInteger(value.pid) ||
		value.pid <= 0 ||
		!isString(value.startTime) ||
		!/^\d+$/.test(value.startTime) ||
		!isString(value.bootId) ||
		!value.bootId ||
		!isString(value.pidNamespace) ||
		!value.pidNamespace
	)
		throw new Error(`malformed process identity record ${file}`);
	return {
		version: 1,
		id: value.id,
		sessionFile: value.sessionFile,
		pid: value.pid,
		startTime: value.startTime,
		bootId: value.bootId,
		pidNamespace: value.pidNamespace,
	};
}

/**
 * Whether THAT process still exists. Only an absent PID or a zombie is exit
 * evidence; a different start time, another boot or namespace, or any read
 * failure is unknown, never guessed exited.
 */
export function judgeProcessIdentity(
	identity: PiProcessIdentity,
	probe: ProcessIdentityProbe = linuxProcessProbe,
): ProcessIdentityState {
	let stat: ProcessStat | undefined;
	try {
		const host = probe.host();
		if (host.bootId !== identity.bootId)
			return {
				kind: "unknown",
				reason: `process ${identity.pid} was recorded on another boot or host`,
			};
		if (host.pidNamespace !== identity.pidNamespace)
			return {
				kind: "unknown",
				reason: `process ${identity.pid} was recorded in another PID namespace (${identity.pidNamespace}, not ${host.pidNamespace})`,
			};
		stat = probe.stat(identity.pid);
	} catch (error) {
		return {
			kind: "unknown",
			reason: `process ${identity.pid} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!stat) return { kind: "exited" };
	if (stat.startTime !== identity.startTime)
		return {
			kind: "unknown",
			reason: `PID ${identity.pid} now names a different process (start time ${stat.startTime}, recorded ${identity.startTime})`,
		};
	if (stat.state === "Z" || stat.state === "X") return { kind: "exited" };
	return { kind: "alive" };
}

const MAX_ANCESTRY_DEPTH = 64;

/**
 * Accept a child's record only for this run and session, while it is alive in
 * this host's namespace, and only as the pane shell or a descendant of it.
 */
export function verifyProcessIdentityRecord(
	record: PiProcessIdentityRecord,
	expected: { id: string; sessionFile: string; shellPid: number },
	probe: ProcessIdentityProbe = linuxProcessProbe,
): PiProcessIdentity {
	if (record.id !== expected.id || record.sessionFile !== expected.sessionFile)
		throw new Error("process identity record belongs to another run");
	const identity: PiProcessIdentity = {
		pid: record.pid,
		startTime: record.startTime,
		bootId: record.bootId,
		pidNamespace: record.pidNamespace,
	};
	const state = judgeProcessIdentity(identity, probe);
	if (state.kind !== "alive")
		throw new Error(
			state.kind === "exited"
				? `process ${identity.pid} exited before its identity was verified`
				: state.reason,
		);
	let pid = identity.pid;
	for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
		if (pid === expected.shellPid) return identity;
		const stat = probe.stat(pid);
		if (!stat || stat.ppid <= 0) break;
		pid = stat.ppid;
	}
	throw new Error(
		`process ${identity.pid} is not the Herdr pane shell ${expected.shellPid} or its descendant`,
	);
}

/**
 * SIGTERM only the recorded identity, re-verified immediately before the
 * signal. A mismatch or unreadable state is never signalled. The kernel can
 * still reuse the PID between that read and `kill(2)`; Node exposes no pidfd
 * signal to close the window.
 */
export function terminateProcessIdentity(
	identity: PiProcessIdentity,
	probe: ProcessIdentityProbe = linuxProcessProbe,
): ProcessIdentityState {
	const state = judgeProcessIdentity(identity, probe);
	if (state.kind !== "alive") return state;
	try {
		probe.terminate(identity.pid);
	} catch (error) {
		if (error instanceof Error && errnoCode(error) === "ESRCH")
			return { kind: "exited" };
		return {
			kind: "unknown",
			reason: `SIGTERM to process ${identity.pid} failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	return state;
}
