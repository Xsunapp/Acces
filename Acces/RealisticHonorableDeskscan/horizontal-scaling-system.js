// =============================================
// 🌐 ACCESS Network - Horizontal Scaling System
// نظام التوسع الأفقي للملايين
// =============================================

import cluster from 'cluster';
import os from 'os';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import http from 'http';

// =============================================
// 1️⃣ Intelligent Cluster Manager
// إدارة ذكية للعمليات المتوازية
// =============================================

class IntelligentClusterManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.numWorkers = options.workers || os.cpus().length;
    this.workers = new Map();
    this.workerStats = new Map();
    this.maxRestarts = options.maxRestarts || 10;
    this.restartWindow = options.restartWindow || 60000;
    this.restartHistory = new Map();
    
    // موازنة الأحمال
    this.loadBalancer = {
      algorithm: options.algorithm || 'least-connections',
      currentWorkerIndex: 0
    };
    
    // Auto-scaling
    this.autoScale = {
      enabled: options.autoScale !== false,
      minWorkers: options.minWorkers || 2,
      maxWorkers: options.maxWorkers || os.cpus().length * 2,
      scaleUpThreshold: options.scaleUpThreshold || 80, // CPU %
      scaleDownThreshold: options.scaleDownThreshold || 30,
      cooldownMs: options.cooldownMs || 60000,
      lastScaleTime: 0
    };
  }
  
  // بدء الـ Cluster
  start(workerScript) {
    if (!cluster.isPrimary) {
      return this.runWorker(workerScript);
    }
    
    console.log(`🚀 Primary ${process.pid} starting cluster...`);
    console.log(`📊 Spawning ${this.numWorkers} workers`);
    
    // إنشاء Workers
    for (let i = 0; i < this.numWorkers; i++) {
      this.spawnWorker();
    }
    
    // مراقبة Workers
    cluster.on('exit', (worker, code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });
    
    cluster.on('message', (worker, message) => {
      this.handleWorkerMessage(worker, message);
    });
    
    // Auto-scaling
    if (this.autoScale.enabled) {
      setInterval(() => this.checkAutoScale(), 10000);
    }
    
    // تقارير دورية
    setInterval(() => this.reportStats(), 30000);
    
    return this;
  }
  
  // إنشاء Worker جديد
  spawnWorker() {
    const worker = cluster.fork();
    
    this.workers.set(worker.id, {
      worker,
      pid: worker.process.pid,
      startedAt: Date.now(),
      connections: 0,
      requests: 0,
      errors: 0,
      cpu: 0,
      memory: 0
    });
    
    console.log(`✅ Worker ${worker.id} (PID: ${worker.process.pid}) spawned`);
    
    return worker;
  }
  
  // معالجة خروج Worker
  handleWorkerExit(worker, code, signal) {
    const workerInfo = this.workers.get(worker.id);
    this.workers.delete(worker.id);
    
    console.warn(`⚠️ Worker ${worker.id} died (${signal || code})`);
    
    // تتبع إعادات التشغيل
    const now = Date.now();
    const restarts = this.restartHistory.get(worker.id) || [];
    const recentRestarts = restarts.filter(t => now - t < this.restartWindow);
    
    if (recentRestarts.length < this.maxRestarts) {
      recentRestarts.push(now);
      this.restartHistory.set(worker.id, recentRestarts);
      
      console.log(`🔄 Restarting worker (attempt ${recentRestarts.length}/${this.maxRestarts})`);
      this.spawnWorker();
    } else {
      console.error(`❌ Worker ${worker.id} exceeded restart limit`);
      this.emit('worker:failed', worker.id);
    }
  }
  
  // معالجة رسائل Workers
  handleWorkerMessage(worker, message) {
    if (message.type === 'stats') {
      const workerInfo = this.workers.get(worker.id);
      if (workerInfo) {
        workerInfo.connections = message.connections || 0;
        workerInfo.requests = message.requests || 0;
        workerInfo.cpu = message.cpu || 0;
        workerInfo.memory = message.memory || 0;
      }
    }
    
    if (message.type === 'broadcast') {
      this.broadcast(message.data, worker.id);
    }
  }
  
  // البث لجميع Workers
  broadcast(data, excludeWorkerId = null) {
    for (const [id, info] of this.workers) {
      if (id !== excludeWorkerId) {
        info.worker.send({ type: 'broadcast', data });
      }
    }
  }
  
  // Auto-scaling
  checkAutoScale() {
    if (!this.autoScale.enabled) return;
    
    const now = Date.now();
    if (now - this.autoScale.lastScaleTime < this.autoScale.cooldownMs) {
      return;
    }
    
    const avgCpu = this.getAverageCpu();
    const currentWorkers = this.workers.size;
    
    if (avgCpu > this.autoScale.scaleUpThreshold && 
        currentWorkers < this.autoScale.maxWorkers) {
      console.log(`📈 Scaling UP: CPU at ${avgCpu.toFixed(1)}%`);
      this.spawnWorker();
      this.autoScale.lastScaleTime = now;
    } else if (avgCpu < this.autoScale.scaleDownThreshold && 
               currentWorkers > this.autoScale.minWorkers) {
      console.log(`📉 Scaling DOWN: CPU at ${avgCpu.toFixed(1)}%`);
      this.gracefulShutdownWorker();
      this.autoScale.lastScaleTime = now;
    }
  }
  
  // إيقاف Worker بسلاسة
  gracefulShutdownWorker() {
    const leastBusy = this.getLeastBusyWorker();
    if (leastBusy) {
      leastBusy.worker.send({ type: 'shutdown' });
      leastBusy.worker.disconnect();
      console.log(`👋 Worker ${leastBusy.worker.id} shutting down gracefully`);
    }
  }
  
  // الحصول على Worker الأقل انشغالاً
  getLeastBusyWorker() {
    let leastBusy = null;
    let minConnections = Infinity;
    
    for (const [id, info] of this.workers) {
      if (info.connections < minConnections) {
        minConnections = info.connections;
        leastBusy = info;
      }
    }
    
    return leastBusy;
  }
  
  // متوسط CPU
  getAverageCpu() {
    let total = 0;
    let count = 0;
    
    for (const [id, info] of this.workers) {
      total += info.cpu;
      count++;
    }
    
    return count > 0 ? total / count : 0;
  }
  
  // اختيار Worker للطلب الجديد
  selectWorker() {
    switch (this.loadBalancer.algorithm) {
      case 'round-robin':
        return this.roundRobinSelect();
      case 'least-connections':
        return this.leastConnectionsSelect();
      case 'random':
        return this.randomSelect();
      default:
        return this.leastConnectionsSelect();
    }
  }
  
  roundRobinSelect() {
    const workers = Array.from(this.workers.values());
    if (workers.length === 0) return null;
    
    this.loadBalancer.currentWorkerIndex = 
      (this.loadBalancer.currentWorkerIndex + 1) % workers.length;
    return workers[this.loadBalancer.currentWorkerIndex];
  }
  
  leastConnectionsSelect() {
    return this.getLeastBusyWorker();
  }
  
  randomSelect() {
    const workers = Array.from(this.workers.values());
    if (workers.length === 0) return null;
    return workers[Math.floor(Math.random() * workers.length)];
  }
  
  // تقرير الإحصائيات
  reportStats() {
    const stats = this.getStats();
    console.log('📊 CLUSTER STATS:', JSON.stringify(stats, null, 2));
    this.emit('stats', stats);
  }
  
  getStats() {
    const workers = Array.from(this.workers.values()).map(w => ({
      id: w.worker.id,
      pid: w.pid,
      uptime: Math.floor((Date.now() - w.startedAt) / 1000),
      connections: w.connections,
      requests: w.requests,
      cpu: w.cpu,
      memory: w.memory
    }));
    
    return {
      primary: process.pid,
      workerCount: this.workers.size,
      totalConnections: workers.reduce((sum, w) => sum + w.connections, 0),
      totalRequests: workers.reduce((sum, w) => sum + w.requests, 0),
      avgCpu: this.getAverageCpu(),
      workers
    };
  }
  
  // تشغيل Worker
  runWorker(workerScript) {
    let stats = {
      connections: 0,
      requests: 0
    };
    
    // إرسال إحصائيات للـ Primary
    setInterval(() => {
      const usage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      process.send({
        type: 'stats',
        connections: stats.connections,
        requests: stats.requests,
        memory: Math.round(usage.heapUsed / 1024 / 1024),
        cpu: (cpuUsage.user + cpuUsage.system) / 1000000
      });
    }, 5000);
    
    // الاستماع للرسائل
    process.on('message', (message) => {
      if (message.type === 'shutdown') {
        console.log(`Worker ${process.pid} shutting down...`);
        process.exit(0);
      }
    });
    
    return {
      incrementConnections: () => stats.connections++,
      decrementConnections: () => stats.connections--,
      incrementRequests: () => stats.requests++
    };
  }
}

