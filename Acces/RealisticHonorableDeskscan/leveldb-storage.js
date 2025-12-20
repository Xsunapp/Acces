
// نظام تخزين احترافي يحاكي LevelDB/RocksDB للبلوكتشين
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class LevelDBStyleStorage {
  constructor(dbPath = './network-leveldb') {
    this.dbPath = dbPath;
    this.manifestFile = path.join(dbPath, 'MANIFEST');
    this.currentFile = path.join(dbPath, 'CURRENT');
    this.logFile = path.join(dbPath, 'LOG');
    this.sstFiles = new Map(); // Sorted String Tables
    this.memTable = new Map(); // في الذاكرة قبل الكتابة
    this.wal = []; // Write-Ahead Log
    this.compactionThreshold = 100; // عدد الكتابات قبل الضغط
    this.writeCount = 0;
    
    this.initializeLevelDB();
  }

  // تهيئة قاعدة البيانات على طريقة LevelDB
  initializeLevelDB() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        fs.mkdirSync(this.dbPath, { recursive: true });
      }

      // إنشاء ملفات النظام الأساسية
      this.createManifest();
      this.createCurrentFile();
      this.initializeLog();
      
      // تحميل البيانات الموجودة
      this.loadExistingData();
      
      console.log('🗄️ LevelDB-style storage initialized');
      console.log(`📁 Database path: ${this.dbPath}`);
    } catch (error) {
      console.error('❌ Error initializing LevelDB storage:', error);
    }
  }

  // إنشاء ملف MANIFEST (مثل LevelDB الحقيقي)
  createManifest() {
    const manifest = {
      version: 1,
      next_file_number: 1,
      last_sequence: 0,
      log_number: 1,
      prev_log_number: 0,
      levels: {
        0: [], // Level 0 files
        1: [], // Level 1 files
        2: []  // Level 2 files
      },
      created_at: Date.now(),
      comparator: 'leveldb.BytewiseComparator'
    };

    fs.writeFileSync(this.manifestFile, JSON.stringify(manifest, null, 2));
  }

  // إنشاء ملف CURRENT
  createCurrentFile() {
    fs.writeFileSync(this.currentFile, 'MANIFEST\n');
  }

  // تهيئة ملف LOG
  initializeLog() {
    const logEntry = `${new Date().toISOString()} - LevelDB-style storage initialized\n`;
    fs.writeFileSync(this.logFile, logEntry);
  }

  // كتابة مفتاح-قيمة (مثل LevelDB)
  async put(key, value) {
    try {
      const timestamp = Date.now();
      const sequenceNumber = this.getNextSequence();
      
      // إضافة إلى Write-Ahead Log
      const walEntry = {
        operation: 'PUT',
        key: key,
        value: value,
        sequence: sequenceNumber,
        timestamp: timestamp
      };
      
      this.wal.push(walEntry);
      
      // إضافة إلى MemTable
      this.memTable.set(key, {
        value: value,
        sequence: sequenceNumber,
        timestamp: timestamp,
        deleted: false
      });

      this.writeCount++;
      
      // فلاش إلى القرص إذا وصلنا للعتبة
      if (this.writeCount >= this.compactionThreshold) {
        await this.flushMemTable();
      }

      // كتابة WAL إلى القرص
      await this.persistWAL();
      
      return true;
    } catch (error) {
      console.error('❌ Error in PUT operation:', error);
      return false;
    }
  }

  // قراءة قيمة (مثل LevelDB)
  async get(key) {
    try {
      // البحث في MemTable أولاً (أحدث البيانات)
      if (this.memTable.has(key)) {
        const entry = this.memTable.get(key);
        if (!entry.deleted) {
          return entry.value;
        }
        return null; // محذوف
      }

      // البحث في SST files (من الأحدث للأقدم)
      for (const [level, files] of Object.entries(this.getManifest().levels)) {
        for (const file of files.reverse()) {
          const value = await this.searchInSSTFile(file, key);
          if (value !== null) {
            return value;
          }
        }
      }

      return null; // غير موجود
    } catch (error) {
      console.error('❌ Error in GET operation:', error);
      return null;
    }
  }

  // حذف مفتاح (مثل LevelDB)
  async delete(key) {
    return await this.put(key, null); // Tombstone deletion
  }

  // فلاش MemTable إلى SST file
  async flushMemTable() {
    try {
      if (this.memTable.size === 0) return;

      const sstFileName = `${this.getNextFileNumber()}.sst`;
      const sstPath = path.join(this.dbPath, sstFileName);
      
      // تحويل MemTable إلى مصفوفة مرتبة
      const sortedEntries = Array.from(this.memTable.entries())
        .sort(([a], [b]) => a.localeCompare(b));

      // إنشاء SST file
      const sstData = {
        type: 'sst',
        version: 1,
        entries: sortedEntries.map(([key, entry]) => ({
          key: key,
          value: entry.value,
          sequence: entry.sequence,
          timestamp: entry.timestamp,
          deleted: entry.deleted
        })),
        metadata: {
          smallest_key: sortedEntries[0][0],
          largest_key: sortedEntries[sortedEntries.length - 1][0],
          file_size: 0,
          entry_count: sortedEntries.length,
          created_at: Date.now()
        }
      };

      // كتابة إلى القرص
      const sstContent = JSON.stringify(sstData, null, 2);
      fs.writeFileSync(sstPath, sstContent);
      sstData.metadata.file_size = Buffer.byteLength(sstContent);

      // تحديث MANIFEST
      this.updateManifest(sstFileName, sstData.metadata);

      // مسح MemTable و WAL
      this.memTable.clear();
      this.wal = [];
      this.writeCount = 0;

      this.log(`Flushed MemTable to ${sstFileName}: ${sortedEntries.length} entries`);
      
      // تشغيل compaction إذا لزم الأمر
      await this.maybeCompact();

    } catch (error) {
      console.error('❌ Error flushing MemTable:', error);
    }
  }

  // ضغط الملفات (مثل LevelDB Compaction)
  async maybeCompact() {
    try {
      const manifest = this.getManifest();
      
      // إذا كان لدينا أكثر من 4 ملفات في Level 0
      if (manifest.levels[0].length > 4) {
        await this.compactLevel0();
      }
    } catch (error) {
      console.error('❌ Error in compaction:', error);
    }
  }

  // ضغط Level 0
  async compactLevel0() {
    try {
      const manifest = this.getManifest();
      const level0Files = manifest.levels[0];
      
      if (level0Files.length < 2) return;

      // دمج الملفات
      const mergedEntries = new Map();
      
      for (const fileName of level0Files) {
        const sstData = await this.loadSSTFile(fileName);
        if (sstData) {
          for (const entry of sstData.entries) {
            if (!entry.deleted) {
              mergedEntries.set(entry.key, entry);
            }
          }
        }
      }

      // إنشاء ملف جديد في Level 1
      if (mergedEntries.size > 0) {
        const newFileName = `${this.getNextFileNumber()}.sst`;
        const newSSTData = {
          type: 'sst',
          version: 1,
          entries: Array.from(mergedEntries.values()),
          metadata: {
            smallest_key: Math.min(...Array.from(mergedEntries.keys())),
            largest_key: Math.max(...Array.from(mergedEntries.keys())),
            entry_count: mergedEntries.size,
            created_at: Date.now()
          }
        };

        // كتابة الملف الجديد
        const newSSTPath = path.join(this.dbPath, newFileName);
        fs.writeFileSync(newSSTPath, JSON.stringify(newSSTData, null, 2));

        // تحديث MANIFEST
        manifest.levels[1].push(newFileName);
        
        // حذف ملفات Level 0 القديمة
        for (const oldFile of level0Files) {
          try {
            fs.unlinkSync(path.join(this.dbPath, oldFile));
          } catch (error) {
            console.warn(`⚠️ Could not delete old SST file: ${oldFile}`);
          }
        }
        
        manifest.levels[0] = [];
        this.updateManifestFile(manifest);

        this.log(`Compacted ${level0Files.length} files from Level 0 to Level 1: ${newFileName}`);
      }
    } catch (error) {
      console.error('❌ Error in Level 0 compaction:', error);
    }
  }

  // البحث في ملف SST
  async searchInSSTFile(fileName, key) {
    try {
      const sstData = await this.loadSSTFile(fileName);
      if (!sstData) return null;

      // Binary search في الـ entries المرتبة
      const entries = sstData.entries;
      let left = 0;
      let right = entries.length - 1;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const entry = entries[mid];

        if (entry.key === key) {
          return entry.deleted ? null : entry.value;
        } else if (entry.key < key) {
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      }

      return null;
    } catch (error) {
      console.error(`❌ Error searching in SST file ${fileName}:`, error);
      return null;
    }
  }

  // تحميل ملف SST
  async loadSSTFile(fileName) {
    try {
      const sstPath = path.join(this.dbPath, fileName);
      if (!fs.existsSync(sstPath)) return null;

      const sstContent = fs.readFileSync(sstPath, 'utf8');
      return JSON.parse(sstContent);
    } catch (error) {
      console.error(`❌ Error loading SST file ${fileName}:`, error);
      return null;
    }
  }

  // كتابة WAL إلى القرص
  async persistWAL() {
    try {
      if (this.wal.length === 0) return;

      const walPath = path.join(this.dbPath, 'WAL');
      const walContent = this.wal.map(entry => JSON.stringify(entry)).join('\n') + '\n';
      
      fs.appendFileSync(walPath, walContent);
    } catch (error) {
      console.error('❌ Error persisting WAL:', error);
    }
  }

  // وظائف مساعدة
  getManifest() {
    try {
      return JSON.parse(fs.readFileSync(this.manifestFile, 'utf8'));
    } catch (error) {
      console.error('❌ Error reading manifest:', error);
      return { levels: { 0: [], 1: [], 2: [] } };
    }
  }

  updateManifest(fileName, metadata) {
    try {
      const manifest = this.getManifest();
      manifest.levels[0].push(fileName);
      manifest.next_file_number = (manifest.next_file_number || 1) + 1;
      manifest.last_sequence = (manifest.last_sequence || 0) + 1;
      
      this.updateManifestFile(manifest);
    } catch (error) {
      console.error('❌ Error updating manifest:', error);
    }
  }

  updateManifestFile(manifest) {
    fs.writeFileSync(this.manifestFile, JSON.stringify(manifest, null, 2));
  }

  getNextFileNumber() {
    const manifest = this.getManifest();
    return manifest.next_file_number || 1;
  }

  getNextSequence() {
    const manifest = this.getManifest();
    return (manifest.last_sequence || 0) + 1;
  }

  loadExistingData() {
    try {
      // تحميل WAL إذا موجود
      const walPath = path.join(this.dbPath, 'WAL');
      if (fs.existsSync(walPath)) {
        const walContent = fs.readFileSync(walPath, 'utf8');
        const lines = walContent.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.operation === 'PUT') {
              this.memTable.set(entry.key, {
                value: entry.value,
                sequence: entry.sequence,
                timestamp: entry.timestamp,
                deleted: false
              });
            }
          } catch (parseError) {
            console.warn('⚠️ Invalid WAL entry:', line);
          }
        }
      }

      console.log(`🔄 Loaded ${this.memTable.size} entries from WAL`);
    } catch (error) {
      console.error('❌ Error loading existing data:', error);
    }
  }

  log(message) {
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    fs.appendFileSync(this.logFile, logEntry);
  }

  // إحصائيات النظام
  getStats() {
    try {
      const manifest = this.getManifest();
      const memTableSize = this.memTable.size;
      const walSize = this.wal.length;
      
      let totalSSTFiles = 0;
      let totalEntries = 0;
      
      for (const files of Object.values(manifest.levels)) {
        totalSSTFiles += files.length;
      }

      return {
        storage_type: 'LevelDB-style',
        database_path: this.dbPath,
        memtable_entries: memTableSize,
        wal_entries: walSize,
        sst_files: totalSSTFiles,
        levels: manifest.levels,
        write_count: this.writeCount,
        compaction_threshold: this.compactionThreshold,
        health: 'healthy'
      };
    } catch (error) {
      console.error('❌ Error getting stats:', error);
      return { storage_type: 'LevelDB-style', health: 'error' };
    }
  }

  // إغلاق قاعدة البيانات بأمان
  async close() {
    try {
      // فلاش MemTable النهائي
      if (this.memTable.size > 0) {
        await this.flushMemTable();
      }

      // كتابة WAL الأخير
      await this.persistWAL();

      this.log('Database closed safely');
      console.log('🔒 LevelDB-style storage closed safely');
    } catch (error) {
      console.error('❌ Error closing database:', error);
    }
  }
}

