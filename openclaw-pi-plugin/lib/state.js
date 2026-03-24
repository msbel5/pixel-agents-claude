import path from 'node:path';

import {
  ACTIVE_STATUS,
  ASSISTANT_TOOL_STATUS,
  FALLBACK_TOOL_STATUS,
  MAX_TOOL_STATUS_COMMAND_CHARS,
  TRANSCRIPT_ACTIVITY_WINDOW_MS,
  WAITING_STATUS,
} from './constants.js';

function clampCommandPreview(value) {
  if (value.length <= MAX_TOOL_STATUS_COMMAND_CHARS) return value;
  return `${value.slice(0, MAX_TOOL_STATUS_COMMAND_CHARS)}...`;
}

function basenameFromArgs(record) {
  const rawPath =
    typeof record.path === 'string'
      ? record.path
      : typeof record.file_path === 'string'
        ? record.file_path
        : typeof record.target === 'string'
          ? record.target
          : '';
  return rawPath ? path.basename(rawPath) : '';
}

function normalizeToolName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function formatToolStatus(name, args) {
  const normalized = normalizeToolName(name);
  const record = args && typeof args === 'object' ? args : {};
  const baseName = basenameFromArgs(record);

  switch (normalized) {
    case 'read':
      return baseName ? `Reading ${baseName}` : 'Reading files';
    case 'write':
      return baseName ? `Writing ${baseName}` : 'Writing files';
    case 'edit':
    case 'patch':
    case 'update':
      return baseName ? `Editing ${baseName}` : 'Editing files';
    case 'grep':
    case 'search':
      return 'Searching code';
    case 'glob':
    case 'find':
    case 'list':
      return 'Searching files';
    case 'bash':
    case 'exec':
    case 'system.run': {
      const command =
        typeof record.command === 'string'
          ? record.command
          : typeof record.cmd === 'string'
            ? record.cmd
            : '';
      return command ? `Running: ${clampCommandPreview(command)}` : 'Running command';
    }
    case 'sessions_send':
    case 'message':
      return 'Sending message';
    case 'subagents':
    case 'agent':
    case 'task':
      return 'Running subtask';
    case 'browser':
    case 'browser_open':
    case 'browser.snapshot':
    case 'browser.action':
      return 'Browsing';
    case 'web_search':
      return 'Searching the web';
    case 'web_fetch':
    case 'fetch':
      return 'Fetching web content';
    default:
      return normalized ? `Using ${normalized}` : 'Working';
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickAppearance(key) {
  const hash = hashString(key);
  return {
    palette: hash % 6,
    hueShift: Math.floor(hash / 6) % 180,
  };
}

function resolveStableNumericId(key, existingIds) {
  let candidate = (hashString(key) % 2147483000) + 1;
  while (existingIds.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

function normalizeConfiguredAgents(config) {
  const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
  const entries = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!rawId) continue;
    const workspace =
      typeof entry.workspace === 'string' && entry.workspace.trim()
        ? entry.workspace.trim()
        : undefined;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined;
    entries.push({
      id: rawId,
      label: name || (workspace ? path.basename(workspace) : rawId),
    });
  }

  if (entries.length === 0) {
    entries.push({ id: 'main', label: 'main' });
  }

  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

function resolveSessionKeyFromTranscript(update) {
  if (typeof update.sessionKey === 'string' && update.sessionKey.trim()) {
    return update.sessionKey.trim();
  }
  if (typeof update.sessionFile !== 'string' || !update.sessionFile.trim()) return null;
  const normalized = update.sessionFile.replace(/\\/g, '/');
  const marker = '/agents/';
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return null;
  const segments = normalized.slice(markerIndex + marker.length).split('/');
  if (segments.length < 3) return null;
  const agentId = segments[0];
  const sessionId = path.basename(segments[2], '.jsonl');
  return agentId && sessionId ? `agent:${agentId}:${sessionId}` : null;
}

function resolveAgentIdFromSessionKeySafe(sessionKey) {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) return 'main';
  const normalized = sessionKey.trim();
  if (!normalized.startsWith('agent:')) return 'main';
  const [, rawAgentId] = normalized.split(':', 3);
  return rawAgentId?.trim() || 'main';
}

function resolveAgentKeyForEvent(event) {
  if (typeof event.sessionKey === 'string' && event.sessionKey.trim()) {
    return resolveAgentIdFromSessionKeySafe(event.sessionKey.trim());
  }
  return 'main';
}

function createRunState(runId, sessionKey, rawAgentId) {
  return {
    runId,
    sessionKey,
    rawAgentId,
    toolIds: new Set(),
    syntheticAssistantToolId: null,
  };
}

export function createDashboardState({ api, transcriptActivityWindowMs = TRANSCRIPT_ACTIVITY_WINDOW_MS }) {
  const listeners = new Set();
  const agents = new Map();
  const runs = new Map();
  const subscriptions = [];
  const usedIds = new Set();
  let currentConfig = api.config;

  function broadcast(message) {
    for (const listener of listeners) {
      listener(message);
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function ensureAgent(rawId, label) {
    const existing = agents.get(rawId);
    if (existing) {
      if (label) existing.label = label;
      return existing;
    }

    const id = resolveStableNumericId(rawId, usedIds);
    usedIds.add(id);
    const appearance = pickAppearance(rawId);
    const agent = {
      rawId,
      id,
      label: label || rawId,
      palette: appearance.palette,
      hueShift: appearance.hueShift,
      status: WAITING_STATUS,
      activeTools: new Map(),
      hasVisibleToolHistory: false,
      fallbackTimer: null,
      fallbackToolId: null,
    };
    agents.set(rawId, agent);
    broadcast({
      type: 'agentCreated',
      id: agent.id,
      folderName: agent.label,
      palette: agent.palette,
      hueShift: agent.hueShift,
    });
    return agent;
  }

  function setAgentStatus(agent, status, force = false) {
    if (!force && agent.status === status) return;
    agent.status = status;
    broadcast({
      type: 'agentStatus',
      id: agent.id,
      status,
    });
  }

  function clearFallback(agent) {
    if (agent.fallbackTimer) {
      clearTimeout(agent.fallbackTimer);
      agent.fallbackTimer = null;
    }
    if (!agent.fallbackToolId) return;
    if (agent.activeTools.has(agent.fallbackToolId)) {
      clearAgentTools(agent);
    }
    agent.fallbackToolId = null;
  }

  function clearAgentTools(agent) {
    agent.activeTools.clear();
    if (agent.hasVisibleToolHistory) {
      broadcast({ type: 'agentToolsClear', id: agent.id });
      agent.hasVisibleToolHistory = false;
    }
  }

  function scheduleTranscriptFallback(agent) {
    if (agent.fallbackTimer) {
      clearTimeout(agent.fallbackTimer);
    }
    agent.fallbackTimer = setTimeout(() => {
      agent.fallbackTimer = null;
      if (agent.activeTools.size > 0 && agent.fallbackToolId) {
        clearAgentTools(agent);
      }
      agent.fallbackToolId = null;
      setAgentStatus(agent, WAITING_STATUS);
    }, transcriptActivityWindowMs);
    agent.fallbackTimer.unref?.();
  }

  function addActiveTool(agent, toolId, status) {
    agent.activeTools.set(toolId, { toolId, status });
    agent.hasVisibleToolHistory = true;
    broadcast({
      type: 'agentToolStart',
      id: agent.id,
      toolId,
      status,
    });
  }

  function markToolDone(agent, toolId) {
    if (!agent.activeTools.has(toolId)) return;
    agent.activeTools.delete(toolId);
    broadcast({
      type: 'agentToolDone',
      id: agent.id,
      toolId,
    });
  }

  function getOrCreateRun(runId, sessionKey, rawAgentId) {
    const existing = runs.get(runId);
    if (existing) {
      if (sessionKey) existing.sessionKey = sessionKey;
      if (rawAgentId) existing.rawAgentId = rawAgentId;
      return existing;
    }
    const run = createRunState(runId, sessionKey, rawAgentId);
    runs.set(runId, run);
    return run;
  }

  function markAssistantActivity(agent, run) {
    if (run.toolIds.size > 0 || run.syntheticAssistantToolId) return;
    const toolId = `assistant:${run.runId}`;
    run.syntheticAssistantToolId = toolId;
    addActiveTool(agent, toolId, ASSISTANT_TOOL_STATUS);
  }

  function handleLifecycleEvent(agent, run, event) {
    const phase = event.data?.phase;
    if (phase === 'start') {
      clearFallback(agent);
      setAgentStatus(agent, ACTIVE_STATUS);
      return;
    }
    if (phase !== 'end' && phase !== 'error') {
      return;
    }

    if (run.syntheticAssistantToolId) {
      markToolDone(agent, run.syntheticAssistantToolId);
      run.syntheticAssistantToolId = null;
    }

    for (const toolId of run.toolIds) {
      markToolDone(agent, toolId);
    }
    run.toolIds.clear();
    runs.delete(run.runId);

    if (Array.from(runs.values()).some((candidate) => candidate.rawAgentId === agent.rawId)) {
      setAgentStatus(agent, ACTIVE_STATUS);
      return;
    }

    clearAgentTools(agent);
    setAgentStatus(agent, WAITING_STATUS);
  }

  function handleToolEvent(agent, run, event) {
    const phase = event.data?.phase;
    const rawToolName =
      typeof event.data?.name === 'string'
        ? event.data.name
        : typeof event.data?.toolName === 'string'
          ? event.data.toolName
          : '';
    const toolCallId =
      typeof event.data?.toolCallId === 'string'
        ? event.data.toolCallId
        : `${rawToolName || 'tool'}:${event.seq}`;
    const scopedToolId = `${run.runId}:${toolCallId}`;

    if (phase === 'start') {
      clearFallback(agent);
      setAgentStatus(agent, ACTIVE_STATUS);
      if (run.syntheticAssistantToolId) {
        markToolDone(agent, run.syntheticAssistantToolId);
        run.syntheticAssistantToolId = null;
      }
      run.toolIds.add(scopedToolId);
      addActiveTool(agent, scopedToolId, formatToolStatus(rawToolName, event.data?.args));
      return;
    }

    if (phase === 'result') {
      run.toolIds.delete(scopedToolId);
      markToolDone(agent, scopedToolId);
    }
  }

  function handleAssistantEvent(agent, run) {
    clearFallback(agent);
    setAgentStatus(agent, ACTIVE_STATUS);
    markAssistantActivity(agent, run);
  }

  function handleAgentEvent(event) {
    const rawId = resolveAgentKeyForEvent(event);
    const agent = ensureAgent(rawId);
    const run = getOrCreateRun(event.runId, event.sessionKey, rawId);

    if (event.stream === 'lifecycle') {
      handleLifecycleEvent(agent, run, event);
      return;
    }

    if (event.stream === 'tool') {
      handleToolEvent(agent, run, event);
      return;
    }

    if (event.stream === 'assistant') {
      handleAssistantEvent(agent, run);
    }
  }

  function handleTranscriptUpdate(update) {
    const sessionKey = resolveSessionKeyFromTranscript(update);
    if (!sessionKey) return;
    const rawId = resolveAgentIdFromSessionKeySafe(sessionKey);
    const agent = ensureAgent(rawId);
    if (Array.from(runs.values()).some((candidate) => candidate.sessionKey === sessionKey)) {
      return;
    }
    setAgentStatus(agent, ACTIVE_STATUS);
    if (!agent.fallbackToolId) {
      agent.fallbackToolId = `transcript:${agent.id}`;
      addActiveTool(agent, agent.fallbackToolId, FALLBACK_TOOL_STATUS);
    }
    scheduleTranscriptFallback(agent);
  }

  function refreshConfiguredAgents(config) {
    currentConfig = config;
    const entries = normalizeConfiguredAgents(config);
    for (const entry of entries) {
      ensureAgent(entry.id, entry.label);
    }
  }

  function getBootstrap() {
    return {
      kind: 'openclaw.pixel-agents',
      mode: 'live',
      readOnly: true,
      snapshotUrl: './api/snapshot',
      eventsUrl: './api/events',
      generatedAt: Date.now(),
    };
  }

  function getSnapshot() {
    const sortedAgents = Array.from(agents.values()).sort((left, right) => left.id - right.id);
    const agentMeta = {};
    const folderNames = {};
    for (const agent of sortedAgents) {
      agentMeta[agent.id] = {
        palette: agent.palette,
        hueShift: agent.hueShift,
      };
      folderNames[agent.id] = agent.label;
    }

    const messages = [
      { type: 'stateReset' },
      {
        type: 'existingAgents',
        agents: sortedAgents.map((agent) => agent.id),
        agentMeta,
        folderNames,
      },
    ];

    for (const agent of sortedAgents) {
      for (const tool of agent.activeTools.values()) {
        messages.push({
          type: 'agentToolStart',
          id: agent.id,
          toolId: tool.toolId,
          status: tool.status,
        });
      }

      if (agent.status === WAITING_STATUS) {
        messages.push({
          type: 'agentStatus',
          id: agent.id,
          status: WAITING_STATUS,
        });
      } else if (agent.activeTools.size === 0) {
        messages.push({
          type: 'agentStatus',
          id: agent.id,
          status: ACTIVE_STATUS,
        });
      }
    }

    return {
      generatedAt: Date.now(),
      messages,
    };
  }

  async function start(ctx) {
    await stop();
    refreshConfiguredAgents(ctx.config);
    subscriptions.push(api.runtime.events.onAgentEvent(handleAgentEvent));
    subscriptions.push(api.runtime.events.onSessionTranscriptUpdate(handleTranscriptUpdate));
  }

  async function stop() {
    while (subscriptions.length > 0) {
      const unsubscribe = subscriptions.pop();
      unsubscribe?.();
    }
    runs.clear();
    for (const agent of agents.values()) {
      clearFallback(agent);
      clearAgentTools(agent);
      setAgentStatus(agent, WAITING_STATUS, true);
    }
  }

  refreshConfiguredAgents(currentConfig);

  return {
    getBootstrap,
    getSnapshot,
    subscribe,
    start,
    stop,
    _private: {
      handleAgentEvent,
      handleTranscriptUpdate,
      refreshConfiguredAgents,
      agents,
      runs,
    },
  };
}