// =============================================
// 2️⃣ Request Router with Sticky Sessions
// موجه الطلبات مع جلسات ثابتة
// =============================================

class StickySessionRouter {
  constructor(options = {}) {
    this.sessions = new Map();
    this.sessionTTL = options.sessionTTL || 3600000; // 1 ساعة
    this.hashFunction = options.hashFunction || 'consistent';
  }
  
  // الحصول على Worker للجلسة
  getWorkerForSession(sessionId, workers) {
    if (!sessionId) {
      return this.hashSelect(crypto.randomUUID(), workers);
    }
    
    // تحقق من وجود تعيين سابق
    const cached = this.sessions.get(sessionId);
    if (cached && cached.expiry > Date.now()) {
      const worker = workers.find(w => w.id === cached.workerId);
      if (worker) return worker;
    }
    
    // تعيين جديد
    const worker = this.hashSelect(sessionId, workers);
    if (worker) {
      this.sessions.set(sessionId, {
        workerId: worker.id,
        expiry: Date.now() + this.sessionTTL
      });
    }
    
    return worker;
  }
  
  // Consistent hashing
  hashSelect(key, workers) {
    if (workers.length === 0) return null;
    
    const hash = crypto.createHash('md5').update(key).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % workers.length;
    return workers[index];
  }
  
