const MASK = "[redacted]";

const SENSITIVE_PATH = /(^|[/\s"'=])(\.env\b|\.envrc|\.npmrc|\.netrc|\.pgpass|\.ssh\b|\.aws\b|\.gnupg\b|\.config\/(mastra-observability|boat-offload|gh|op)|id_(rsa|ed25519|ecdsa)|[\w.-]+\.(pem|key|p12|pfx)\b|credentials(\.json)?\b|secrets?\.(json|ya?ml|env)\b|auth\.json)/i;

const PATTERNS: [RegExp, string][] = [
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, MASK],
	[/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, MASK],
	[/\b(sk|pk|rk)[-_](live|test|ant|proj|w|or|svcacct)?[-_]?[A-Za-z0-9_-]{16,}/g, MASK],
	[/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,}|shpat_[A-Za-z0-9]{16,})/g, MASK],
	[/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MASK],
	[/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
	[/\bAIza[A-Za-z0-9_-]{30,}/g, MASK],
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${MASK}`],
	[/(["']?[\w.-]*(secret|token|passw(or)?d|passwd|api[_-]?key|private[_-]?key|credential|auth(orization)?)[\w.-]*["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;&}]+)/gi, `$1${MASK}`],
	[/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, MASK],
	[/(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{40,}/g, MASK],
];

export function redact(text: string): string {
	return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export function touchesSensitivePath(text: string): boolean {
	return SENSITIVE_PATH.test(text);
}

export const SENSITIVE_OUTPUT = "[redacted: output of a sensitive path]";
