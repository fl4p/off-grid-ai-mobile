/**
 * Tool Registry Unit Tests
 *
 * Tests for AVAILABLE_TOOLS, getToolsAsOpenAISchema(), and buildToolSystemPromptHint().
 * Priority: P1 (High) - Tool registry drives tool-calling feature behavior.
 */

import {
  AVAILABLE_TOOLS,
  getToolsAsOpenAISchema,
  buildToolSystemPromptHint,
  buildNoToolsNote,
  buildPromptWithToolNote,
  resolveEnabledToolIds,
} from '../../../../src/services/tools/registry';

describe('Tool Registry', () => {
  // ========================================================================
  // AVAILABLE_TOOLS
  // ========================================================================
  describe('AVAILABLE_TOOLS', () => {
    it('has core tools with correct IDs', () => {
      // Email + calendar tools are pro-gated and live in the pro package
      // (EmailCalendarExtension), so they are not part of the core registry.
      // The 5 Python filesystem tools are hidden companions unlocked by run_python.
      expect(AVAILABLE_TOOLS).toHaveLength(15);

      const ids = AVAILABLE_TOOLS.map(t => t.id);
      expect(ids).toEqual([
        'web_search',
        'calculator',
        'get_current_datetime',
        'get_device_info',
        'search_knowledge_base',
        'search_memory',
        'save_memory',
        'forget_memory',
        'run_python',
        'read_url',
        'read_file',
        'write_file',
        'edit_file',
        'list_files',
        'grep',
      ]);
    });

    it('marks the Python filesystem tools as hidden, requiresPython companions', () => {
      const fsIds = ['read_file', 'write_file', 'edit_file', 'list_files', 'grep'];
      for (const id of fsIds) {
        const tool = AVAILABLE_TOOLS.find(t => t.id === id)!;
        expect(tool.hidden).toBe(true);
        expect(tool.requiresPython).toBe(true);
      }
    });

    it('each tool has required fields (id, name, displayName, description, icon, parameters)', () => {
      for (const tool of AVAILABLE_TOOLS) {
        expect(tool.id).toBeTruthy();
        expect(typeof tool.id).toBe('string');
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe('string');
        expect(tool.displayName).toBeTruthy();
        expect(typeof tool.displayName).toBe('string');
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
        expect(tool.icon).toBeTruthy();
        expect(typeof tool.icon).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.parameters).toBe('object');
      }
    });
  });

  // ========================================================================
  // resolveEnabledToolIds - Python unlocks its filesystem companions
  // ========================================================================
  describe('resolveEnabledToolIds', () => {
    const fsIds = ['read_file', 'write_file', 'edit_file', 'list_files', 'grep'];

    it('is a no-op when run_python is not enabled', () => {
      expect(resolveEnabledToolIds(['web_search', 'calculator'])).toEqual(['web_search', 'calculator']);
    });

    it('unlocks the filesystem tools when run_python is enabled', () => {
      const resolved = resolveEnabledToolIds(['run_python']);
      expect(resolved).toContain('run_python');
      for (const id of fsIds) expect(resolved).toContain(id);
    });

    it('does not duplicate ids already present', () => {
      const resolved = resolveEnabledToolIds(['run_python', 'read_file']);
      expect(resolved.filter(id => id === 'read_file')).toHaveLength(1);
    });

    it('exposes the filesystem tools to the model schema only when Python is on', () => {
      const withPython = getToolsAsOpenAISchema(['run_python']).map(s => s.function.name);
      expect(withPython).toEqual(expect.arrayContaining(fsIds));

      const withoutPython = getToolsAsOpenAISchema(['web_search']).map(s => s.function.name);
      expect(withoutPython).not.toEqual(expect.arrayContaining(fsIds));
    });

    it('lists the filesystem tools in the text hint when Python is on', () => {
      const hint = buildToolSystemPromptHint(['run_python']);
      expect(hint).toContain('read_file');
      expect(hint).toContain('grep');
    });

    it('steers run_python away from subprocess and toward read_url + write_file for remote files', () => {
      const runPython = AVAILABLE_TOOLS.find(t => t.id === 'run_python')!;
      // Names the sandbox limitation the model keeps tripping over...
      expect(runPython.description).toContain('emscripten does not support processes');
      expect(runPython.description).toMatch(/no operating-system processes|no OS processes|no operating-system processes, shell/i);
      // ...and points at the tools that actually work on-device.
      expect(runPython.description).toContain('read_url');
      expect(runPython.description).toContain('write_file');
    });
  });

  // ========================================================================
  // getToolsAsOpenAISchema
  // ========================================================================
  describe('getToolsAsOpenAISchema', () => {
    it('returns correct OpenAI format for given tool IDs', () => {
      const schema = getToolsAsOpenAISchema(['calculator']);

      expect(schema).toHaveLength(1);
      expect(schema[0]).toEqual({
        type: 'function',
        function: {
          name: 'calculator',
          description: 'Evaluate math expressions',
          parameters: {
            type: 'object',
            properties: {
              expression: {
                type: 'string',
                description: 'Math expression',
              },
            },
            required: ['expression'],
          },
        },
      });
    });

    it('filters to only enabled tools', () => {
      const schema = getToolsAsOpenAISchema(['calculator', 'get_current_datetime']);

      expect(schema).toHaveLength(2);
      const names = schema.map(s => s.function.name);
      expect(names).toEqual(['calculator', 'get_current_datetime']);
    });

    it('returns empty array for no matches', () => {
      const schema = getToolsAsOpenAISchema(['nonexistent_tool']);

      expect(schema).toEqual([]);
    });

    it('includes required parameters correctly', () => {
      const schema = getToolsAsOpenAISchema(['web_search']);

      expect(schema[0].function.parameters.required).toEqual(['query']);

      // Non-required parameters should not appear in required array
      const datetimeSchema = getToolsAsOpenAISchema(['get_current_datetime']);
      expect(datetimeSchema[0].function.parameters.required).toEqual([]);
    });

    it('includes enum values when present in parameters', () => {
      const schema = getToolsAsOpenAISchema(['get_device_info']);

      const infoType = schema[0].function.parameters.properties.info_type;
      expect(infoType.enum).toEqual(['battery', 'storage', 'memory', 'all']);

      // Tools without enums should not have the enum key
      const calcSchema = getToolsAsOpenAISchema(['calculator']);
      const expressionProp = calcSchema[0].function.parameters.properties.expression;
      expect(expressionProp).not.toHaveProperty('enum');
    });
  });

  // ========================================================================
  // buildToolSystemPromptHint
  // ========================================================================
  describe('buildToolSystemPromptHint', () => {
    it('returns empty string for empty array', () => {
      const hint = buildToolSystemPromptHint([]);

      expect(hint).toBe('');
    });

    it('returns empty string for non-matching IDs', () => {
      const hint = buildToolSystemPromptHint(['nonexistent_tool', 'another_fake']);

      expect(hint).toBe('');
    });

    it('includes tool names and descriptions for enabled tools', () => {
      const hint = buildToolSystemPromptHint(['calculator', 'web_search']);

      expect(hint).toContain('- calculator: Evaluate math expressions');
      expect(hint).toContain('- web_search: Search the live web');
      expect(hint).toContain('Tools available');
    });

    it('only includes enabled tools, not all tools', () => {
      const hint = buildToolSystemPromptHint(['calculator']);

      expect(hint).toContain('calculator: Evaluate math expressions');
      expect(hint).not.toContain('web_search');
      expect(hint).not.toContain('get_current_datetime');
      expect(hint).not.toContain('get_device_info');
    });

    it('includes read_url when read_url is enabled', () => {
      const hint = buildToolSystemPromptHint(['read_url']);
      expect(hint).toContain('read_url');
      expect(hint).toContain('result page');
    });

    it('includes get_current_datetime when enabled', () => {
      const hint = buildToolSystemPromptHint(['get_current_datetime']);
      expect(hint).toContain('get_current_datetime');
      expect(hint).toContain('date and time');
    });
  });

  // ========================================================================
  // buildNoToolsNote
  // ========================================================================
  describe('buildNoToolsNote', () => {
    it('tells the model it has no tools and not to fake execution', () => {
      const note = buildNoToolsNote();
      expect(note).toMatch(/no tools/i);
      expect(note).toMatch(/run code|make plots/i);
      expect(note).toMatch(/not pretend/i);
    });

    it('stays short for small-context models (one line, well under 400 chars)', () => {
      const note = buildNoToolsNote();
      expect(note.trim().length).toBeLessThan(400);
      // Only the leading blank-line separator, no other newlines.
      expect(note.trimStart().includes('\n')).toBe(false);
    });
  });

  // ========================================================================
  // buildPromptWithToolNote
  // ========================================================================
  describe('buildPromptWithToolNote', () => {
    const BASE = 'You are a helpful assistant.';

    it('adds the calling-convention hint for text-hint models', () => {
      const out = buildPromptWithToolNote(BASE, { activeToolIds: ['calculator'], useTextHint: true });
      expect(out).toContain(BASE);
      expect(out).toContain('Tools available');
      expect(out).toContain('calculator');
    });

    it('adds the no-tools note when nothing is available', () => {
      const out = buildPromptWithToolNote(BASE, { activeToolIds: [], useTextHint: false });
      expect(out).toContain(BASE);
      expect(out).toMatch(/no tools/i);
    });

    it('does NOT add the no-tools note when MCP/extension tools are present', () => {
      // A user with 0 built-in tools but active MCP tools still has tools — the
      // note would otherwise contradict the tool schema injected downstream.
      const out = buildPromptWithToolNote(BASE, { activeToolIds: [], useTextHint: false, hasOtherTools: true });
      expect(out).toBe(BASE);
      expect(out).not.toMatch(/no tools/i);
    });

    it('appends nothing for native tool calling with built-in tools (schema carries them)', () => {
      const out = buildPromptWithToolNote(BASE, { activeToolIds: ['web_search'], useTextHint: false });
      expect(out).toBe(BASE);
    });
  });
});
