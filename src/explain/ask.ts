import "server-only";

import { AiError, generateObject, generateText } from "@/ai/client";
import { isClassifiableRole, type ClassifiableRole } from "@/parser/taxonomy";
import { CLASSIFY_SCHEMA, classifies, filePrompt, folderPrompt, type FileSubject, type FolderSubject } from "./prompts";

// Asking the model, given a subject and nothing else: no database, no
// GitHub, no cache. The app calls these from explain(); the evals call the
// same functions, so what's measured is what ships.

export interface Answer {
  body: string;
  role: ClassifiableRole | null;
  rationale: string | null;
}

/** Explains a file from its neighbours and source, classifying it when no adapter could. */
export async function askAboutFile(subject: FileSubject, source: string | null): Promise<Answer> {
  const prompt = filePrompt(subject, source);

  if (!classifies(subject)) return { body: await generateText(prompt), role: null, rationale: null };

  const answer = await generateObject(prompt, CLASSIFY_SCHEMA, "explain_and_classify");
  const body = typeof answer.explanation === "string" ? answer.explanation.trim() : "";
  if (!body) throw new AiError("The model returned an empty answer.", "empty");
  // The schema already limits the role to the list; this is the check that
  // doesn't depend on the model obeying it. Anything else is dropped.
  const role = isClassifiableRole(answer.role) ? answer.role : null;
  if (!role) console.warn(`[explain] discarded role ${JSON.stringify(answer.role)} for ${subject.path}: not a classifiable role`);
  const rationale = role && typeof answer.rationale === "string" && answer.rationale.trim() ? answer.rationale.trim() : null;
  return { body, role, rationale };
}

export async function askAboutFolder(subject: FolderSubject, repoName: string): Promise<Answer> {
  return { body: await generateText(folderPrompt(subject, repoName)), role: null, rationale: null };
}