// واجهة البلوكتشين مع التخزين الاحترافي
class ProfessionalBlockchainStorage {
  constructor() {
    this.db = new LevelDBStyleStorage('./network-leveldb');
    this.blockPrefix = 'block:';
    this.statePrefix = 'state:';
    this.txPrefix = 'tx:';
    this.accountPrefix = 'account:';
  }

  // حفظ block مع مفاتيح مرتبة
  async saveBlock(block) {
    try {
      const blockKey = `${this.blockPrefix}${block.index.toString().padStart(10, '0')}`;
      const blockData = {
        ...block,
        storage_type: 'leveldb_style',
        persisted_at: Date.now()
      };

      await this.db.put(blockKey, JSON.stringify(blockData));
      
      // حفظ فهرس للوصول السريع
      await this.db.put('latest_block_index', block.index.toString());
      
      console.log(`💾 Block ${block.index} saved to LevelDB-style storage`);
      return true;
    } catch (error) {
      console.error(`❌ Error saving block ${block.index}:`, error);
      return false;
    }
  }

  // حفظ حالة الحسابات
  async saveAccountState(address, balance) {
    try {
      const accountKey = `${this.accountPrefix}${address}`;
      const accountData = {
        address: address,
        balance: balance,
        updated_at: Date.now(),
        storage_type: 'leveldb_style'
      };

      await this.db.put(accountKey, JSON.stringify(accountData));
      return true;
    } catch (error) {
      console.error(`❌ Error saving account state for ${address}:`, error);
      return false;
    }
  }

