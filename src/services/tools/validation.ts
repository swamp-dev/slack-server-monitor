/**
 * Tool validation utilities for plugin security
 *
 * Validates tool specifications before registration to prevent:
 * - Invalid tool names
 * - Missing required fields
 * - Plugin tools overriding built-in tools
 */


/**
 * Tool name format: lowercase, starts with letter, 3-50 chars, only letters/numbers/underscores
 */
const TOOL_NAME_REGEX = /^[a-z][a-z0-9_]{2,49}$/;

/**
 * Built-in tool names that plugins cannot override
 */
export const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'get_container_status',
  'get_container_logs',
  'get_system_resources',
  'get_disk_usage',
  'get_network_info',
  'run_command',
  'read_file',
]);

/**
 * Result of tool validation
 */
export interface ToolValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a tool name format
 */
export function validateToolName(name: unknown): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof name !== 'string') {
    errors.push('Tool name must be a string');
    return { valid: false, errors, warnings };
  }

  if (name.length === 0) {
    errors.push('Tool name cannot be empty');
    return { valid: false, errors, warnings };
  }

  if (name.length < 3) {
    errors.push('Tool name must be at least 3 characters');
  }

  if (name.length > 50) {
    errors.push('Tool name must be at most 50 characters');
  }

  if (!TOOL_NAME_REGEX.test(name)) {
    errors.push('Tool name must be lowercase, start with a letter, and contain only letters, numbers, and underscores');
  }

  if (isBuiltInToolName(name)) {
    errors.push(`Tool name "${name}" conflicts with built-in tool (will be namespaced as pluginname:${name})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a tool name matches a built-in tool
 */
export function isBuiltInToolName(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name);
}

/**
 * Validate a tool specification object
 */
export function validateToolSpec(spec: unknown): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof spec !== 'object' || spec === null) {
    errors.push('Tool spec must be an object');
    return { valid: false, errors, warnings };
  }

  const s = spec as Record<string, unknown>;

  // Validate name
  const nameResult = validateToolName(s.name);
  errors.push(...nameResult.errors);
  warnings.push(...nameResult.warnings);

  // Validate description
  if (typeof s.description !== 'string') {
    errors.push('Tool spec must have a description string');
  } else if (s.description.length === 0) {
    errors.push('Tool description cannot be empty');
  } else if (s.description.length < 10) {
    warnings.push('Tool description is very short, consider adding more detail');
  }

  // Validate input_schema
  if (typeof s.input_schema !== 'object' || s.input_schema === null) {
    errors.push('Tool spec must have an input_schema object');
  } else {
    const schema = s.input_schema as Record<string, unknown>;
    if (schema.type !== 'object') {
      errors.push('Tool input_schema.type must be "object"');
    }
    if (typeof schema.properties !== 'object' || schema.properties === null) {
      errors.push('Tool input_schema must have a properties object');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a complete tool definition (spec + execute function)
 */
export function validateToolDefinition(tool: unknown): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof tool !== 'object' || tool === null) {
    errors.push('Tool definition must be an object');
    return { valid: false, errors, warnings };
  }

  const t = tool as Record<string, unknown>;

  // Validate spec
  const specResult = validateToolSpec(t.spec);
  errors.push(...specResult.errors);
  warnings.push(...specResult.warnings);

  // Validate execute function
  if (typeof t.execute !== 'function') {
    errors.push('Tool definition must have an execute function');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate an array of tool definitions from a plugin
 * Returns combined validation result for all tools
 */
export function validatePluginTools(
  tools: unknown[],
  pluginName: string
): ToolValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(tools)) {
    errors.push('Plugin tools must be an array');
    return { valid: false, errors, warnings };
  }

  for (const [i, tool] of tools.entries()) {
    const result = validateToolDefinition(tool);

    // Prefix errors/warnings with tool index for context
    for (const error of result.errors) {
      errors.push(`Tool ${String(i)}: ${error}`);
    }
    for (const warning of result.warnings) {
      warnings.push(`Tool ${String(i)}: ${warning}`);
    }
  }

  // Check for duplicate tool names within the plugin
  const seenNames = new Set<string>();
  for (const tool of tools) {
    // Tool is unknown[], so we need to safely access nested properties
    const toolObj = tool as Record<string, unknown> | null | undefined;
    const specObj = toolObj?.spec as Record<string, unknown> | null | undefined;
    const name = specObj?.name;
    if (typeof name === 'string') {
      if (seenNames.has(name)) {
        errors.push(`Duplicate tool name "${name}" in plugin "${pluginName}"`);
      }
      seenNames.add(name);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