  // تنظيف الجلسات المنتهية
  cleanup() {
    const now = Date.now();
    for (const [sessionId, data] of this.sessions) {
      if (data.expiry < now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

// =============================================
// 3️⃣ Inter-Process Communication (IPC) Hub
// مركز الاتصال بين العمليات
// =============================================

class IPCHub extends EventEmitter {
  constructor() {
    super();
    this.channels = new Map();
    this.messageBuffer = [];
    this.maxBufferSize = 10000;
  }
  
  // إرسال رسالة لـ Worker محدد
  send(workerId, type, data) {
    const message = {
      id: crypto.randomUUID(),
      from: process.pid,
      to: workerId,
      type,
      data,
      timestamp: Date.now()
    };
    
    if (cluster.isPrimary) {
      const worker = cluster.workers[workerId];
      if (worker) {
        worker.send(message);
        return true;
      }
    } else {
      process.send({ ...message, to: 'primary' });
    }
    
    return false;
  }
  
  // البث لجميع Workers
  broadcast(type, data, excludePid = null) {
    const message = {
      id: crypto.randomUUID(),
      from: process.pid,
      type: 'broadcast',
      data: { type, data },
      timestamp: Date.now()
    };
    
    if (cluster.isPrimary) {
      for (const id in cluster.workers) {
        if (cluster.workers[id].process.pid !== excludePid) {
          cluster.workers[id].send(message);
        }
      }
    } else {
      process.send({ ...message, to: 'all' });
    }
  }
  
  // طلب/استجابة
  async request(workerId, type, data, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      
      const timeoutId = setTimeout(() => {
        this.off(requestId);
        reject(new Error('Request timeout'));
      }, timeout);
      
      this.once(requestId, (response) => {
        clearTimeout(timeoutId);
        resolve(response);
      });
      
      this.send(workerId, type, { requestId, ...data });
    });
  }
  
  // معالجة الرسائل الواردة
  handleMessage(message) {
    if (message.data?.requestId) {
      this.emit(message.data.requestId, message.data);
    }
    
    this.emit(message.type, message);
    this.emit('message', message);
  }
  
  // الاشتراك في قناة
  subscribe(channel, handler) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel).add(handler);
    
    return () => this.unsubscribe(channel, handler);
  }
  
  unsubscribe(channel, handler) {
    if (this.channels.has(channel)) {
      this.channels.get(channel).delete(handler);
    }
  }
  
