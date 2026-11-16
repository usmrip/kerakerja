const http = require('http');
const https = require('https');
const { URL } = require('url');

class ApiClient {
  constructor(baseUrl, secret, projectId) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.secret = secret || '';
    this.projectId = projectId || 'default';
  }

  request(endpoint, params = {}, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      try {
        const fullUrl = new URL(this.baseUrl);
        fullUrl.searchParams.set('action', endpoint);
        fullUrl.searchParams.set('secret', this.secret);
        fullUrl.searchParams.set('project_id', this.projectId);

        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null) {
            fullUrl.searchParams.set(k, String(v));
          }
        }

        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const options = {
          hostname: fullUrl.hostname,
          port: fullUrl.port || (isHttps ? 443 : 80),
          path: fullUrl.pathname + fullUrl.search,
          method: method.toUpperCase(),
          headers: {
            'User-Agent': 'TeleVsCli/1.0.0 (Node.js/Headless)',
            'Accept': 'application/json'
          },
          timeout: 15000
        };

        let postData = null;
        if (body && (method === 'POST' || method === 'PUT')) {
          postData = typeof body === 'string' ? body : JSON.stringify(body);
          options.headers['Content-Type'] = typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
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
                reject(new Error(`Server error HTTP ${res.statusCode}: ${rawData.substring(0, 200)}`));
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

  pullTasks() {
    return this.request('pull');
  }

  getStatus() {
    return this.request('api_status');
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

  doneTask(taskId, resultSummary, commitHash = '', log = '') {
    return this.request('done', {
      id: taskId,
      result: resultSummary,
      commit_hash: commitHash,
      log: log.substring(0, 10000)
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
      executor: options.executor || 'cli',
      agent: options.agent || 'auto',
      priority: options.priority || 'NORMAL'
    }, 'POST');
  }

  registerWorker(workerId, metadata = {}) {
    return this.request('worker_heartbeat', {
      worker_id: workerId,
      status: 'online',
      platform: process.platform,
      arch: process.arch,
      agent: metadata.agent || 'auto',
      executor: 'cli',
      agy_usage: metadata.agy_usage ? (typeof metadata.agy_usage === 'string' ? metadata.agy_usage : JSON.stringify(metadata.agy_usage)) : '',
      metadata: JSON.stringify(metadata)
    }, 'POST');
  }

  unregisterWorker(workerId) {
    return this.request('worker_heartbeat', {
      worker_id: workerId,
      status: 'offline'
    }, 'POST');
  }
}

module.exports = ApiClient;
