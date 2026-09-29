import assert from "node:assert/strict";
import test from "node:test";

import { startMockGateway } from "../tools/mock-gateway.mjs";

test("startMockGateway: models + chat + Anthropic + Responses + HEAD preflight", async (t) => {
  const mock = await startMockGateway({ port: 0, quiet: true });
  t.after(() => mock.close());

  const models = await fetch(`${mock.baseUrl}/models`, { headers: { authorization: "Bearer k" } });
  assert.equal(models.status, 200);
  const list = await models.json();
  assert.ok(Array.isArray(list.data) && list.data.length >= 3);

  const head = await fetch(`${mock.baseUrl}/messages`, { method: "HEAD" });
  assert.equal(head.status, 204, "preflight /v1/messages");

  const chat = await fetch(`${mock.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: "Bearer k", "content-type": "application/json" },
    body: JSON.stringify({ model: "crizon/gpt-standard", messages: [{ role: "user", content: "ping" }] }),
  });
  assert.equal(chat.status, 200);
  const completion = await chat.json();
  assert.equal(completion.object, "chat.completion");

  const anthropic = await fetch(`${mock.baseUrl}/messages`, {
    method: "POST",
    headers: { "x-api-key": "k", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-x", messages: [{ role: "user", content: "ping" }] }),
  });
  assert.equal((await anthropic.json()).type, "message");

  const responses = await fetch(`${mock.baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: "Bearer k", "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-x", input: "ping" }),
  });
  assert.equal((await responses.json()).object, "response");

  const unauthorized = await fetch(`${mock.baseUrl}/models`);
  assert.equal(unauthorized.status, 401);
});