  // نشر في قناة
  publish(channel, data) {
    if (this.channels.has(channel)) {
      this.channels.get(channel).forEach(handler => handler(data));
    }
    this.broadcast('channel:' + channel, data);
  }
}

// =============================================
// 4️⃣ Distributed Lock Manager
// إدارة الأقفال الموزعة
// =============================================

class DistributedLockManager {
  constructor(options = {}) {
    this.locks = new Map();
    this.lockTimeout = options.lockTimeout || 30000;
    this.waitTimeout = options.waitTimeout || 10000;
    this.waitQueue = new Map();
  }
  
  // اكتساب قفل
  async acquire(resource, holder = process.pid) {
    return new Promise((resolve, reject) => {
      const lock = this.locks.get(resource);
      
      if (!lock || lock.expiry < Date.now()) {
        // القفل متاح
        this.locks.set(resource, {
          holder,
          acquiredAt: Date.now(),
          expiry: Date.now() + this.lockTimeout
        });
        resolve(true);
        return;
      }
      
      if (lock.holder === holder) {
        // تجديد القفل
        lock.expiry = Date.now() + this.lockTimeout;
        resolve(true);
        return;
      }
      
      // الانتظار في الطابور
      if (!this.waitQueue.has(resource)) {
        this.waitQueue.set(resource, []);
      }
      
      const waitEntry = {
        holder,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.removeFromQueue(resource, holder);
          reject(new Error('Lock wait timeout'));
        }, this.waitTimeout)
      };
      
      this.waitQueue.get(resource).push(waitEntry);
    });
  }
  
  // تحرير قفل
  release(resource, holder = process.pid) {
    const lock = this.locks.get(resource);
    
    if (lock && lock.holder === holder) {
      this.locks.delete(resource);
      
      // إعطاء القفل للتالي في الطابور
      const queue = this.waitQueue.get(resource);
      if (queue && queue.length > 0) {
        const next = queue.shift();
        clearTimeout(next.timeout);
        
        this.locks.set(resource, {
          holder: next.holder,
          acquiredAt: Date.now(),
          expiry: Date.now() + this.lockTimeout
        });
        
        next.resolve(true);
      }
      
      return true;
    }
    
    return false;
  }
  
  removeFromQueue(resource, holder) {
    const queue = this.waitQueue.get(resource);
    if (queue) {
      const index = queue.findIndex(e => e.holder === holder);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  }
  
  // تنفيذ مع قفل
  async withLock(resource, callback) {
    await this.acquire(resource);
    try {
      return await callback();
    } finally {
      this.release(resource);
    }
  }
  
  // تنظيف الأقفال المنتهية
  cleanup() {
    const now = Date.now();
    for (const [resource, lock] of this.locks) {
      if (lock.expiry < now) {
        this.release(resource, lock.holder);
      }
    }
  }
}

// =============================================
// 5️⃣ Graceful Shutdown Manager
// إدارة الإيقاف السلس
// =============================================

class GracefulShutdownManager {
  constructor(options = {}) {
    this.shutdownTimeout = options.shutdownTimeout || 30000;
    this.handlers = [];
    this.isShuttingDown = false;
    
    this.setupSignalHandlers();
  }
  
  setupSignalHandlers() {
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n📛 Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
      });
    });
    
    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught Exception:', error);
      await this.shutdown(1);
    });
    
    process.on('unhandledRejection', async (reason) => {
      console.error('❌ Unhandled Rejection:', reason);
      await this.shutdown(1);
    });
  }
  
  // تسجيل handler للإيقاف
  registerHandler(name, handler, priority = 0) {
    this.handlers.push({ name, handler, priority });
    this.handlers.sort((a, b) => b.priority - a.priority);
  }
  
  // تنفيذ الإيقاف
  async shutdown(exitCode = 0) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log('🛑 Starting graceful shutdown...');
    
    const timeout = setTimeout(() => {
      console.error('⚠️ Shutdown timeout, forcing exit');
      process.exit(1);
    }, this.shutdownTimeout);
    
    try {
      for (const { name, handler } of this.handlers) {
        console.log(`   ⏳ Shutting down: ${name}...`);
        try {
          await Promise.race([
            handler(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Handler timeout')), 10000)
            )
          ]);
          console.log(`   ✅ ${name} shutdown complete`);
        } catch (error) {
          console.error(`   ❌ ${name} shutdown error:`, error.message);
        }
      }
      
      clearTimeout(timeout);
      console.log('👋 Graceful shutdown complete');
      process.exit(exitCode);
    } catch (error) {
      console.error('Shutdown error:', error);
      clearTimeout(timeout);
      process.exit(1);
    }
  }
}