  // حفظ معاملة
  async saveTransaction(transaction) {
    try {
      const txKey = `${this.txPrefix}${transaction.hash}`;
      const txData = {
        ...transaction,
        storage_type: 'leveldb_style',
        persisted_at: Date.now()
      };

      await this.db.put(txKey, JSON.stringify(txData));
      
      // فهرسة بالعنوان للوصول السريع
      const fromTxsKey = `address_txs:${transaction.from}`;
      const toTxsKey = `address_txs:${transaction.to}`;
      
      // إضافة إلى قائمة معاملات المرسل والمستقبل
      await this.addToAddressTransactions(fromTxsKey, transaction.hash);
      await this.addToAddressTransactions(toTxsKey, transaction.hash);
      
      return true;
    } catch (error) {
      console.error(`❌ Error saving transaction ${transaction.hash}:`, error);
      return false;
    }
  }

  // تحميل البلوكتشين الكامل
  async loadBlockchain() {
    try {
      const latestIndexStr = await this.db.get('latest_block_index');
      if (!latestIndexStr) {
        console.log('📋 No blockchain data found in LevelDB storage');
        return { blocks: [], accounts: {}, transactions: [] };
      }

      const latestIndex = parseInt(latestIndexStr);
      const blocks = [];
      const accounts = {};

      // تحميل جميع الـ blocks
      for (let i = 0; i <= latestIndex; i++) {
        const blockKey = `${this.blockPrefix}${i.toString().padStart(10, '0')}`;
        const blockDataStr = await this.db.get(blockKey);
        
        if (blockDataStr) {
          const blockData = JSON.parse(blockDataStr);
          blocks.push(blockData);
        }
      }

      console.log(`📚 Loaded ${blocks.length} blocks from LevelDB-style storage`);
      
      return {
        blocks: blocks,
        accounts: accounts,
        storage_type: 'leveldb_style',
        loaded_at: Date.now()
      };
    } catch (error) {
      console.error('❌ Error loading blockchain from LevelDB storage:', error);
      return { blocks: [], accounts: {}, transactions: [] };
    }
  }

  // إضافة معاملة إلى قائمة عنوان
  async addToAddressTransactions(addressTxsKey, txHash) {
    try {
      const existingTxsStr = await this.db.get(addressTxsKey) || '[]';
      const existingTxs = JSON.parse(existingTxsStr);
      
      if (!existingTxs.includes(txHash)) {
        existingTxs.push(txHash);
        await this.db.put(addressTxsKey, JSON.stringify(existingTxs));
      }
    } catch (error) {
      console.error(`❌ Error adding transaction to address list:`, error);
    }
  }

  // الحصول على إحصائيات متقدمة
  getAdvancedStats() {
    const dbStats = this.db.getStats();
    
    return {
      ...dbStats,
      blockchain_specific: {
        block_prefix: this.blockPrefix,
        state_prefix: this.statePrefix,
        tx_prefix: this.txPrefix,
        account_prefix: this.accountPrefix
      },
      performance: {
        compaction_needed: this.db.writeCount >= this.db.compactionThreshold,
        memory_usage: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  }

  // إغلاق آمن
  async close() {
    await this.db.close();
  }
}

export { LevelDBStyleStorage, ProfessionalBlockchainStorage };
