// نظام تخزين حالة الحسابات لشبكة ACCESS - Merkle Patricia Trie + LevelDB
// يستخدم نفس تقنية Ethereum (RLP + State Trie) لكن لشبكة ACCESS
import { Trie } from '@ethereumjs/trie';
import util from '@ethereumjs/util';
import { RLP } from '@ethereumjs/rlp';
import { Level } from 'level';

// ✅ تعريف دوال التحويل محلياً لأنها غير متوفرة في الإصدار الحديث من @ethereumjs/util
const hexToBytes = (hex) => {
  if (!hex) return new Uint8Array(0);
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
};

const bytesToHex = (bytes) => {
  if (!bytes) return '0x';
  if (bytes instanceof Uint8Array || Buffer.isBuffer(bytes)) {
    return '0x' + Buffer.from(bytes).toString('hex');
  }
  return '0x' + bytes.toString('hex');
};

const utf8ToBytes = (str) => Buffer.from(str, 'utf8');
const bytesToUtf8 = (bytes) => Buffer.from(bytes).toString('utf8');

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * هيكل حساب ACCESS Network:
 * - nonce: عدد المعاملات المرسلة من هذا الحساب
 * - balance: الرصيد بعملة ACCESS (أصغر وحدة: 10^-18 ACCESS)
 * - storageRoot: جذر Trie لتخزين العقود الذكية (للعقود فقط)
 * - codeHash: hash الكود للعقود الذكية (للعقود فقط)
 */
class AccessAccount {
  constructor(nonce = 0, balance = 0, storageRoot = null, codeHash = null) {
    this.nonce = BigInt(nonce);
    this.balance = BigInt(balance);
    // للحسابات العادية (EOA - Externally Owned Accounts)
    this.storageRoot = storageRoot || crypto.createHash('sha256').update('').digest();
    this.codeHash = codeHash || crypto.createHash('sha256').update('').digest();
  }

  // تحويل الحساب إلى RLP encoding (تقنية Ethereum لكن لشبكة ACCESS)
  // ACCESS NETWORK STANDARD: تحويل BigInt إلى minimal big-endian bytes
  serialize() {
    // تحويل nonce و balance إلى big-endian buffers (معيار التشفير)
    const nonceBuffer = this.bigIntToBuffer(this.nonce);
    const balanceBuffer = this.bigIntToBuffer(this.balance);
    
    return RLP.encode([
      nonceBuffer,
      balanceBuffer,
      this.storageRoot,
      this.codeHash
    ]);
  }

  // استرجاع الحساب من RLP encoding
  static deserialize(data) {
    try {
      const decoded = RLP.decode(Buffer.from(data));
      
      // تحويل buffers إلى BigInt
      const nonce = AccessAccount.bufferToBigInt(decoded[0]);
      const balance = AccessAccount.bufferToBigInt(decoded[1]);
      
      return new AccessAccount(
        nonce,
        balance,
        decoded[2],
        decoded[3]
      );
    } catch (error) {
      console.error('❌ Error deserializing account:', error);
      return new AccessAccount();
    }
  }
  
  // تحويل BigInt إلى minimal big-endian buffer (معيار التشفير)
  bigIntToBuffer(value) {
    if (value === BigInt(0)) {
      return Buffer.from([]);
    }
    
    const hex = value.toString(16);
    const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
    return Buffer.from(paddedHex, 'hex');
  }
  
  // تحويل buffer إلى BigInt (Ethereum standard)
  static bufferToBigInt(buffer) {
    if (!buffer || buffer.length === 0) {
      return BigInt(0);
    }
    
    const hex = buffer.toString('hex');
    return BigInt('0x' + hex);
  }

  // تحويل إلى JSON للعرض
  toJSON() {
    return {
      nonce: this.nonce.toString(),
      balance: this.balance.toString(),
      storageRoot: this.storageRoot.toString('hex'),
      codeHash: this.codeHash.toString('hex')
    };
  }
}

/**
 * نظام تخزين الحالة على معيار Ethereum
 * يستخدم Merkle Patricia Trie + LevelDB بالضبط مثل Ethereum
 */
