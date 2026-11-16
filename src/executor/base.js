class BaseExecutor {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * Execute a task instruction
   * @param {Object} task
   * @param {Object} context
   * @returns {Promise<{success: boolean, summary: string, commitHash?: string, log?: string}>}
   */
  async execute(task, context = {}) {
    throw new Error('Method execute() must be implemented by subclass');
  }

  /**
   * Check if this executor is available in the environment
   * @returns {Promise<boolean>|boolean}
   */
  isAvailable() {
    return true;
  }
}

module.exports = BaseExecutor;
