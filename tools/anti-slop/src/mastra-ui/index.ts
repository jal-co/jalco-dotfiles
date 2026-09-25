import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Node = ESTree.Node;

const RELATIVE_TIME_FORMATTERS = new Set([
	"formatDistance",
	"formatDistanceStrict",
	"formatDistanceToNow",
	"formatDistanceToNowStrict",
	"formatRelative",
]);
const LOCALE_FORMATTERS = new Set(["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]);
const FUNCTION_TYPES = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);
const CLASS_FUNCTIONS = new Set(["cn", "clsx", "cx", "twMerge", "twJoin", "classNames"]);
const ROLE_CLASS = /(^|\s)text-(display|heading|subheading|body|body-sm|label|column|caption|meta)(?=\s|$)/;
const ROLE_OVERRIDE = /(^|\s)(leading-\S+|tracking-\S+|font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black))(?=\s|$)/;
const FONT_MONO = /(^|\s|:)font-mono(?=\s|$)/;
const LEGACY_FRAMES = new Set(["PageShell", "PageFrame", "SettingsLayout", "MainHeader", "EntityHeader"]);
const RAW_TEXT_SIZE = /(^|\s|:)text-(xs|sm|base|lg|xl|[2-9]xl)(?=\s|$)/;
const THREE_DOTS = /\.\.\.(?!\w)/;
const VAGUE_ERROR = /^\s*(Failed to|Something went wrong|Oops)\b/i;
const NON_COPY_ATTRIBUTE = /^(className|class|style|id|key|href|to|src|type|name|role|variant|size|tone|as|value|defaultValue|pattern|data-.+|aria-(controls|describedby|labelledby|owns))$/;
const LOUD_VOICE = /\bsuccessfully\b|\bplease\b|[A-Za-z0-9)]!\s*$/i;

function elementName(node: Node): string | undefined {
	if (node.type !== "JSXOpeningElement") return undefined;
	return node.name.type === "JSXIdentifier" ? node.name.name : undefined;
}

function hasAttribute(node: Node, name: string): boolean {
	if (node.type !== "JSXOpeningElement") return false;
	return node.attributes.some(
		(attribute) => attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === name,
	);
}

function attributeString(node: Node, name: string): string | undefined {
	if (node.type !== "JSXOpeningElement") return undefined;
	for (const attribute of node.attributes) {
		if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier" || attribute.name.name !== name) continue;
		if (attribute.value?.type === "Literal" && typeof attribute.value.value === "string") return attribute.value.value;
	}
	return undefined;
}

function isToastCall(node: Node | null): boolean {
	if (node?.type !== "CallExpression") return false;
	const callee = node.callee;
	if (callee.type === "Identifier") return callee.name === "toast";
	return callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "toast";
}

function isCopyAttribute(node: Node): boolean {
	if (node.type !== "JSXAttribute" || node.name.type !== "JSXIdentifier") return false;
	return !NON_COPY_ATTRIBUTE.test(node.name.name);
}

function uiText(node: Node): string | undefined {
	if (node.type === "JSXText") return node.value;
	if (node.type !== "Literal" || typeof node.value !== "string") return undefined;
	const parent = node.parent;
	if (parent?.type === "JSXAttribute") return isCopyAttribute(parent) ? node.value : undefined;
	if (parent?.type === "JSXExpressionContainer") {
		const owner = parent.parent;
		return owner?.type === "JSXAttribute" && !isCopyAttribute(owner) ? undefined : node.value;
	}
	if (isToastCall(parent) && parent?.type === "CallExpression" && parent.arguments[0] === node) return node.value;
	return undefined;
}

function classStrings(value: Node | null | undefined): string[] {
	if (!value) return [];
	if (value.type === "Literal") return typeof value.value === "string" ? [value.value] : [];
	if (value.type === "TemplateLiteral") return value.quasis.map((quasi) => quasi.value.raw);
	if (value.type === "JSXExpressionContainer") return classStrings(value.expression);
	if (value.type === "ConditionalExpression") return [...classStrings(value.consequent), ...classStrings(value.alternate)];
	if (value.type === "LogicalExpression") return classStrings(value.right);
	if (value.type === "CallExpression" && value.callee.type === "Identifier" && CLASS_FUNCTIONS.has(value.callee.name)) {
		return value.arguments.flatMap((argument) => classStrings(argument));
	}
	return [];
}

