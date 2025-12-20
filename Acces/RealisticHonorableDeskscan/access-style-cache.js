
// 🚀 ACCESS-STYLE IN-MEMORY CACHE - يدعم ملايين المستخدمين
// مثل Redis لكن بدون تثبيت external services

class AccessStyleCache {
  constructor() {
    // 💾 Multi-tier cache (مثل Binance تماماً)
    this.L1Cache = new Map(); // Hot data - أسرع وصول
    this.L2Cache = new Map(); // Warm data - وصول سريع
    this.L3Cache = new Map(); // Cold data - أرشيف مؤقت
    
    // ⚙️ Cache configuration
    this.L1_MAX_SIZE = 10000; // 10K أكثر العناوين نشاطاً
    this.L2_MAX_SIZE = 50000; // 50K عناوين متوسطة النشاط
    this.L3_MAX_SIZE = 100000; // 100K عناوين أرشيف
    
    // ⏱️ TTL (Time To Live)
    this.L1_TTL = 60000; // دقيقة واحدة
    this.L2_TTL = 300000; // 5 دقائق
    this.L3_TTL = 900000; // 15 دقيقة
    
    // 📊 Statistics
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    
    // 🔄 Auto cleanup
    this.startAutoCleanup();
    
    console.log('🚀 Access-style multi-tier cache initialized');
    console.log('📊 Total capacity: ' + (this.L1_MAX_SIZE + this.L2_MAX_SIZE + this.L3_MAX_SIZE) + ' entries');
  }
  
  // 💰 Get balance (with tier fallback)
  getBalance(address) {
    const normalizedAddr = address.toLowerCase();
    
    // L1 lookup (fastest)
    if (this.L1Cache.has(normalizedAddr)) {
      const entry = this.L1Cache.get(normalizedAddr);
      if (!this.isExpired(entry, this.L1_TTL)) {
        this.hits++;
        entry.lastAccess = Date.now();
        return entry.balance;
      }
      this.L1Cache.delete(normalizedAddr);
    }
    
    // L2 lookup
    if (this.L2Cache.has(normalizedAddr)) {
      const entry = this.L2Cache.get(normalizedAddr);
      if (!this.isExpired(entry, this.L2_TTL)) {
        this.hits++;
        // Promote to L1 (hot promotion)
        this.setBalance(normalizedAddr, entry.balance, 'L1');
        this.L2Cache.delete(normalizedAddr);
        return entry.balance;
      }
      this.L2Cache.delete(normalizedAddr);
    }
    
    // L3 lookup
    if (this.L3Cache.has(normalizedAddr)) {
      const entry = this.L3Cache.get(normalizedAddr);
      if (!this.isExpired(entry, this.L3_TTL)) {
        this.hits++;
        // Promote to L2
        this.setBalance(normalizedAddr, entry.balance, 'L2');
        this.L3Cache.delete(normalizedAddr);
        return entry.balance;
      }
      this.L3Cache.delete(normalizedAddr);
    }
    
    this.misses++;
    return null;
  }
  
  // 💾 Set balance (intelligent tier placement)
  setBalance(address, balance, preferredTier = 'L1') {
    const normalizedAddr = address.toLowerCase();
    
    const entry = {
      balance: parseFloat(balance),
      timestamp: Date.now(),
      lastAccess: Date.now(),
      accessCount: 1
    };
    
    // Smart tier placement
    if (preferredTier === 'L1' || this.L1Cache.size < this.L1_MAX_SIZE) {
      if (this.L1Cache.size >= this.L1_MAX_SIZE) {
        this.evictLRU(this.L1Cache, 'L2');
      }
      this.L1Cache.set(normalizedAddr, entry);
    } else if (preferredTier === 'L2' || this.L2Cache.size < this.L2_MAX_SIZE) {
      if (this.L2Cache.size >= this.L2_MAX_SIZE) {
        this.evictLRU(this.L2Cache, 'L3');
      }
      this.L2Cache.set(normalizedAddr, entry);
    } else {
      if (this.L3Cache.size >= this.L3_MAX_SIZE) {
        this.evictLRU(this.L3Cache, null);
      }
      this.L3Cache.set(normalizedAddr, entry);
    }
  }
  
  // 🗑️ LRU eviction (Least Recently Used)
  evictLRU(cache, demoteTo) {
    let oldestKey = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      const evictedEntry = cache.get(oldestKey);
      cache.delete(oldestKey);
      
      // Demote to lower tier if specified
      if (demoteTo === 'L2') {
        this.L2Cache.set(oldestKey, evictedEntry);
      } else if (demoteTo === 'L3') {
        this.L3Cache.set(oldestKey, evictedEntry);
      }
      
      this.evictions++;
    }
  }
  
  // ⏱️ Check if entry expired
  isExpired(entry, ttl) {
    return (Date.now() - entry.timestamp) > ttl;
  }
  
  // 🧹 Auto cleanup expired entries
  startAutoCleanup() {
    setInterval(() => {
      this.cleanupExpired(this.L1Cache, this.L1_TTL);
      this.cleanupExpired(this.L2Cache, this.L2_TTL);
      this.cleanupExpired(this.L3Cache, this.L3_TTL);
    }, 60000); // كل دقيقة
  }
  
  cleanupExpired(cache, ttl) {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of cache.entries()) {
      if ((now - entry.timestamp) > ttl) {
        cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log('🧹 Cleaned ' + cleaned + ' expired entries');
    }
  }
  
  // 📊 Get cache statistics
  getStats() {
    const totalSize = this.L1Cache.size + this.L2Cache.size + this.L3Cache.size;
    const hitRate = this.hits + this.misses > 0 
      ? (this.hits / (this.hits + this.misses) * 100).toFixed(2)
      : 0;
    
    return {
      hitRate: hitRate + '%',
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      totalEntries: totalSize,
      L1: this.L1Cache.size,
      L2: this.L2Cache.size,
      L3: this.L3Cache.size,
      capacity: totalSize + '/' + (this.L1_MAX_SIZE + this.L2_MAX_SIZE + this.L3_MAX_SIZE)
    };
  }
  
  // 🔄 Invalidate cache for address
  invalidate(address) {
    const normalizedAddr = address.toLowerCase();
    this.L1Cache.delete(normalizedAddr);
    this.L2Cache.delete(normalizedAddr);
    this.L3Cache.delete(normalizedAddr);
  }
  
  // 🗑️ Clear all cache
  clear() {
    this.L1Cache.clear();
    this.L2Cache.clear();
    this.L3Cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    console.log('🗑️ All cache tiers cleared');
  }
}

// Export singleton instance
const accessCache = new AccessStyleCache();
export default accessCache;
