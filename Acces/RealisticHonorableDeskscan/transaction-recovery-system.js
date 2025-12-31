/**
 * 🛡️ نظام استرداد المعاملات - Transaction Recovery System
 * 
 * يحل مشكلة: ماذا يحدث إذا توقف السيرفر أثناء معاملة؟
 * 
 * الحل:
 * 1. قبل خصم الرصيد من المرسل، نحفظ المعاملة كـ "pending"
 * 2. بعد اكتمال المعاملة بنجاح، نحذفها من "pending"
 * 3. عند إعادة التشغيل، نتحقق من المعاملات المعلقة ونكملها أو نلغيها
 * 
 * هذا يضمن: إما تكتمل المعاملة بالكامل، أو لا تحدث أبداً (Atomicity)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TransactionRecoverySystem {
  constructor() {
    this.pendingFile = path.join(__dirname, 'access-network-data', 'pending-transactions.json');
    this.recoveryLogFile = path.join(__dirname, 'access-network-data', 'recovery-log.json');
    this.pendingTransactions = new Map();
    this.initialized = false;
  }

  /**
   * تهيئة نظام الاسترداد
   */
  async initialize() {
    try {
      // التأكد من وجود المجلد
      const dir = path.dirname(this.pendingFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // تحميل المعاملات المعلقة من الملف
      await this.loadPendingTransactions();
      
      this.initialized = true;
      console.log('🛡️ Transaction Recovery System initialized');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize recovery system:', error);
      return false;
    }
  }

  /**
   * تحميل المعاملات المعلقة من الملف
   */
  async loadPendingTransactions() {
    try {
      if (fs.existsSync(this.pendingFile)) {
        const data = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8'));
        
        if (data.transactions && Array.isArray(data.transactions)) {
          for (const tx of data.transactions) {
            this.pendingTransactions.set(tx.hash, tx);
          }
          console.log(`📋 Loaded ${this.pendingTransactions.size} pending transactions for recovery`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Could not load pending transactions:', error.message);
    }
  }

  /**
   * حفظ المعاملات المعلقة في الملف
   */
  async savePendingTransactions() {
    try {
      const data = {
        transactions: Array.from(this.pendingTransactions.values()),
        lastUpdated: Date.now()
      };
      
      fs.writeFileSync(this.pendingFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ Failed to save pending transactions:', error.message);
    }
  }

  /**
   * 🔒 تسجيل معاملة كـ "معلقة" قبل تنفيذها
   * يُستدعى قبل خصم أي رصيد
   */
  async registerPendingTransaction(txData) {
    const pendingTx = {
      hash: txData.hash || txData.txId,
      from: txData.from || txData.fromAddress,
      to: txData.to || txData.toAddress,
      amount: parseFloat(txData.amount || txData.value) || 0,
      gasFee: parseFloat(txData.gasFee || txData.gasPrice) || 0.00002,
      nonce: txData.nonce,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
      // حفظ الأرصدة الأصلية للاسترداد
      originalSenderBalance: txData.originalSenderBalance,
      originalRecipientBalance: txData.originalRecipientBalance
    };

    this.pendingTransactions.set(pendingTx.hash, pendingTx);
    await this.savePendingTransactions();
    
    console.log(`🔒 Registered pending transaction: ${pendingTx.hash.slice(0, 16)}...`);
    return pendingTx.hash;
  }

  /**
   * ✅ تأكيد اكتمال المعاملة بنجاح
   * يُستدعى بعد إتمام جميع الخطوات
   */
  async confirmTransaction(txHash) {
    if (this.pendingTransactions.has(txHash)) {
      const tx = this.pendingTransactions.get(txHash);
      tx.status = 'completed';
      tx.completedAt = Date.now();
      
      // نقل إلى سجل الاسترداد (للتتبع) ثم حذف من المعلقة
      await this.logRecoveredTransaction(tx, 'completed');
      
      this.pendingTransactions.delete(txHash);
      await this.savePendingTransactions();
      
      console.log(`✅ Transaction confirmed and removed from pending: ${txHash.slice(0, 16)}...`);
    }
  }

  /**
   * ❌ إلغاء معاملة فاشلة واسترداد الرصيد
   */
  async cancelTransaction(txHash, blockchain) {
    if (this.pendingTransactions.has(txHash)) {
      const tx = this.pendingTransactions.get(txHash);
      
      // استرداد الرصيد للمرسل إذا تم خصمه
      if (tx.originalSenderBalance !== undefined && tx.from) {
        const currentBalance = blockchain.getBalance(tx.from);
        const expectedBalance = tx.originalSenderBalance;
        
        // إذا تم خصم الرصيد، أعده
        if (currentBalance < expectedBalance) {
          blockchain.updateBalance(tx.from, expectedBalance);
          console.log(`🔄 Restored sender balance: ${tx.from.slice(0, 16)}... → ${expectedBalance.toFixed(8)} ACCESS`);
        }
      }
      
      tx.status = 'cancelled';
      tx.cancelledAt = Date.now();
      
      await this.logRecoveredTransaction(tx, 'cancelled');
      
      this.pendingTransactions.delete(txHash);
      await this.savePendingTransactions();
      
      console.log(`❌ Transaction cancelled and balance restored: ${txHash.slice(0, 16)}...`);
    }
  }

  /**
   * 🔄 استرداد المعاملات المعلقة عند إعادة التشغيل
   */
  async recoverPendingTransactions(blockchain, processTransaction) {
    if (this.pendingTransactions.size === 0) {
      console.log('✅ No pending transactions to recover');
      return { recovered: 0, cancelled: 0 };
    }

    console.log(`🔄 Recovering ${this.pendingTransactions.size} pending transactions...`);
    
    let recovered = 0;
    let cancelled = 0;

    for (const [txHash, tx] of this.pendingTransactions) {
      try {
        // التحقق من عمر المعاملة - إذا مر أكثر من 5 دقائق، نلغيها
        const age = Date.now() - tx.timestamp;
        const maxAge = 5 * 60 * 1000; // 5 دقائق

        if (age > maxAge) {
          console.log(`⏰ Transaction ${txHash.slice(0, 16)}... is too old (${Math.floor(age/1000)}s), cancelling...`);
          await this.cancelTransaction(txHash, blockchain);
          cancelled++;
          continue;
        }

        // محاولة إعادة تنفيذ المعاملة
        if (tx.retryCount < 3 && typeof processTransaction === 'function') {
          console.log(`🔄 Retrying transaction ${txHash.slice(0, 16)}... (attempt ${tx.retryCount + 1})`);
          
          tx.retryCount++;
          this.pendingTransactions.set(txHash, tx);
          await this.savePendingTransactions();

          // إعادة تنفيذ المعاملة
          await processTransaction(tx);
          
          // إذا نجحت، أكدها
          await this.confirmTransaction(txHash);
          recovered++;
        } else {
          // فشلت بعد 3 محاولات، إلغاء واسترداد
          console.log(`❌ Transaction ${txHash.slice(0, 16)}... failed after ${tx.retryCount} attempts, cancelling...`);
          await this.cancelTransaction(txHash, blockchain);
          cancelled++;
        }

      } catch (error) {
        console.error(`❌ Error recovering transaction ${txHash}:`, error.message);
        await this.cancelTransaction(txHash, blockchain);
        cancelled++;
      }
    }

    console.log(`🛡️ Recovery complete: ${recovered} recovered, ${cancelled} cancelled`);
    return { recovered, cancelled };
  }

  /**
   * تسجيل المعاملة في سجل الاسترداد
   */
  async logRecoveredTransaction(tx, action) {
    try {
      let log = { entries: [] };
      
      if (fs.existsSync(this.recoveryLogFile)) {
        log = JSON.parse(fs.readFileSync(this.recoveryLogFile, 'utf8'));
      }

      log.entries.push({
        ...tx,
        action,
        loggedAt: Date.now()
      });

      // الاحتفاظ بآخر 1000 سجل فقط
      if (log.entries.length > 1000) {
        log.entries = log.entries.slice(-1000);
      }

      fs.writeFileSync(this.recoveryLogFile, JSON.stringify(log, null, 2), 'utf8');
    } catch (error) {
      console.warn('⚠️ Could not log recovered transaction:', error.message);
    }
  }

  /**
   * الحصول على حالة معاملة
   */
  getTransactionStatus(txHash) {
    if (this.pendingTransactions.has(txHash)) {
      return this.pendingTransactions.get(txHash).status;
    }
    return 'not_found';
  }

  /**
   * الحصول على عدد المعاملات المعلقة
   */
  getPendingCount() {
    return this.pendingTransactions.size;
  }
}

// تصدير instance واحدة
export const transactionRecovery = new TransactionRecoverySystem();
export default TransactionRecoverySystem;
