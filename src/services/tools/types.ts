export interface ToolDefinition {
  id: string;
  name: string;
  displayName: string;
  /** Full, model-facing description sent in the tool schema. Can be detailed. */
  description: string;
  /**
   * Short one-line description shown in the Tools settings list. Falls back to
   * `description` when omitted. Use this when the model-facing `description`
   * carries detailed instructions that would be a wall of text in the UI.
   */
  uiDescription?: string;
  icon: string;
  parameters: Record<string, ToolParameter>;
  requiresNetwork?: boolean;
  /**
   * Backed by the on-device Python runtime (operates on the Pyodide MEMFS).
   * These are unlocked as a group when `run_python` is enabled rather than
   * toggled individually - see resolveEnabledToolIds.
   */
  requiresPython?: boolean;
  /** Not shown as its own row in the Tools settings list (unlocked via another tool). */
  hidden?: boolean;
  /**
   * The tool's core function runs on-device; it only reaches the network for an
   * optional extra (e.g. run_python installs PyPI packages but numpy/pandas are
   * offline). Such tools stay available when the global "online tools" switch is
   * off — the network path is refused at execution time instead of hiding the
   * tool. Distinct from `requiresNetwork` tools, which are removed entirely.
   */
  offlineCapable?: boolean;
}

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ToolCall {
  id?: string;
  name: string;
  arguments: Record<string, any>;
  context?: { projectId?: string };
}

export interface ToolResult {
  toolCallId?: string;
  name: string;
  content: string;
  error?: string;
  durationMs: number;
  /**
   * Media the tool produced for the user to see (e.g. matplotlib plots from
   * run_python). Rendered on the tool-result message; not sent to the model,
   * which only receives `content` text.
   */
  attachments?: import('../../types').MediaAttachment[];
}
