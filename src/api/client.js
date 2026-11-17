const http = require('http');
const https = require('https');
const { URL } = require('url');

class ApiClient {
  constructor(baseUrl, secret, projectId, options = {}) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.secret = secret || '';
    this.projectId = projectId || 'default';
    this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 3;
    this.retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 1000;
  }

  _isTransientError(err) {
    if (!err || !err.message) return false;
    return /Server error HTTP 5\d\d|Koneksi timeout|Gagal menghubungi server/i.test(err.message);
  }

  async request(endpoint, params = {}, method = 'GET', body = null) {
    let lastErr = null;
    const attempts = Math.max(1, (this.maxRetries || 0) + 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this._requestOnce(endpoint, params, method, body);
      } catch (err) {
        lastErr = err;
        if (attempt < attempts && this._isTransientError(err)) {
          const waitMs = (this.retryDelayMs || 1000) * attempt;
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  _requestOnce(endpoint, params = {}, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      try {
        const upperMethod = method.toUpperCase();
        const fullUrl = new URL(this.baseUrl);
        fullUrl.searchParams.set('action', endpoint);
        fullUrl.searchParams.set('secret', this.secret);
        fullUrl.searchParams.set('project_id', this.projectId);

        let postData = null;
        const hasExplicitBody = body !== null && body !== undefined;

        if ((upperMethod === 'POST' || upperMethod === 'PUT') && !hasExplicitBody) {
          // Kirim payload via form-urlencoded POST body agar tidak terkena batas panjang URL (HTTP 500/414)
          const formParams = new URLSearchParams();
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) {
              formParams.set(k, String(v));
            }
          }
          postData = formParams.toString();
        } else {
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) {
              fullUrl.searchParams.set(k, String(v));
            }
          }
          if (hasExplicitBody && (upperMethod === 'POST' || upperMethod === 'PUT')) {
            postData = typeof body === 'string' ? body : JSON.stringify(body);
          }
        }

        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          hostname: fullUrl.hostname,
          port: fullUrl.port || (isHttps ? 443 : 80),
          path: fullUrl.pathname + fullUrl.search,
          method: upperMethod,
          headers: {
            'User-Agent': 'KeraKerja/1.0.0 (Node.js/Headless)',
            'Accept': 'application/json'
          },
          timeout: 15000
        };

        if (postData !== null && (upperMethod === 'POST' || upperMethod === 'PUT')) {
          options.headers['Content-Type'] = (hasExplicitBody && typeof body !== 'string')
            ? 'application/json'
            : 'application/x-www-form-urlencoded';
          options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = client.request(options, (res) => {
          let rawData = '';
          res.setEncoding('utf8');
          res.on('data', chunk => rawData += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(rawData);
              resolve({
                statusCode: res.statusCode,
                data: parsed,
                raw: rawData
              });
            } catch (err) {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({
                  statusCode: res.statusCode,
                  data: { raw: rawData },
                  raw: rawData
                });
              } else {
                reject(new Error(`Server error HTTP ${res.statusCode} [${endpoint}]: ${rawData.substring(0, 200)}`));
              }
            }
          });
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Koneksi timeout ke server ' + fullUrl.hostname));
        });

        req.on('error', (err) => {
          reject(new Error(`Gagal menghubungi server (${err.message})`));
        });

        if (postData) {
          req.write(postData);
        }
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  pullTasks(options = {}) {
    const params = {};
    if (options.executor) params.executor = options.executor;
    if (options.workerId) params.worker_id = options.workerId;
    return this.request('pull', params);
  }

  getStatus() {
    return this.request('api_status');
  }

  getWorkers(options = {}) {
    const params = {};
    if (options.all) params.all = '1';
    if (options.status) params.status = options.status;
    return this.request('api_workers', params);
  }

  getTask(taskId) {
    return this.request('api_get_task', { id: taskId });
  }

  killTask(taskId, reason = 'Dihentikan paksa (/kill)') {
    return this.failTask(taskId, reason);
  }

  startTask(taskId, workerId, agentName) {
    return this.request('in_progress', {
      id: taskId,
      worker_id: workerId,
      agent: agentName,
      executor: 'cli'
    });
  }

  doneTask(taskId, resultSummary, commitHash = '', log = '', extra = {}) {
    return this.request('done', {
      id: taskId,
      result: resultSummary,
      commit_hash: commitHash,
      log: log.substring(0, 10000),
      ...(extra && typeof extra === 'object' ? extra : {})
    }, 'POST');
  }

  failTask(taskId, errorMessage, log = '') {
    return this.request('failed', {
      id: taskId,
      result: errorMessage,
      log: log.substring(0, 10000)
    }, 'POST');
  }

  addTask(instruction, options = {}) {
    return this.request('push', {
      instruction,
      sender: options.sender || 'CLI',
      status: options.status || 'PENDING',
      executor: options.executor || 'cli',
      agent: options.agent || 'auto',
      priority: options.priority || 'NORMAL'
    }, 'POST');
  }

  registerWorker(workerId, metadata = {}) {
    const isOffline = metadata.status === 'offline';
    return this.request('worker_heartbeat', {
      worker_id: workerId,
      status: isOffline ? 'offline' : 'online',
      worker_status: metadata.status || 'idle',
      platform: process.platform,
      arch: process.arch,
      agent: metadata.agent || 'auto',
      executor: 'cli',
      hostname: metadata.hostname || '',
      work_dir: metadata.workDir || '',
      pid: metadata.pid || process.pid,
      active_task_id: metadata.activeTask || '',
      active_task_title: metadata.activeTaskTitle || '',
      task_agents_timer: metadata.taskAgentsTimer ?? 0,
      last_task_agents_read: metadata.lastTaskAgentsRead || '',
      agy_usage: metadata.agy_usage ? (typeof metadata.agy_usage === 'string' ? metadata.agy_usage : JSON.stringify(metadata.agy_usage)) : '',
      metadata: JSON.stringify(metadata)
    }, 'POST');
  }

  unregisterWorker(workerId) {
    return this.request('worker_heartbeat', {
      worker_id: workerId,
      status: 'offline',
      worker_status: 'offline'
    }, 'POST');
  }
}

module.exports = ApiClient;