// =============================================
// 6️⃣ المنسق الرئيسي للتوسع الأفقي
// =============================================

class HorizontalScalingSystem {
  constructor() {
    this.clusterManager = null;
    this.stickyRouter = null;
    this.ipcHub = null;
    this.lockManager = null;
    this.shutdownManager = null;
    this.initialized = false;
  }
  
  async initialize(options = {}) {
    console.log('🌐 Initializing Horizontal Scaling System...');
    
    // 1. Cluster Manager
    this.clusterManager = new IntelligentClusterManager({
      workers: options.workers || os.cpus().length,
      autoScale: options.autoScale !== false,
      minWorkers: options.minWorkers || 2,
      maxWorkers: options.maxWorkers || os.cpus().length * 2
    });
    
    // 2. Sticky Session Router
    this.stickyRouter = new StickySessionRouter({
      sessionTTL: options.sessionTTL || 3600000
    });
    
    // 3. IPC Hub
    this.ipcHub = new IPCHub();
    
    // 4. Lock Manager
    this.lockManager = new DistributedLockManager({
      lockTimeout: options.lockTimeout || 30000
    });
    
    // 5. Shutdown Manager
    this.shutdownManager = new GracefulShutdownManager({
      shutdownTimeout: options.shutdownTimeout || 30000
    });
    
    // تسجيل handlers الإيقاف
    this.registerShutdownHandlers();
    
    // تنظيف دوري
    setInterval(() => {
      this.stickyRouter.cleanup();
      this.lockManager.cleanup();
    }, 60000);
    
    this.initialized = true;
    
    console.log('✅ Horizontal Scaling System ready!');
    console.log(`   🖥️ CPUs: ${os.cpus().length}`);
    console.log(`   📊 Auto-scale: ${options.autoScale !== false ? 'enabled' : 'disabled'}`);
    console.log(`   🔒 Distributed locks: enabled`);
    console.log(`   🛑 Graceful shutdown: enabled`);
    
    return this;
  }
  
  registerShutdownHandlers() {
    this.shutdownManager.registerHandler('IPC Hub', async () => {
      this.ipcHub.broadcast('shutdown', { reason: 'system_shutdown' });
    }, 100);
    
    this.shutdownManager.registerHandler('Lock Manager', async () => {
      // تحرير جميع الأقفال
      for (const [resource] of this.lockManager.locks) {
        this.lockManager.release(resource, process.pid);
      }
    }, 50);
  }
  
  // بدء الـ Cluster
  start(workerScript) {
    return this.clusterManager.start(workerScript);
  }
  
  // الحصول على Worker للجلسة
  getWorkerForSession(sessionId) {
    const workers = Array.from(this.clusterManager.workers.values());
    return this.stickyRouter.getWorkerForSession(sessionId, workers);
  }
  
  // البث لجميع Workers
  broadcast(type, data) {
    return this.ipcHub.broadcast(type, data);
  }
  
  // اكتساب قفل موزع
  async acquireLock(resource) {
    return this.lockManager.acquire(resource);
  }
  
  // تحرير قفل
  releaseLock(resource) {
    return this.lockManager.release(resource);
  }
  
  // تنفيذ مع قفل
  async withLock(resource, callback) {
    return this.lockManager.withLock(resource, callback);
  }
  
  // إحصائيات
  getStats() {
    return {
      cluster: this.clusterManager.getStats(),
      locks: {
        active: this.lockManager.locks.size,
        waiting: Array.from(this.lockManager.waitQueue.values())
          .reduce((sum, q) => sum + q.length, 0)
      },
      sessions: this.stickyRouter.sessions.size
    };
  }
}

// =============================================
// تصدير
// =============================================

const scalingSystem = new HorizontalScalingSystem();

export {
  IntelligentClusterManager,
  StickySessionRouter,
  IPCHub,
  DistributedLockManager,
  GracefulShutdownManager,
  HorizontalScalingSystem,
  scalingSystem
};

export default scalingSystem;