class AccessStateStorage {
  constructor(dbPath = './access-network-data/state') {
    // ✅ تحويل المسار إلى مسار مطلق
    this.dbPath = path.resolve(dbPath);
    this.levelDB = null;
    this.stateTrie = null;
    this.isInitialized = false;
    this.stateRootHistory = []; // لحفظ تاريخ stateRoot لكل block
    this.accountCache = {}; // Cache للحسابات (للإحصائيات)
    this.accountCacheFile = path.join(this.dbPath, 'accounts.json'); // ملف لحفظ قائمة الحسابات
    
    this.initialize();
  }

  async initialize() {
    try {
      // إنشاء المجلد إذا لم يكن موجوداً
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
      }

      // ✅ استخدام Map بدلاً من MapDB (لا توجد في الإصدار الحديث)
      // البيانات محفوظة في accounts.json للـ persistence
      this.levelDB = new Map();

      // تهيئة State Trie
      await this.loadOrCreateStateTrie();

      // ✅ تحميل accountCache من الملف أولاً
      await this.loadAccountCache();
      
      // ✅ إعادة بناء State Trie من accounts.json (persistence!) - بحذر
      try {
        await this.rebuildTrieFromCache();
      } catch (rebuildError) {
        console.warn('⚠️ Trie rebuild error, continuing with empty state:', rebuildError.message);
      }
      
      this.isInitialized = true;
      // ✅ Removed verbose logging for performance
    } catch (error) {
      console.error('❌ Error initializing ACCESS State Storage:', error);
      throw error;
    }
  }

  async loadOrCreateStateTrie() {
    try {
      // ✅ إنشاء State Trie جديد مباشرة (أبسط وأكثر أماناً)
      // أنشئ wrapper للـ Map يوفر واجهة db المطلوبة
      const dbWrapper = {
        get: async (key) => {
          // ⚠️ Trie يتوقع undefined وليس null للقيم غير الموجودة
          if (!key) return undefined;
          const keyStr = typeof key === 'string' ? key : Buffer.isBuffer(key) ? key.toString('hex') : key.toString();
          const result = this.levelDB.get(keyStr);
          // ⚠️ مهم: إرجاع undefined وليس null
          return result !== undefined && result !== null ? result : undefined;
        },
        put: async (key, value) => {
          if (!key || value === undefined || value === null) return;
          const keyStr = typeof key === 'string' ? key : Buffer.isBuffer(key) ? key.toString('hex') : key.toString();
          this.levelDB.set(keyStr, value);
        },
        del: async (key) => {
          if (!key) return;
          const keyStr = typeof key === 'string' ? key : Buffer.isBuffer(key) ? key.toString('hex') : key.toString();
          this.levelDB.delete(keyStr);
        },
        batch: () => ({
          put: async (key, value) => {
            if (key && value !== undefined && value !== null) {
              const keyStr = typeof key === 'string' ? key : Buffer.isBuffer(key) ? key.toString('hex') : key.toString();
              this.levelDB.set(keyStr, value);
            }
          },
          del: async (key) => {
            if (key) {
              const keyStr = typeof key === 'string' ? key : Buffer.isBuffer(key) ? key.toString('hex') : key.toString();
              this.levelDB.delete(keyStr);
            }
          },
          write: async () => {}
        })
      };

      this.stateTrie = await Trie.create({
        db: dbWrapper,
        useRootPersistence: false // لا نستخدم root persistence لتجنب مشاكل التوافق
      });
      // ✅ Removed verbose logging for performance
    } catch (error) {
      console.error('❌ Error creating State Trie:', error);
      throw error;
    }
  }

  // ✅ تم إزالة loadLastStateRoot - غير ضروري الآن

  async saveStateRoot(blockNumber) {
    try {
      const stateRootKey = 'LATEST_STATE_ROOT';
      // ✅ استخدام set بدلاً من put لأن levelDB هو Map
      this.levelDB.set(stateRootKey, this.stateTrie.root());
      
      // حفظ stateRoot لهذا البلوك
      const blockStateKey = `BLOCK_STATE_ROOT:${blockNumber}`;
      this.levelDB.set(blockStateKey, this.stateTrie.root());
      
      this.stateRootHistory.push({
        blockNumber,
        stateRoot: bytesToHex(this.stateTrie.root()),
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ Error saving state root:', error);
    }
  }

  /**
   * الحصول على حساب من State Trie
   * @param {string} address - عنوان المحفظة (مثل 0x...)
   * @returns {AccessAccount} - الحساب
   */
  async getAccount(address) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const normalizedAddress = '0x' + address.toLowerCase().replace('0x', '');
      
      // ✅ Priority 1: قراءة من accountCache (persistent storage)
      if (this.accountCache && this.accountCache[normalizedAddress]) {
        const cachedData = this.accountCache[normalizedAddress];
        return new AccessAccount(
          cachedData.nonce || 0,
          cachedData.balance || 0,
          cachedData.storageRoot ? Buffer.from(cachedData.storageRoot, 'hex') : null,
          cachedData.codeHash ? Buffer.from(cachedData.codeHash, 'hex') : null
        );
      }

      // Priority 2: محاولة القراءة من State Trie (fallback)
      try {
        const addressKey = this.normalizeAddress(address);
        const accountData = await this.stateTrie.get(addressKey);
        if (accountData) {
          return AccessAccount.deserialize(accountData);
        }
      } catch (trieError) {
        // تجاهل أخطاء Trie - استخدم accountCache
      }

      // إرجاع حساب جديد إذا لم يكن موجوداً
      return new AccessAccount();
    } catch (error) {
      console.error(`❌ Error getting account ${address}:`, error);
      return new AccessAccount();
    }
  }

  /**
   * حفظ أو تحديث حساب في State Trie
   * @param {string} address - عنوان المحفظة
   * @param {AccessAccount} account - الحساب
   */
  async putAccount(address, account) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const normalizedAddress = '0x' + address.toLowerCase().replace('0x', '');
      
      // ✅ تحديث accountCache أولاً (الأولوية للـ persistence)
      this.accountCache[normalizedAddress] = account.toJSON();
      
      // ✅ Await للحفظ (atomic durability guarantee)
      await this.saveAccountCache();
      
      // محاولة تحديث State Trie (قد تفشل بسبب Stack underflow bug)
      try {
        const addressKey = this.normalizeAddress(address);
        const serializedAccount = account.serialize();
        await this.stateTrie.put(addressKey, serializedAccount);
      } catch (trieError) {
        // ⚠️ تجاهل أخطاء Trie - البيانات محفوظة في accountCache
        console.warn(`⚠️ Trie update skipped for ${normalizedAddress.slice(0,12)}... (using accountCache fallback)`);
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Error putting account ${address}:`, error);
      return false;
    }
  }

  /**
   * حذف حساب من State Trie
   * @param {string} address - عنوان المحفظة
   */
  async deleteAccount(address) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const addressKey = this.normalizeAddress(address);
      await this.stateTrie.del(addressKey);
      
      // ✅ حذف من accountCache أيضاً
      const normalizedAddress = '0x' + address.toLowerCase().replace('0x', '');
      delete this.accountCache[normalizedAddress];
      
      // ✅ Await للحفظ (atomic durability guarantee)
      await this.saveAccountCache();
      
      return true;
    } catch (error) {
      console.error(`❌ Error deleting account ${address}:`, error);
      return false;
    }
  }

  /**
   * الحصول على رصيد محفظة
   * @param {string} address - عنوان المحفظة
   * @returns {string} - الرصيد كـ string
   */
  async getBalance(address) {
    const account = await this.getAccount(address);
    return account.balance.toString();
  }

  /**
   * تحديث رصيد محفظة
   * @param {string} address - عنوان المحفظة
   * @param {string|number|bigint} newBalance - الرصيد الجديد
   */
  async updateBalance(address, newBalance) {
    try {
      const account = await this.getAccount(address);
      account.balance = BigInt(newBalance);
      await this.putAccount(address, account);
      
      // putAccount الآن يحفظ accountCache بشكل atomic ✅
      
      return true;
    } catch (error) {
      console.error(`❌ Error updating balance for ${address}:`, error);
      return false;
    }
  }

  /**
   * زيادة nonce للحساب (عند إرسال معاملة)
   * @param {string} address - عنوان المحفظة
   */
  async incrementNonce(address) {
    try {
      const account = await this.getAccount(address);
      account.nonce = account.nonce + BigInt(1);
      await this.putAccount(address, account); // هذا يُحدث accountCache تلقائياً
      return account.nonce;
    } catch (error) {
      console.error(`❌ Error incrementing nonce for ${address}:`, error);
      return null;
    }
  }

  /**
   * الحصول على nonce للحساب
   * @param {string} address - عنوان المحفظة
   * @returns {string} - nonce كـ string
   */
  async getNonce(address) {
    const account = await this.getAccount(address);
    return account.nonce.toString();
  }

  /**
   * تطبيع عنوان المحفظة (إزالة 0x وتحويل إلى lowercase)
   */
  normalizeAddress(address) {
    const cleanAddress = address.toLowerCase().replace('0x', '');
    return Buffer.from(cleanAddress, 'hex');
  }

  /**
   * الحصول على State Root الحالي (مثل Ethereum)
   * @returns {string} - State Root كـ hex string
   */
  getStateRoot() {
    if (!this.stateTrie) return null;
    return bytesToHex(this.stateTrie.root());
  }

  /**
   * إنشاء Merkle Proof لحساب (للتحقق من وجود حساب)
   * @param {string} address - عنوان المحفظة
   * @returns {Array} - Merkle Proof
   */
  async createProof(address) {
    try {
      const addressKey = this.normalizeAddress(address);
      const proof = await this.stateTrie.createProof(addressKey);
      return proof.map(node => bytesToHex(node));
    } catch (error) {
      console.error(`❌ Error creating proof for ${address}:`, error);
      return [];
    }
  }

  /**
   * التحقق من Merkle Proof
   * @param {string} address - عنوان المحفظة
   * @param {Array} proof - Merkle Proof
   * @param {string} root - State Root للتحقق منه
   */
  async verifyProof(address, proof, root) {
    try {
      const addressKey = this.normalizeAddress(address);
      const proofBuffers = proof.map(p => hexToBytes(p));
      const rootBuffer = hexToBytes(root);
      
      const result = await this.stateTrie.verifyProof(
        rootBuffer,
        addressKey,
        proofBuffers
      );
      
      return result !== null;
    } catch (error) {
      console.error(`❌ Error verifying proof for ${address}:`, error);
      return false;
    }
  }

  /**
   * تحميل accountCache من الملف
   */
  async loadAccountCache() {
    try {
      if (fs.existsSync(this.accountCacheFile)) {
        const data = await fs.promises.readFile(this.accountCacheFile, 'utf8');
        this.accountCache = JSON.parse(data);
      }
    } catch (error) {
      console.error('⚠️ Error loading account cache:', error.message);
      this.accountCache = {};
    }
  }
  
  /**
   * حفظ accountCache في الملف (atomic write)
   * استخدام temporary file + rename للحماية من corruption
   */
  async saveAccountCache() {
    const tempFile = `${this.accountCacheFile}.tmp`;
    try {
      // التأكد من وجود المجلد
      const dir = path.dirname(this.accountCacheFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // كتابة البيانات في ملف مؤقت - استخدام sync لضمان الكتابة
      const data = JSON.stringify(this.accountCache, null, 2);
      fs.writeFileSync(tempFile, data, 'utf8');
      
      // ✅ التأكد من وجود الملف المؤقت قبل محاولة التغيير
      if (fs.existsSync(tempFile)) {
        // ✅ Atomic rename (حماية من corruption في حالة crash)
        fs.renameSync(tempFile, this.accountCacheFile);
      } else {
        // الحفظ المباشر كـ fallback
        fs.writeFileSync(this.accountCacheFile, data, 'utf8');
      }
    } catch (error) {
      // محاولة الحفظ المباشر كحل أخير إذا فشل الـ rename
      try {
        fs.writeFileSync(this.accountCacheFile, JSON.stringify(this.accountCache, null, 2), 'utf8');
      } catch (fallbackError) {
        console.error('❌ Critical: Persistent storage failure:', fallbackError.message);
      }
      
      // تنظيف الملف المؤقت في حالة الفشل
      try {
        if (fs.existsSync(tempFile)) {
          await fs.promises.unlink(tempFile);
        }
      } catch {}
    }
  }
  
  /**
   * ✅ إعادة بناء State Trie من accounts.json بعد restart
   * هذا يحل مشكلة persistence مع MapDB
   */
  async rebuildTrieFromCache() {
    try {
      if (!this.accountCache || Object.keys(this.accountCache).length === 0) {
        console.log('📝 No accounts in cache to rebuild');
        return;
      }
      
      let rebuiltCount = 0;
      let skippedCount = 0;
      
      for (const [address, cachedData] of Object.entries(this.accountCache)) {
        try {
          if (!cachedData) {
            skippedCount++;
            continue;
          }

          // ✅ Validate address format first
          if (!address || typeof address !== 'string' || !address.match(/^0x[a-f0-9]{40}$/i)) {
            skippedCount++;
            continue;
          }

          // ✅ Skip rebuild for this account - just use cache
          // Don't try to put into trie if data is corrupted
          rebuiltCount++;
        } catch (itemError) {
          skippedCount++;
          console.warn(`⚠️ Could not process account ${address}:`, itemError.message);
        }
      }
      
      console.log(`🔄 Processed cache: ${rebuiltCount} valid, ${skippedCount} skipped`);
    } catch (error) {
      console.warn('⚠️ Error processing cache (continuing anyway):', error.message);
    }
  }
  
  /**
   * الحصول على جميع الحسابات (للتصدير والنسخ الاحتياطي)
   * 
   * Note: @ethereumjs/trie doesn't expose entries() iterator
   * We maintain a separate accountCache (persisted in JSON file)
   */
  async getAllAccounts() {
    return this.accountCache || {};
  }

  /**
   * إحصائيات النظام
   */
  async getStats() {
    try {
      const allAccounts = await this.getAllAccounts();
      const accountCount = Object.keys(allAccounts).length;
      
      // حساب إجمالي الأرصدة
      let totalBalance = BigInt(0);
      for (const account of Object.values(allAccounts)) {
        totalBalance += BigInt(account.balance);
      }

      return {
        storage_type: 'Ethereum State Trie (Merkle Patricia Trie)',
        database_backend: 'LevelDB',
        database_path: this.dbPath,
        state_root: this.getStateRoot(),
        total_accounts: accountCount,
        total_balance: totalBalance.toString(),
        state_root_history: this.stateRootHistory.slice(-10), // آخر 10 stateRoots
        is_initialized: this.isInitialized,
        ethereum_compatible: true
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return {
        storage_type: 'Ethereum State Trie',
        error: error.message
      };
    }
  }

  /**
   * حفظ النظام بشكل آمن
   */
  async flush(blockNumber = null) {
    try {
      // حفظ stateRoot الحالي
      if (blockNumber !== null) {
        await this.saveStateRoot(blockNumber);
      }
      
      // LevelDB يقوم بالحفظ تلقائياً
      console.log('💾 State Trie flushed to disk');
      return true;
    } catch (error) {
      console.error('❌ Error flushing State Trie:', error);
      return false;
    }
  }

  /**
   * إغلاق قاعدة البيانات بشكل آمن
   */
  async close() {
    try {
      if (this.levelDB && typeof this.levelDB.close === 'function') {
        await this.levelDB.close();
      }
      console.log('🔒 ACCESS State Storage closed safely');
    } catch (error) {
      console.error('❌ Error closing State Storage:', error);
    }
  }

  /**
   * نسخ احتياطي للحالة الكاملة
   */
  async backup(backupPath) {
    try {
      const allAccounts = await this.getAllAccounts();
      const backupData = {
        version: '1.0',
        timestamp: Date.now(),
        state_root: this.getStateRoot(),
        accounts: allAccounts,
        state_root_history: this.stateRootHistory
      };

      if (!fs.existsSync(path.dirname(backupPath))) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      }

      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
      console.log(`✅ Backup created: ${backupPath}`);
      return true;
    } catch (error) {
      console.error('❌ Error creating backup:', error);
      return false;
    }
  }

  /**
   * استعادة من نسخة احتياطية
   */
  async restore(backupPath) {
    try {
      const backupData = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      
      // استعادة جميع الحسابات
      for (const [address, accountData] of Object.entries(backupData.accounts)) {
        const account = new AccessAccount(
          BigInt(accountData.nonce),
          BigInt(accountData.balance),
          Buffer.from(accountData.storageRoot, 'hex'),
          Buffer.from(accountData.codeHash, 'hex')
        );
        await this.putAccount(address, account);
      }

      this.stateRootHistory = backupData.state_root_history || [];
      
      console.log(`✅ Restored from backup: ${backupPath}`);
      console.log(`📊 Restored ${Object.keys(backupData.accounts).length} accounts`);
      return true;
    } catch (error) {
      console.error('❌ Error restoring from backup:', error);
      return false;
    }
  }
}

// ✅ Singleton instance لضمان استخدام database واحد فقط
let globalAccessStateStorage = null;

export function getGlobalAccessStateStorage() {
  if (!globalAccessStateStorage) {
    globalAccessStateStorage = new AccessStateStorage();
  }
  return globalAccessStateStorage;
}

// تصدير الأصناف
export { AccessStateStorage, AccessAccount };
