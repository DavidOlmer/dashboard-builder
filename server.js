const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3203;
const DASHBOARDS_DIR = path.join(__dirname, 'dashboards');

// Ensure dashboards directory exists
if (!fs.existsSync(DASHBOARDS_DIR)) {
  fs.mkdirSync(DASHBOARDS_DIR, { recursive: true });
}

// ============================================================
// Pre-built Queries - Simulated data for Paperclip metrics
// ============================================================
const QUERIES = {
  'paperclip.total': {
    name: 'Total Paperclips',
    description: 'Total paperclips produced',
    type: 'counter',
    execute: () => ({
      value: Math.floor(1_000_000 + Math.random() * 50_000),
      timestamp: new Date().toISOString()
    })
  },
  'paperclip.rate': {
    name: 'Production Rate',
    description: 'Paperclips per minute',
    type: 'counter',
    execute: () => ({
      value: Math.floor(450 + Math.random() * 100),
      timestamp: new Date().toISOString()
    })
  },
  'paperclip.history': {
    name: 'Production History',
    description: '24h production data',
    type: 'timeseries',
    execute: () => {
      const now = Date.now();
      const data = [];
      for (let i = 24; i >= 0; i--) {
        data.push({
          timestamp: new Date(now - i * 3600000).toISOString(),
          value: Math.floor(20000 + Math.random() * 5000 + (24 - i) * 500)
        });
      }
      return { series: data };
    }
  },
  'paperclip.status': {
    name: 'System Status',
    description: 'Current production status',
    type: 'status',
    execute: () => {
      const statuses = ['operational', 'degraded', 'maintenance', 'offline'];
      const weights = [0.85, 0.10, 0.04, 0.01];
      const rand = Math.random();
      let cumulative = 0;
      for (let i = 0; i < statuses.length; i++) {
        cumulative += weights[i];
        if (rand < cumulative) {
          return { status: statuses[i], timestamp: new Date().toISOString() };
        }
      }
      return { status: 'operational', timestamp: new Date().toISOString() };
    }
  },
  'paperclip.by_type': {
    name: 'Production by Type',
    description: 'Breakdown by paperclip type',
    type: 'table',
    execute: () => ({
      columns: ['Type', 'Count', 'Percentage'],
      rows: [
        ['Standard', Math.floor(500000 + Math.random() * 50000), '52%'],
        ['Jumbo', Math.floor(200000 + Math.random() * 20000), '21%'],
        ['Mini', Math.floor(150000 + Math.random() * 15000), '16%'],
        ['Colored', Math.floor(100000 + Math.random() * 10000), '11%']
      ]
    })
  },
  'system.memory': {
    name: 'Memory Usage',
    description: 'Current memory utilization',
    type: 'counter',
    execute: () => ({
      value: Math.floor(60 + Math.random() * 25),
      suffix: '%',
      timestamp: new Date().toISOString()
    })
  },
  'system.uptime': {
    name: 'System Uptime',
    description: 'Days since last restart',
    type: 'counter',
    execute: () => ({
      value: Math.floor(15 + Math.random() * 30),
      suffix: ' days',
      timestamp: new Date().toISOString()
    })
  },
  'system.errors': {
    name: 'Error Rate',
    description: 'Errors in last hour',
    type: 'counter',
    execute: () => ({
      value: Math.floor(Math.random() * 15),
      timestamp: new Date().toISOString()
    })
  }
};

// ============================================================
// Utility Functions
// ============================================================
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function generateId() {
  return `dashboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================
// Dashboard Operations
// ============================================================
function listDashboards() {
  const files = fs.readdirSync(DASHBOARDS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DASHBOARDS_DIR, f), 'utf8'));
      return { id: data.id, name: data.name, description: data.description, updated: data.updated };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getDashboard(id) {
  const filepath = path.join(DASHBOARDS_DIR, `${sanitizeId(id)}.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function saveDashboard(dashboard) {
  const id = dashboard.id || generateId();
  const now = new Date().toISOString();
  const data = {
    ...dashboard,
    id,
    created: dashboard.created || now,
    updated: now
  };
  fs.writeFileSync(
    path.join(DASHBOARDS_DIR, `${sanitizeId(id)}.json`),
    JSON.stringify(data, null, 2)
  );
  return data;
}

function deleteDashboard(id) {
  const filepath = path.join(DASHBOARDS_DIR, `${sanitizeId(id)}.json`);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}

// ============================================================
// Request Handler
// ============================================================
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // API Routes
  if (pathname === '/api/queries' && method === 'GET') {
    const queries = Object.entries(QUERIES).map(([key, q]) => ({
      key,
      name: q.name,
      description: q.description,
      type: q.type
    }));
    return sendJson(res, 200, queries);
  }

  if (pathname.startsWith('/api/data/') && method === 'GET') {
    const queryKey = pathname.slice('/api/data/'.length);
    const query = QUERIES[queryKey];
    if (!query) return sendJson(res, 404, { error: 'Query not found' });
    return sendJson(res, 200, query.execute());
  }

  if (pathname === '/api/dashboards' && method === 'GET') {
    return sendJson(res, 200, listDashboards());
  }

  if (pathname === '/api/dashboards' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const dashboard = saveDashboard(body);
      return sendJson(res, 201, dashboard);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname.startsWith('/api/dashboards/') && method === 'GET') {
    const id = pathname.slice('/api/dashboards/'.length);
    const dashboard = getDashboard(id);
    if (!dashboard) return sendJson(res, 404, { error: 'Dashboard not found' });
    return sendJson(res, 200, dashboard);
  }

  if (pathname.startsWith('/api/dashboards/') && method === 'PUT') {
    try {
      const id = pathname.slice('/api/dashboards/'.length);
      const body = await parseBody(req);
      body.id = id;
      const dashboard = saveDashboard(body);
      return sendJson(res, 200, dashboard);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (pathname.startsWith('/api/dashboards/') && method === 'DELETE') {
    const id = pathname.slice('/api/dashboards/'.length);
    if (deleteDashboard(id)) {
      return sendJson(res, 200, { deleted: true });
    }
    return sendJson(res, 404, { error: 'Dashboard not found' });
  }

  // Serve static files
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }

  // 404
  sendJson(res, 404, { error: 'Not found' });
}

// ============================================================
// Server
// ============================================================
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('Request error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`🏗️  Dashboard Builder running at http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/`);
  console.log(`   Dashboards stored in: ${DASHBOARDS_DIR}`);
});
