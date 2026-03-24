/**
 * Agent Tracker — monitors OpenClaw session JSONL files and emits
 * agent status events via a callback. Adapted from the VS Code
 * extension's fileWatcher.ts + transcriptParser.ts for standalone use.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Constants ────────────────────────────────────────────────────────────────

const FILE_WATCHER_POLL_MS = 2000;
const PROJECT_SCAN_INTERVAL_MS = 1000;
const TOOL_DONE_DELAY_MS = 300;
const TEXT_IDLE_DELAY_MS = 5000;
const PERMISSION_TIMEOUT_MS = 5000;
const BASH_CMD_MAX_LEN = 80;
const TASK_DESC_MAX_LEN = 60;

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion']);

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface TrackedAgent {
  id: number;
  sessionId: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
}

// ── Agent Tracker ────────────────────────────────────────────────────────────

export class AgentTracker {
  private agents = new Map<number, TrackedAgent>();
  private nextAgentId = 1;
  private projectDirs = new Set<string>();
  private knownJsonlFiles = new Set<string>();
  private watchers = new Map<number, fs.FSWatcher>();
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private emit: (event: AgentEvent) => void;

  constructor(emitter: (event: AgentEvent) => void) {
    this.emit = emitter;
  }

  /** Start scanning for JSONL files in the Claude projects directory */
  start(): void {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    this.scanAllProjectDirs(claudeDir);
    this.scanTimer = setInterval(
      () => this.scanAllProjectDirs(claudeDir),
      PROJECT_SCAN_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const [id] of this.agents) {
      this.stopWatching(id);
    }
    this.agents.clear();
  }

  getAgentIds(): number[] {
    return [...this.agents.keys()];
  }

  private scanAllProjectDirs(claudeDir: string): void {
    try {
      if (!fs.existsSync(claudeDir)) return;
      const dirs = fs.readdirSync(claudeDir);
      for (const dir of dirs) {
        const fullPath = path.join(claudeDir, dir);
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            this.scanProjectDir(fullPath);
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir may not exist */
    }
  }

  private scanProjectDir(projectDir: string): void {
    this.projectDirs.add(projectDir);
    try {
      const files = fs
        .readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(projectDir, f));

      for (const file of files) {
        if (this.knownJsonlFiles.has(file)) continue;
        this.knownJsonlFiles.add(file);

        // Check if file is recent (modified within last 60 seconds = likely active)
        try {
          const stat = fs.statSync(file);
          const ageMs = Date.now() - stat.mtimeMs;
          if (ageMs < 60_000) {
            this.adoptFile(file, projectDir);
          }
        } catch {
          /* skip */
        }
      }
    } catch {
      /* dir may not exist */
    }
  }

  private adoptFile(jsonlFile: string, _projectDir: string): void {
    // Check if already tracked
    for (const agent of this.agents.values()) {
      if (agent.jsonlFile === jsonlFile) return;
    }

    const sessionId = path.basename(jsonlFile, '.jsonl');
    const id = this.nextAgentId++;

    const agent: TrackedAgent = {
      id,
      sessionId,
      jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
    };

    this.agents.set(id, agent);
    this.emit({ type: 'agentCreated', id, name: `Agent ${id}` });
    this.startWatching(id, jsonlFile);
    this.readNewLines(id);
  }

  private startWatching(agentId: number, filePath: string): void {
    try {
      const watcher = fs.watch(filePath, () => this.readNewLines(agentId));
      this.watchers.set(agentId, watcher);
    } catch {
      /* fs.watch may fail */
    }

    const interval = setInterval(() => {
      if (!this.agents.has(agentId)) {
        clearInterval(interval);
        return;
      }
      this.readNewLines(agentId);
    }, FILE_WATCHER_POLL_MS);
    this.pollingTimers.set(agentId, interval);
  }

  private stopWatching(agentId: number): void {
    this.watchers.get(agentId)?.close();
    this.watchers.delete(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) clearInterval(pt);
    this.pollingTimers.delete(agentId);
    this.cancelWaitingTimer(agentId);
    this.cancelPermissionTimer(agentId);
  }

  private readNewLines(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      const hasLines = lines.some((l) => l.trim());
      if (hasLines) {
        this.cancelWaitingTimer(agentId);
        this.cancelPermissionTimer(agentId);
        if (agent.permissionSent) {
          agent.permissionSent = false;
          this.emit({ type: 'agentToolPermissionClear', id: agentId });
        }
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        this.processLine(agentId, line);
      }
    } catch {
      /* read error */
    }
  }

  private processLine(agentId: number, line: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    try {
      const record = JSON.parse(line);

      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        const blocks = record.message.content as Array<{
          type: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
        const hasToolUse = blocks.some((b) => b.type === 'tool_use');

        if (hasToolUse) {
          this.cancelWaitingTimer(agentId);
          agent.isWaiting = false;
          agent.hadToolsInTurn = true;
          this.emit({ type: 'agentStatus', id: agentId, status: 'active' });

          let hasNonExempt = false;
          for (const block of blocks) {
            if (block.type === 'tool_use' && block.id) {
              const toolName = block.name || '';
              const status = formatToolStatus(toolName, block.input || {});
              agent.activeToolIds.add(block.id);
              agent.activeToolStatuses.set(block.id, status);
              agent.activeToolNames.set(block.id, toolName);

              if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExempt = true;

              this.emit({ type: 'agentToolStart', id: agentId, toolId: block.id, status });

              // Sub-agent creation for Task tools
              if (status.startsWith('Subtask:')) {
                const label = status.slice('Subtask:'.length).trim();
                this.emit({
                  type: 'subagentCreated',
                  parentId: agentId,
                  parentToolId: block.id,
                  label,
                });
              }
            }
          }
          if (hasNonExempt) {
            this.startPermissionTimer(agentId);
          }
        } else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
          this.startWaitingTimer(agentId);
        }
      } else if (record.type === 'progress') {
        this.processProgress(agentId, record);
      } else if (record.type === 'user') {
        this.processUserRecord(agentId, record);
      } else if (record.type === 'system' && record.subtype === 'turn_duration') {
        this.cancelWaitingTimer(agentId);
        this.cancelPermissionTimer(agentId);

        if (agent.activeToolIds.size > 0) {
          agent.activeToolIds.clear();
          agent.activeToolStatuses.clear();
          agent.activeToolNames.clear();
          agent.activeSubagentToolIds.clear();
          agent.activeSubagentToolNames.clear();
          this.emit({ type: 'agentToolsClear', id: agentId });
        }

        agent.isWaiting = true;
        agent.permissionSent = false;
        agent.hadToolsInTurn = false;
        this.emit({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
    } catch {
      /* malformed line */
    }
  }

  private processUserRecord(agentId: number, record: Record<string, unknown>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const content = (record.message as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      const hasToolResult = content.some((b: Record<string, unknown>) => b.type === 'tool_result');
      if (hasToolResult) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_result' && b.tool_use_id) {
            const completedId = b.tool_use_id as string;
            const completedName = agent.activeToolNames.get(completedId);

            if (completedName === 'Task' || completedName === 'Agent') {
              agent.activeSubagentToolIds.delete(completedId);
              agent.activeSubagentToolNames.delete(completedId);
              this.emit({ type: 'subagentClear', id: agentId, parentToolId: completedId });
            }

            agent.activeToolIds.delete(completedId);
            agent.activeToolStatuses.delete(completedId);
            agent.activeToolNames.delete(completedId);

            setTimeout(() => {
              this.emit({ type: 'agentToolDone', id: agentId, toolId: completedId });
            }, TOOL_DONE_DELAY_MS);
          }
        }
        if (agent.activeToolIds.size === 0) {
          agent.hadToolsInTurn = false;
        }
      } else {
        // New user prompt
        this.cancelWaitingTimer(agentId);
        this.clearAgentActivity(agent, agentId);
        agent.hadToolsInTurn = false;
      }
    } else if (typeof content === 'string' && content.trim()) {
      this.cancelWaitingTimer(agentId);
      this.clearAgentActivity(agent, agentId);
      agent.hadToolsInTurn = false;
    }
  }

  private processProgress(agentId: number, record: Record<string, unknown>): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const parentToolId = record.parentToolUseID as string | undefined;
    if (!parentToolId) return;

    const data = record.data as Record<string, unknown> | undefined;
    if (!data) return;

    const dataType = data.type as string | undefined;
    if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
      if (agent.activeToolIds.has(parentToolId)) {
        this.startPermissionTimer(agentId);
      }
      return;
    }

    const parentToolName = agent.activeToolNames.get(parentToolId);
    if (parentToolName !== 'Task' && parentToolName !== 'Agent') return;

    const msg = data.message as Record<string, unknown> | undefined;
    if (!msg) return;
    const msgType = msg.type as string;
    const innerMsg = msg.message as Record<string, unknown> | undefined;
    const content = innerMsg?.content;
    if (!Array.isArray(content)) return;

    if (msgType === 'assistant') {
      let hasNonExempt = false;
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_use' && b.id) {
          const toolName = (b.name as string) || '';
          const status = formatToolStatus(toolName, (b.input as Record<string, unknown>) || {});

          let subTools = agent.activeSubagentToolIds.get(parentToolId);
          if (!subTools) {
            subTools = new Set();
            agent.activeSubagentToolIds.set(parentToolId, subTools);
          }
          subTools.add(b.id as string);

          let subNames = agent.activeSubagentToolNames.get(parentToolId);
          if (!subNames) {
            subNames = new Map();
            agent.activeSubagentToolNames.set(parentToolId, subNames);
          }
          subNames.set(b.id as string, toolName);

          if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExempt = true;

          this.emit({
            type: 'subagentToolStart',
            id: agentId,
            parentToolId,
            toolId: b.id as string,
            status,
          });
        }
      }
      if (hasNonExempt) this.startPermissionTimer(agentId);
    } else if (msgType === 'user') {
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (b.type === 'tool_result' && b.tool_use_id) {
          const subTools = agent.activeSubagentToolIds.get(parentToolId);
          if (subTools) subTools.delete(b.tool_use_id as string);
          const subNames = agent.activeSubagentToolNames.get(parentToolId);
          if (subNames) subNames.delete(b.tool_use_id as string);

          const toolId = b.tool_use_id as string;
          setTimeout(() => {
            this.emit({ type: 'subagentToolDone', id: agentId, parentToolId, toolId });
          }, TOOL_DONE_DELAY_MS);
        }
      }
    }
  }

  private clearAgentActivity(agent: TrackedAgent, agentId: number): void {
    if (agent.activeToolIds.size > 0) {
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      this.emit({ type: 'agentToolsClear', id: agentId });
    }
    agent.permissionSent = false;
  }

  private startWaitingTimer(agentId: number): void {
    this.cancelWaitingTimer(agentId);
    const timer = setTimeout(() => {
      this.waitingTimers.delete(agentId);
      const agent = this.agents.get(agentId);
      if (!agent) return;
      agent.isWaiting = true;
      this.emit({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }, TEXT_IDLE_DELAY_MS);
    this.waitingTimers.set(agentId, timer);
  }

  private cancelWaitingTimer(agentId: number): void {
    const t = this.waitingTimers.get(agentId);
    if (t) {
      clearTimeout(t);
      this.waitingTimers.delete(agentId);
    }
  }

  private startPermissionTimer(agentId: number): void {
    this.cancelPermissionTimer(agentId);
    const timer = setTimeout(() => {
      this.permissionTimers.delete(agentId);
      const agent = this.agents.get(agentId);
      if (!agent || agent.permissionSent) return;
      agent.permissionSent = true;
      this.emit({ type: 'agentToolPermission', id: agentId });
    }, PERMISSION_TIMEOUT_MS);
    this.permissionTimers.set(agentId, timer);
  }

  private cancelPermissionTimer(agentId: number): void {
    const t = this.permissionTimers.get(agentId);
    if (t) {
      clearTimeout(t);
      this.permissionTimers.delete(agentId);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_CMD_MAX_LEN ? cmd.slice(0, BASH_CMD_MAX_LEN) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESC_MAX_LEN ? desc.slice(0, TASK_DESC_MAX_LEN) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    default:
      return `Using ${toolName}`;
  }
}
