import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { expandCommand, loadCustomCommands, parseCommandFile, tokenizeArgs } from "../src/custom-commands.mjs";

test("parseCommandFile: tách frontmatter + giữ body", () => {
  const { meta, body } = parseCommandFile("---\ndescription: Chạy test\nmodel: crizon/gpt-standard\n---\n\nChạy test $ARGUMENTS\n");
  assert.equal(meta.description, "Chạy test");
  assert.equal(meta.model, "crizon/gpt-standard");
  assert.equal(body, "Chạy test $ARGUMENTS");
  const plain = parseCommandFile("Không frontmatter");
  assert.deepEqual(plain.meta, {});
  assert.equal(plain.body, "Không frontmatter");
});

test("tokenizeArgs: hỗ trợ quote đơn/đôi + escaped quote", () => {
  assert.deepEqual(tokenizeArgs('a "b c" \'d\' e'), ["a", "b c", "d", "e"]);
  assert.deepEqual(tokenizeArgs('src "{ \\"key\\": \\"value\\" }"'), ["src", '{ "key": "value" }']);
});

test("loadCustomCommands: config JSON + global (OPENCODE_CONFIG_DIR) + project (.opencode/commands)", () => {
  const dir = mkdtempSync(join(tmpdir(), "crizon-cmd-"));
  const globalDir = join(dir, "global", "commands");
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(join(globalDir, "global.md"), "---\ndescription: Lệnh global\n---\nGlobal $ARGUMENTS");
  const cwd = join(dir, "project");
  const projectDir = join(cwd, ".opencode", "commands");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "test.md"), "---\ndescription: Chạy test\nmodel: crizon/x\n---\nRun $1");

  const env = { ...process.env, OPENCODE_CONFIG_DIR: join(dir, "global"), CRIZON_HOME: join(dir, "home") };
  const commands = loadCustomCommands({ env, cwd, configCommands: { cfg: { template: "Cfg $ARGUMENTS", description: "Từ config" } } });
  assert.deepEqual(commands.map((command) => command.name), ["cfg", "global", "test"]);
  const testCommand = commands.find((command) => command.name === "test");
  assert.equal(testCommand.model, "crizon/x");
  assert.equal(testCommand.description, "Chạy test");
  assert.equal(commands.find((command) => command.name === "cfg").scope, "config");
});

test("loadCustomCommands: project (.crizon) đè global", () => {
  const dir = mkdtempSync(join(tmpdir(), "crizon-cmd-"));
  const globalDir = join(dir, "global", "commands");
  mkdirSync(globalDir, { recursive: true });
  writeFileSync(join(globalDir, "build.md"), "---\ndescription: Global build\n---\nglobal");
  const cwd = join(dir, "project");
  const localDir = join(cwd, ".crizon", "commands");
  mkdirSync(localDir, { recursive: true });
  writeFileSync(join(localDir, "build.md"), "---\ndescription: Project build\n---\nproject");

  const env = { ...process.env, OPENCODE_CONFIG_DIR: join(dir, "global"), CRIZON_HOME: join(dir, "home") };
  const commands = loadCustomCommands({ env, cwd });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].description, "Project build");
  assert.equal(commands[0].template, "project");
});

test("expandCommand: $ARGUMENTS, $1..$n, !shell, @file", () => {
  const dir = mkdtempSync(join(tmpdir(), "crizon-cmd-"));
  writeFileSync(join(dir, "note.txt"), "NỘI DUNG FILE");
  const out = expandCommand(
    { template: "A $ARGUMENTS | $1 & $2\n!`echo hi`\n@note.txt" },
    "one two",
    { cwd: dir, exec: () => "hi" },
  );
  assert.ok(out.includes("A one two | one & two"), out);
  assert.ok(out.includes("hi"));
  assert.ok(out.includes("NỘI DUNG FILE"));
});

test("expandCommand: @file không tồn tại thì giữ nguyên chuỗi", () => {
  const dir = mkdtempSync(join(tmpdir(), "crizon-cmd-"));
  const out = expandCommand({ template: "Xem @khong-co.txt đi" }, "", { cwd: dir, exec: () => "" });
  assert.ok(out.includes("@khong-co.txt"));
});
