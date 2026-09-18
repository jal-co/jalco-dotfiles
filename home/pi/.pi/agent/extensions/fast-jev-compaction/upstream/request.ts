import { Type } from 'typebox';
import { Parse } from 'typebox/value';
import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';

const noulAnswerSchema = Type.Object({
  type: Type.Optional(Type.Literal('noul')),
  noul: Type.Number(),
});

const choiceAnswerSchema = Type.Object({
  type: Type.Optional(Type.Literal('choice')),
  choice: Type.String(),
  confidence: Type.Number(),
  probabilities: Type.Record(Type.String(), Type.Number()),
});

const scoreAnswerSchema = Type.Object({
  type: Type.Optional(Type.Literal('score')),
  score: Type.Number(),
  confidence: Type.Number(),
  probabilities: Type.Record(Type.String(), Type.Number()),
});

const responseSchema = Type.Object({
  model: Type.Optional(Type.String()),
  answers: Type.Record(Type.String(), Type.Union([noulAnswerSchema, choiceAnswerSchema, scoreAnswerSchema])),
  usage: Type.Optional(Type.Object({
    input_tokens: Type.Optional(Type.Number()),
    output_tokens: Type.Optional(Type.Number()),
  })),
});

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export function buildJevRequest(
  params: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  },
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  return {
    url: params.baseUrl ?? SYSTEM_ONE_URL,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_MODEL,
      state,
      questions,
    }),
  };
}

export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    throw new Error(`Jev request failed (${status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jev returned malformed JSON');
  }
  try {
    return Parse(responseSchema, parsed);
  } catch {
    throw new Error('Jev response is missing answers');
  }
}

export function noulAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): number {
  const answer = answers[name];
  if (!answer || !('noul' in answer) || !Number.isFinite(answer.noul)) {
    throw new Error(`Invalid Jev answer for ${name}`);
  }
  return answer.noul;
}