function insideJsxValue(node: Node): boolean {
	let current = node.parent;
	while (current) {
		if (current.type === "JSXExpressionContainer" || current.type === "JSXAttribute") return true;
		if (FUNCTION_TYPES.has(current.type)) return false;
		current = current.parent;
	}
	return false;
}

function insidePre(node: Node): boolean {
	let current = node.parent;
	while (current) {
		if (current.type === "JSXElement" && elementName(current.openingElement) === "pre") return true;
		current = current.parent;
	}
	return false;
}

const noRelativeTimeFormatters = defineRule({
	meta: {
		type: "problem",
		docs: { description: "Moments in time render through RelativeTimestamp, not date-fns relative formatters." },
		messages: {
			formatter:
				"`{{name}}` hand-formats a moment. Render `<RelativeTimestamp value={date} />` from `@mastra/playground-ui/components/RelativeTimestamp`, or `formatRelativeTime` from `@mastra/playground-ui/utils/relative-time` where only a string fits.",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node) {
				if (!node.source.value.startsWith("date-fns")) return;
				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;
					const name = specifier.imported.type === "Identifier" ? specifier.imported.name : String(specifier.imported.value);
					if (RELATIVE_TIME_FORMATTERS.has(name)) context.report({ node: specifier, messageId: "formatter", data: { name } });
				}
			},
		};
	},
});

const noThreeDotEllipsis = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "UI text uses the single ellipsis character, and only for shortened text." },
		messages: {
			dots: "Replace `...` in UI text. Progress reads as the -ing verb with no ellipsis (`Deploying`); shortened values use the single character `…`.",
		},
	},
	createOnce(context) {
		const check = (node: Node) => {
			const text = uiText(node);
			if (text && THREE_DOTS.test(text)) context.report({ node, messageId: "dots" });
		};
		return { JSXText: check, Literal: check };
	},
});

const noRawH1 = defineRule({
	meta: {
		type: "problem",
		docs: { description: "PageHeader is the only page title." },
		messages: { h1: "Pass the page title to `PageLayout`'s `header` slot as `<PageHeader>`. It renders the page's only `h1`." },
	},
	createOnce(context) {
		return {
			JSXOpeningElement(node) {
				if (elementName(node) === "h1") context.report({ node, messageId: "h1" });
			},
		};
	},
});

const noStatusBadge = defineRule({
	meta: {
		type: "problem",
		docs: { description: "Entity and run state renders as Status, never as a Badge." },
		messages: { badge: "A `Badge` with an `indicator` is showing state. Use `Status` from `@mastra/playground-ui/components/StatusIndicators`." },
	},
	createOnce(context) {
		return {
			JSXOpeningElement(node) {
				if (elementName(node) === "Badge" && hasAttribute(node, "indicator")) context.report({ node, messageId: "badge" });
			},
		};
	},
});

const couldntErrors = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Error copy starts with Couldn’t plus the action." },
		messages: {
			error: "Start error copy with `Couldn’t {action}`, then the cause and the next step when known (`Couldn’t load agents`). Never `Failed to`, `Something went wrong`, or `Oops`.",
		},
	},
	createOnce(context) {
		const check = (node: Node) => {
			const text = uiText(node);
			if (text && VAGUE_ERROR.test(text)) context.report({ node, messageId: "error" });
		};
		return { JSXText: check, Literal: check };
	},
});

const calmVoice = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "UI copy is calm: no successfully, please, or exclamation marks." },
		messages: {
			voice: "Drop `successfully`, `please`, and exclamation marks. Toasts use the past tense alone (`Key created`); requests use the verb alone.",
		},
	},
	createOnce(context) {
		const check = (node: Node) => {
			const text = uiText(node);
			if (text && LOUD_VOICE.test(text)) context.report({ node, messageId: "voice" });
		};
		return { JSXText: check, Literal: check };
	},
});

const textByRole = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Text picks a role through Txt, never a raw size class." },
		messages: {
			size: "`{{size}}` picks text by size. Use `<Txt variant=…>` for the text's role; the role carries size, line-height, weight, and tracking together.",
			override: "`{{name}}` overrides the text role next to it. The role already sets line-height, weight, and tracking; pick a different role instead.",
		},
	},
	createOnce(context) {
		return {
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier" || node.name.name !== "className") return;
				const opening = node.parent;
				const name = opening ? elementName(opening) : undefined;
				const plain = name !== undefined && name[0] === name[0].toLowerCase();
				for (const value of classStrings(node.value)) {
					const size = plain ? RAW_TEXT_SIZE.exec(value) : null;
					if (size) {
						context.report({ node, messageId: "size", data: { size: `text-${size[2]}` } });
						return;
					}
					const override = ROLE_CLASS.test(value) ? ROLE_OVERRIDE.exec(value) : null;
					if (override) {
						context.report({ node, messageId: "override", data: { name: override[2] } });
						return;
					}
				}
			},
		};
	},
});

