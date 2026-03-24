import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardState } from '../lib/state.js';

function createApiStub() {
  return {
    config: {
      agents: {
        list: [
          { id: 'alpha', name: 'Alpha' },
          { id: 'beta', name: 'Beta' },
        ],
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    runtime: {
      events: {
        onAgentEvent() {
          return () => {};
        },
        onSessionTranscriptUpdate() {
          return () => {};
        },
      },
    },
  };
}

test('snapshot includes configured agents and waiting statuses', () => {
  const state = createDashboardState({ api: createApiStub() });
  const snapshot = state.getSnapshot();
  const existing = snapshot.messages.find((message) => message.type === 'existingAgents');
  assert.ok(existing);
  assert.equal(existing.agents.length, 2);
  assert.ok(
    snapshot.messages.some((message) => message.type === 'agentStatus' && message.status === 'waiting'),
  );
});

test('lifecycle and tool events drive active and waiting messages', () => {
  const state = createDashboardState({ api: createApiStub() });
  const events = [];
  const unsubscribe = state.subscribe((message) => events.push(message));

  state._private.handleAgentEvent({
    runId: 'run-1',
    seq: 1,
    ts: Date.now(),
    stream: 'lifecycle',
    sessionKey: 'agent:alpha:main',
    data: { phase: 'start' },
  });
  state._private.handleAgentEvent({
    runId: 'run-1',
    seq: 2,
    ts: Date.now(),
    stream: 'tool',
    sessionKey: 'agent:alpha:main',
    data: {
      phase: 'start',
      name: 'read',
      toolCallId: 'tool-1',
      args: { path: '/tmp/file.txt' },
    },
  });
  state._private.handleAgentEvent({
    runId: 'run-1',
    seq: 3,
    ts: Date.now(),
    stream: 'tool',
    sessionKey: 'agent:alpha:main',
    data: {
      phase: 'result',
      name: 'read',
      toolCallId: 'tool-1',
    },
  });
  state._private.handleAgentEvent({
    runId: 'run-1',
    seq: 4,
    ts: Date.now(),
    stream: 'lifecycle',
    sessionKey: 'agent:alpha:main',
    data: { phase: 'end' },
  });

  unsubscribe();

  assert.ok(events.some((message) => message.type === 'agentToolStart'));
  assert.ok(events.some((message) => message.type === 'agentToolDone'));
  assert.ok(events.some((message) => message.type === 'agentToolsClear'));
  assert.ok(events.some((message) => message.type === 'agentStatus' && message.status === 'waiting'));
});

test('transcript fallback marks agent active temporarily', async () => {
  const state = createDashboardState({
    api: createApiStub(),
    transcriptActivityWindowMs: 20,
  });
  const events = [];
  const unsubscribe = state.subscribe((message) => events.push(message));

  state._private.handleTranscriptUpdate({
    sessionKey: 'agent:beta:main',
    sessionFile: '/home/user/.openclaw/agents/beta/sessions/main.jsonl',
  });

  await new Promise((resolve) => setTimeout(resolve, 30));
  unsubscribe();

  assert.ok(events.some((message) => message.type === 'agentToolStart' && message.status === 'Working'));
  assert.ok(events.some((message) => message.type === 'agentToolsClear'));
  assert.ok(events.some((message) => message.type === 'agentStatus' && message.status === 'waiting'));
});
