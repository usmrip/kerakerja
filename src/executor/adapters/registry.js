const { findCli } = require('./finder');

/**
 * Adapter definitions for autonomous CLI AI agents
 */
const AGENT_ADAPTERS = {
  agy: {
    name: 'Google Antigravity CLI',
    binaries: ['agy', 'antigravity'],
    getArgs: (prompt) => ['-p', prompt, '--dangerously-skip-permissions'],
    description: 'Antigravity CLI non-interactive mode'
  },
  claude: {
    name: 'Claude Code CLI',
    binaries: ['claude'],
    getArgs: (prompt) => ['-p', prompt],
    description: 'Claude Code CLI print mode (-p)'
  },
  gemini: {
    name: 'Gemini CLI',
    binaries: ['gemini'],
    getArgs: (prompt) => ['-p', prompt],
    description: 'Gemini CLI non-interactive mode'
  },
  codex: {
    name: 'Codex CLI',
    binaries: ['codex'],
    getArgs: (prompt) => ['exec', prompt],
    description: 'Codex CLI exec command'
  },
  cline: {
    name: 'Cline CLI',
    binaries: ['cline'],
    getArgs: (prompt) => ['-y', '-m', prompt],
    description: 'Cline CLI non-interactive mode'
  }
};

/**
 * Resolve adapter and executable path for specified agent or auto
 * @param {string} agentName 
 * @returns {{adapter: Object, binaryPath: string, key: string}|null}
 */
function resolveAgent(agentName = 'auto') {
  const norm = (agentName || 'auto').toLowerCase().trim();

  if (norm !== 'auto' && AGENT_ADAPTERS[norm]) {
    const adapter = AGENT_ADAPTERS[norm];
    for (const b of adapter.binaries) {
      const found = findCli(b);
      if (found) {
        return { adapter, binaryPath: found, key: norm };
      }
    }
    return { adapter, binaryPath: adapter.binaries[0], key: norm };
  }

  // Auto detection order: agy -> claude -> gemini -> cline -> codex
  const priority = ['agy', 'claude', 'gemini', 'cline', 'codex'];
  for (const k of priority) {
    const adapter = AGENT_ADAPTERS[k];
    for (const b of adapter.binaries) {
      const found = findCli(b);
      if (found) {
        return { adapter, binaryPath: found, key: k };
      }
    }
  }

  return null;
}

module.exports = {
  AGENT_ADAPTERS,
  resolveAgent
};
