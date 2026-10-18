import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CLASSIFIABLE_ROLES, FRAMEWORKS, ROLES } from "../parser/taxonomy";
import { CLASSIFY_SCHEMA, classifies, filePrompt, folderPrompt, handedPaths, MAX_SOURCE_CHARS, type FileSubject, type FolderSubject } from "./prompts";

const file = (role: FileSubject["role"]): FileSubject => ({
  kind: "file",
  path: "src/lib/db.ts",
  language: "ts",
  lineCount: 40,
  hash: "0".repeat(64),
  role,
  imports: [{ path: "src/lib/env.ts", role: "config", typeOnly: false }],
  importedBy: [
    { path: "src/users/service.ts", role: "service", typeOnly: false },
    { path: "src/types.ts", role: "other", typeOnly: true },
  ],
});

describe("classification", () => {
  // Every role that decides the route table or the entry-point colouring.
  const structural = ["page", "api", "route", "controller", "resolver", "gateway", "layout", "route-ui", "metadata", "proxy", "middleware", "entry", "server-action", "instrumentation"];

  test("can never answer with a structural role", () => {
    for (const role of structural) {
      assert.ok(!(CLASSIFIABLE_ROLES as readonly string[]).includes(role), `${role} is classifiable`);
      assert.ok(!(CLASSIFY_SCHEMA.properties.role.enum as readonly string[]).includes(role), `${role} is in the schema`);
    }
    assert.deepEqual([...CLASSIFY_SCHEMA.properties.role.enum], ["service", "repository", "model", "util", "config", "component", "hook"]);
  });

  test("every classifiable role has a name and colour on the rail", () => {
    for (const role of CLASSIFIABLE_ROLES) assert.ok(ROLES[role].name);
  });

  test("only files no adapter identified are classified", () => {
    assert.equal(classifies(file("other")), true);
    assert.equal(classifies(file("source")), true);
    assert.equal(classifies(file("service")), false);
    for (const framework of Object.values(FRAMEWORKS)) {
      assert.ok(!framework.roles.includes("util"), "util is only ever a model's answer");
    }
  });
});

describe("what the model is handed", () => {
  test("a file prompt lists every neighbour, and those are the only paths", () => {
    const subject = file("source");
    const prompt = filePrompt(subject, "export const db = 1;");
    for (const path of handedPaths(subject)) assert.ok(prompt.user.includes(path), path);
    assert.match(prompt.user, /src\/types\.ts \(unidentified, types only\)/);
    assert.match(prompt.system, /only from this list/);
    assert.doesNotMatch(filePrompt(file("service"), null).system, /only from this list/);
  });

  test("a long source is cut, and the cut is stated", () => {
    const prompt = filePrompt(file("service"), "x".repeat(MAX_SOURCE_CHARS + 10));
    assert.match(prompt.user, /the rest was cut/);
    assert.ok(prompt.user.length < MAX_SOURCE_CHARS + 2000);
  });

  test("a folder prompt is about the folder and what points at it", () => {
    const subject: FolderSubject = {
      kind: "folder",
      dir: "src/lib",
      merged: ["src/lib/http"],
      members: [{ path: "src/lib/db.ts", role: "other", lineCount: 40, hash: "", importedFromOutside: 3 }],
      importedBy: [{ dir: "src/users", files: 3, members: ["src/lib/db.ts"] }],
      imports: [],
    };
    const prompt = folderPrompt(subject, "repo");
    assert.match(prompt.system, /folder as a whole/);
    assert.match(prompt.user, /src\/users: 3 files there import src\/lib\/db\.ts/);
    assert.deepEqual(handedPaths(subject), ["src/lib", "src/lib/http", "src/lib/db.ts", "src/users"]);
  });
});
