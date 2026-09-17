import { Type, type Static } from "typebox";

const textRequestSchema = Type.Object({
	goal: Type.String(),
	field: Type.Object({
		label: Type.Optional(Type.String()),
		role: Type.Optional(Type.String()),
		value: Type.Optional(Type.String()),
	}),
	page: Type.Object({ title: Type.String(), text: Type.String() }),
	recent_actions: Type.Array(
		Type.Object({
			action: Type.Optional(Type.String()),
			text: Type.Optional(Type.String()),
		}),
	),
});

export const jevResultSchema = Type.Object({
	status: Type.Union([
		Type.Literal("ready"),
		Type.Literal("needs_text"),
		Type.Literal("done"),
		Type.Literal("blocked"),
	]),
	text_request: Type.Optional(textRequestSchema),
});

const runDataSchema = Type.Object({
	run_id: Type.String(),
	result: jevResultSchema,
});

const stopDataSchema = Type.Object({
	run_id: Type.String(),
	stopped: Type.Boolean(),
});

const shutdownDataSchema = Type.Object({ shutdown: Type.Literal(true) });

export const serverResponseSchema = Type.Union([
	Type.Object({ ok: Type.Literal(true), data: Type.Union([runDataSchema, stopDataSchema, shutdownDataSchema]) }),
	Type.Object({ ok: Type.Literal(false), error: Type.String() }),
]);

export type JevResult = Static<typeof jevResultSchema>;
export type ServerResponse = Static<typeof serverResponseSchema>;
export type ServerData = Extract<ServerResponse, { ok: true }>["data"];

export type ServerRequest =
	| {
			action: "start";
			goal: string;
			run_id?: string;
			session: string;
			url?: string;
			restore: boolean;
	  }
	| { action: "continue"; run_id: string; text: string }
	| { action: "stop"; run_id: string; close_browser: boolean }
	| { action: "shutdown" };