const noLocaleFormatInJsx = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Dates and numbers render through RelativeTimestamp and CompactNumber, not toLocale*String." },
		messages: {
			locale: "`{{name}}()` hand-formats a value in the UI. Moments use `<RelativeTimestamp value={date} />`; quantities use `<CompactNumber value={n} />`.",
		},
	},
	createOnce(context) {
		return {
			CallExpression(node) {
				const callee = node.callee;
				if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
				if (!LOCALE_FORMATTERS.has(callee.property.name) || !insideJsxValue(node)) return;
				context.report({ node, messageId: "locale", data: { name: callee.property.name } });
			},
		};
	},
});

const inlineCode = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Code inside prose is InlineCode." },
		messages: { code: "Use `<InlineCode>` from `@mastra/playground-ui/components/InlineCode` for code inside text. Keep `<code>` only inside `<pre>`." },
	},
	createOnce(context) {
		return {
			JSXElement(node) {
				if (elementName(node.openingElement) !== "code" || insidePre(node)) return;
				context.report({ node: node.openingElement, messageId: "code" });
			},
		};
	},
});

const noLegacyPageFrame = defineRule({
	meta: {
		type: "problem",
		docs: { description: "Pages use playground-ui PageLayout, not the legacy PageShell or PageFrame." },
		messages: {
			frame: "`{{name}}` is a legacy page frame or header. Render playground-ui `PageLayout` with `PageHeader` in its `header` slot (`narrow` for settings).",
		},
	},
	createOnce(context) {
		return {
			ImportDeclaration(node) {
				for (const specifier of node.specifiers) {
					const name = specifier.local.name;
					if (LEGACY_FRAMES.has(name)) context.report({ node: specifier, messageId: "frame", data: { name } });
				}
			},
		};
	},
});

const noNumberInput = defineRule({
	meta: {
		type: "problem",
		docs: { description: "No browser number spinners." },
		messages: {
			number: "Drop `type=\"number\"`. For incrementing, compose `InputGroup` with minus and plus `InputGroupButton`s; otherwise use a text input with `inputMode=\"numeric\"`.",
		},
	},
	createOnce(context) {
		return {
			JSXOpeningElement(node) {
				const name = elementName(node);
				if (name !== "input" && name !== "Input" && name !== "InputGroupInput") return;
				if (attributeString(node, "type") === "number") context.report({ node, messageId: "number" });
			},
		};
	},
});

const noFontMono = defineRule({
	meta: {
		type: "suggestion",
		docs: { description: "Mono comes from the design system, never the font-mono class." },
		messages: {
			mono: "Drop `font-mono`. Identifiers, absolute times, and durations use `<Txt font=\"mono\">`; moments use `RelativeTimestamp`; code uses `InlineCode` or `CodeBlock`. Everything else is the body face.",
		},
	},
	createOnce(context) {
		return {
			JSXAttribute(node) {
				if (node.name.type !== "JSXIdentifier" || node.name.name !== "className") return;
				if (classStrings(node.value).some((value) => FONT_MONO.test(value))) context.report({ node, messageId: "mono" });
			},
		};
	},
});

const mastraUiPlugin = eslintCompatPlugin({
	meta: { name: "mastra-ui" },
	rules: {
		"no-relative-time-formatters": noRelativeTimeFormatters,
		"no-three-dot-ellipsis": noThreeDotEllipsis,
		"no-raw-h1": noRawH1,
		"no-status-badge": noStatusBadge,
		"couldnt-errors": couldntErrors,
		"calm-voice": calmVoice,
		"text-by-role": textByRole,
		"no-locale-format-in-jsx": noLocaleFormatInJsx,
		"inline-code": inlineCode,
		"no-legacy-page-frame": noLegacyPageFrame,
		"no-number-input": noNumberInput,
		"no-font-mono": noFontMono,
	},
});

export default mastraUiPlugin;
