import { pool } from './db.js';

/**
 * Server-Side Processing Synchronization Service
 * Updates all active processing sessions continuously, regardless of user presence
 */

/**
 * دالة تقريب المكافأة لتجنب الأرقام العشرية الطويلة (مثل 0.248883)
 * تقرب إلى 8 أماكن عشرية بشكل دقيق
 */
function roundReward(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return 0;
  }
  // تقريب إلى 8 أماكن عشرية
  return Math.round(amount * 100000000) / 100000000;
}

class ServerSideProcessingSync {
  constructor() {
    this.syncInterval = null;
    this.finalHourInterval = null;
    this.veryFinalInterval = null;
    this.syncFrequency = 3600000; // 60 minutes for general updates (further reduced load)
    this.finalHourFrequency = 1200000; // 20 minutes in final hour (further reduced)
    this.veryFinalFrequency = 600000; // 10 minutes in last 10 minutes (further reduced)
    this.isRunning = false;
    this.lastSyncTime = 0;
    this.minSyncGap = 1800000; // 30 minutes between updates (further increased)
    this.activeSessions = new Map();
    this.lastSessionCount = 0;
    this.quietMode = true; // Enable complete silent mode
    this.ultraQuietMode = true; // Ultra quiet mode
    this.maxConcurrentOperations = 1; // Further limit concurrent operations
    this.currentOperations = 0;
    this.skipCount = 0; // Track skipped operations
    this.maxSkips = 3; // Max skips before forcing update
    this.transactionCooldown = false; // Flag to pause processing sync after transactions
    this.cooldownTimer = null;
  }

  /**
   * Start the optimized processing sync service
   */
  start() {
    if (this.isRunning) {
      console.log('[OPTIMIZED PROCESSING] Sync service already running');
      return;
    }

    console.log('[OPTIMIZED PROCESSING] Starting optimized sync service...');
    this.isRunning = true;

    // Initial lightweight scan to identify active sessions
    this.scanActiveSessions();

    // Regular lightweight sync (every 10 minutes)
    this.syncInterval = setInterval(() => {
      const now = Date.now();
      if (now - this.lastSyncTime < this.minSyncGap) {
        return;
      }
      this.lastSyncTime = now;
      this.scanActiveSessions();
    }, this.syncFrequency);

    // Final hour intensive monitoring (every 5 minutes for sessions near completion)
    this.finalHourInterval = setInterval(() => {
      this.monitorFinalHourSessions();
    }, this.finalHourFrequency);

    // Very final minutes intensive monitoring (every minute for sessions in last 10 minutes)
    this.veryFinalInterval = setInterval(() => {
      this.monitorVeryFinalMinutes();
    }, this.veryFinalFrequency);

    console.log(`[OPTIMIZED PROCESSING] Smart sync started - General every ${this.syncFrequency / 60000} minutes, Final hour every ${this.finalHourFrequency / 60000} minutes, Last minutes every ${this.veryFinalFrequency / 1000} seconds`);
  }

  /**
   * Stop the optimized sync service
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.finalHourInterval) {
      clearInterval(this.finalHourInterval);
      this.finalHourInterval = null;
    }
    if (this.veryFinalInterval) {
      clearInterval(this.veryFinalInterval);
      this.veryFinalInterval = null;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.isRunning = false;
    this.activeSessions.clear();
    console.log('[OPTIMIZED PROCESSING] Smart sync stopped');
  }

  /**
   * تفعيل فترة هدوء بعد المعاملات لتجنب التضارب
   */
  startTransactionCooldown() {
    this.transactionCooldown = true;

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    // فترة هدوء لمدة 60 ثانية بعد المعاملات
    this.cooldownTimer = setTimeout(() => {
      this.transactionCooldown = false;
      console.log('[PROCESSING SYNC] Transaction cooldown ended, resuming normal operations');
    }, 60000);

    console.log('[PROCESSING SYNC] Transaction cooldown started - pausing processing sync for 60 seconds');
  }

  /**
   * مراقبة مكثفة جداً للدقائق الأخيرة (آخر 10 دقائق)
   */
  async monitorVeryFinalMinutes() {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60;
      const veryFinalThreshold = 10 * 60; // آخر 10 دقائق

      // جلب الجلسات في آخر 10 دقائق فقط
      const veryFinalSessions = await pool.query(
        `SELECT id, processing_start_time_seconds, name, accumulatedReward,
                COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
         FROM users 
         WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
         AND processing_start_time_seconds > 0
         AND (${nowSec} - processing_start_time_seconds) >= ${processingDuration - veryFinalThreshold}
         AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}`
      );

      if (veryFinalSessions.rows.length === 0) {
        return; // لا توجد جلسات في الدقائق الأخيرة
      }

      console.log(`[VERY FINAL] Intensive monitoring for ${veryFinalSessions.rows.length} sessions in last 10 minutes`);

      for (const session of veryFinalSessions.rows) {
        try {
          const userId = session.id;
          const startTimeSec = parseInt(session.processing_start_time_seconds);
          const elapsedSec = nowSec - startTimeSec;
          const remainingSec = Math.max(0, processingDuration - elapsedSec);

          // إذا انتهى التعدين تماماً
          if (remainingSec <= 0) {
            console.log(`[COMPLETION] Processing completion for user ${userId}`);
            await this.completeProcessingSession(userId);
            continue;
          }

          // تحديث مكثف للدقائق الأخيرة - USING LOCKED BOOST
          const progressPercentage = Math.min(1, elapsedSec / processingDuration);
          const boostMultiplier = parseFloat(session.locked_boost || 1.0);
          const baseReward = 0.25;
          const boostedReward = baseReward * boostMultiplier;
          // استخدام دالة التقريب لدقة الحساب
          const calculatedAccumulated = roundReward(boostedReward * progressPercentage);

          await pool.query(
            `UPDATE users SET 
             accumulatedReward = $1, 
             last_server_update = $2
             WHERE id = $3`,
            [calculatedAccumulated, nowSec, userId]
          );

          const remainingMinutes = Math.floor(remainingSec / 60);
          const remainingSeconds = remainingSec % 60;
          console.log(`[COUNTDOWN] User ${userId}: ${remainingMinutes}:${remainingSeconds.toString().padStart(2, '0')} remaining, Reward: ${calculatedAccumulated.toFixed(8)} ACCESS`);

        } catch (userError) {
          console.error(`Error processing final minutes for user ${session.id}:`, userError.message);
        }
      }

    } catch (error) {
      console.error('[VERY FINAL] Error monitoring final minutes:', error.message);
    }
  }

  /**
   * Lightweight scan to identify active sessions - يتم كل 10 دقائق
   */
  async scanActiveSessions() {
    try {
      // تخطي العملية إذا كانت في فترة الهدوء بعد المعاملات
      if (this.transactionCooldown) {
        console.log('[PROCESSING SYNC] Skipping scan during transaction cooldown');
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60; // 24 hours

      // Lightweight query for active sessions only مع حماية من انتهاء الوقت
      const activeSessions = await Promise.race([
        pool.query(
          `SELECT id, processing_start_time_seconds, name
           FROM users 
           WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
           AND processing_start_time_seconds > 0
           AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}
           LIMIT 100`
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Active sessions query timeout')), 15000)
        )
      ]);

      // Update active sessions list
      this.activeSessions.clear();

      for (const session of activeSessions.rows) {
        const userId = session.id;
        const startTimeSec = parseInt(session.processing_start_time_seconds);
        const elapsedSec = nowSec - startTimeSec;
        const remainingSec = processingDuration - elapsedSec;

        this.activeSessions.set(userId, {
          startTime: startTimeSec,
          remainingTime: remainingSec,
          userName: session.name,
          lastChecked: nowSec
        });
      }

      // تحديث أرصدة جميع المستخدمين النشطين (ليس فقط من هم على الصفحة)
      await this.updateAllActiveProcessors(nowSec);

      // Ultra quiet mode - suppress all session tracking messages
      this.lastSessionCount = this.activeSessions.size;

      // Remove expired sessions from tracking
      this.cleanupExpiredSessions(nowSec);

    } catch (error) {
      console.error('[OPTIMIZED PROCESSING] Session scan error:', error.message);
    }
  }

  /**
   * تحديث جميع المستخدمين النشطين في التعدين (حتى المنقطعين) مع حماية من انتهاء الوقت
   */
  async updateAllActiveProcessors(nowSec) {
    let client;
    try {
      const processingDuration = 24 * 60 * 60; // 24 hours

      // Get connection with timeout protection
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 10000)
        )
      ]);

      // جلب جميع المستخدمين النشطين في التعدين مع حماية من انتهاء الوقت
      const activeProcessors = await Promise.race([
        client.query(
          `SELECT id, processing_start_time_seconds, name, accumulatedReward, 
                  COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
           FROM users 
           WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
           AND processing_start_time_seconds > 0
           AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}
           LIMIT 50` // Limit results to prevent large queries
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 20000)
        )
      ]);

      if (activeProcessors.rows.length === 0) {
        return; // لا يوجد معدنون نشطون
      }

      console.log(`[BACKGROUND PROCESSING] Updating ${activeProcessors.rows.length} active processors in background`);

      // معالجة كل معدن بشكل منفصل مع حماية من انتهاء الوقت
      for (const processor of activeProcessors.rows) {
        try {
          await Promise.race([
            this.updateSingleProcessor(processor, nowSec, processingDuration),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Processor update timeout')), 5000)
            )
          ]);
        } catch (processorError) {
          if (processorError.message.includes('timeout')) {
            console.warn(`Timeout updating processor ${processor.id}, skipping...`);
          } else {
            console.error(`Error updating processor ${processor.id}:`, processorError.message);
          }
        }
      }

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn('[BACKGROUND PROCESSING] Database timeout, will retry next cycle');
      } else {
        console.error('[BACKGROUND PROCESSING] Error updating processors:', error.message);
      }
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError.message);
        }
      }
    }
  }

  /**
   * تحديث معدن واحد بناءً على الوقت المنقضي - USES LOCKED BOOST
   */
  async updateSingleProcessor(processor, nowSec, processingDuration) {
    const userId = processor.id;
    const startTimeSec = parseInt(processor.processing_start_time_seconds);
    const elapsedSec = nowSec - startTimeSec;
    const remainingSec = Math.max(0, processingDuration - elapsedSec);

    // إذا انتهى التعدين، أكمل الجلسة
    if (remainingSec <= 0) {
      await this.completeProcessingSession(userId);
      return;
    }

    // حساب التقدم
    const progressPercentage = Math.min(1, elapsedSec / processingDuration);

    // SMART BOOST: استخدام المضاعف المثبت من بداية الجلسة
    const boostMultiplier = parseFloat(processor.locked_boost || 1.0);

    // حساب المكافأة المتراكمة باستخدام المضاعف المثبت
    const baseReward = 0.25;
    const boostedReward = baseReward * boostMultiplier;
    // استخدام دالة التقريب لتجنب الأرقام العشرية الطويلة
    const calculatedAccumulated = roundReward(boostedReward * progressPercentage);

    const currentAccumulated = parseFloat(processor.accumulatedreward || 0);
    const difference = Math.abs(calculatedAccumulated - currentAccumulated);

    if (difference > 0.00001 || calculatedAccumulated > currentAccumulated) { // تحديث فقط عند وجود فرق ملحوظ
      await pool.query(
        `UPDATE users SET 
         accumulatedReward = $1,
         last_server_update = $2
         WHERE id = $3`,
        [calculatedAccumulated, nowSec, userId]
      );

      // تسجيل التحديث فقط للساعة الأخيرة وفقط للمبالغ المعقولة
      if (remainingSec <= 3600 && calculatedAccumulated >= 0.01) { // آخر ساعة
        console.log(`[FINAL HOUR] User ${userId}: ${calculatedAccumulated.toFixed(8)} ACCESS (${(progressPercentage * 100).toFixed(1)}% complete, ${boostMultiplier.toFixed(2)}x locked boost)`);
      }
    }
  }

  /**
   * مراقبة مكثفة للجلسات في الساعة الأخيرة فقط
   */
  async monitorFinalHourSessions() {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60;
      const finalHourThreshold = 60 * 60; // آخر ساعة
      const finalMinutesThreshold = 10 * 60; // آخر 10 دقائق

      // جلب جميع الجلسات في الساعة الأخيرة مباشرة من قاعدة البيانات
      const finalHourSessions = await pool.query(
        `SELECT id, processing_start_time_seconds, name, accumulatedReward,
                COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost
         FROM users 
         WHERE processing_active = 1 AND processing_start_time_seconds IS NOT NULL 
         AND processing_start_time_seconds > 0
         AND (${nowSec} - processing_start_time_seconds) >= ${processingDuration - finalHourThreshold}
         AND (${nowSec} - processing_start_time_seconds) < ${processingDuration}`
      );

      if (finalHourSessions.rows.length === 0) {
        return; // لا توجد جلسات في الساعة الأخيرة
      }

      console.log(`[FINAL HOUR] Intensive monitoring for ${finalHourSessions.rows.length} sessions in final hour`);

      // تحديث مكثف للجلسات في الساعة الأخيرة
      const updates = [];

      for (const session of finalHourSessions.rows) {
        try {
          const userId = session.id;
          const startTimeSec = parseInt(session.processing_start_time_seconds);
          const elapsedSec = nowSec - startTimeSec;
          const remainingSec = Math.max(0, processingDuration - elapsedSec);
          const progressPercentage = Math.min(1, elapsedSec / processingDuration);

          // إذا انتهى التعدين تماماً
          if (remainingSec <= 0) {
            await this.completeProcessingSession(userId);
            continue;
          }

          // حساب المكافأة مع التعزيز المثبت
          const boostMultiplier = parseFloat(session.locked_boost || 1.0);
          const baseReward = 0.25;
          const boostedReward = baseReward * boostMultiplier;
          // استخدام دالة التقريب لدقة الحساب
          const calculatedAccumulated = roundReward(boostedReward * progressPercentage);

          updates.push({
            userId,
            accumulated: calculatedAccumulated,
            progress: progressPercentage,
            boost: boostMultiplier,
            remainingMinutes: Math.floor(remainingSec / 60)
          });

          // تحديث الجلسة المحلية إذا كانت موجودة
          if (this.activeSessions.has(userId)) {
            const sessionData = this.activeSessions.get(userId);
            sessionData.remainingTime = remainingSec;
            sessionData.lastChecked = nowSec;
          }

        } catch (userError) {
          console.error(`Error processing final hour session for user ${session.id}:`, userError.message);
        }
      }

      // تنفيذ التحديثات في batch
      if (updates.length > 0) {
        await this.executeFinalHourUpdates(updates);
      }

    } catch (error) {
      console.error('[OPTIMIZED PROCESSING] Error monitoring final hour:', error.message);
    }
  }

  /**
   * تنفيذ تحديثات الساعة الأخيرة بكفاءة
   */
  async executeFinalHourUpdates(updates) {
    try {
      await pool.query('BEGIN');

      let veryFinalMinutes = 0; // العد التنازلي للدقائق الأخيرة

      for (const update of updates) {
        await pool.query(
          `UPDATE users SET 
           accumulatedReward = $1, 
           last_server_update = $2
           WHERE id = $3`,
          [update.accumulated, Math.floor(Date.now() / 1000), update.userId]
        );

        // تتبع الجلسات في الدقائق الأخيرة
        if (update.remainingMinutes <= 10) {
          veryFinalMinutes++;
          console.log(`[FINAL MINUTES] User ${update.userId}: ${update.remainingMinutes} minutes remaining, Reward: ${update.accumulated.toFixed(8)} ACCESS`);
        }
      }

      await pool.query('COMMIT');

      if (!this.ultraQuietMode) {
        console.log(`[FINAL HOUR SYNC] Updated ${updates.length} sessions near completion${veryFinalMinutes > 0 ? ` (${veryFinalMinutes} in final minutes)` : ''}`);
      }

    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('[OPTIMIZED PROCESSING] Failed to update final hour:', error.message);
    }
  }

  /**
   * تنظيف الجلسات المنتهية من الذاكرة
   */
  cleanupExpiredSessions(nowSec) {
    let cleanedCount = 0;

    for (const [userId, sessionData] of this.activeSessions) {
      if (sessionData.remainingTime <= 0) {
        this.activeSessions.delete(userId);
        cleanedCount++;
      }
    }

    // Ultra quiet mode - suppress cleanup messages
  }

  /**
   * نسخة محسنة من syncAllActiveProcessing - تستخدم فقط عند الحاجة
   */
  async syncAllActiveProcessing() {
    // استخدام النظام المحسن بدلاً من المراقبة المستمرة
    console.log('[OPTIMIZED PROCESSING] Using smart session tracking instead of heavy sync');
    await this.scanActiveSessions();
  }

  /**
   * Update processing progress for a specific user with timeout protection
   */
  async updateUserProcessingProgress(userId, startTimeSec, nowSec) {
    let client;
    try {
      const processingDuration = 24 * 60 * 60; // 24 hours
      const endTimeSec = startTimeSec + processingDuration;

      // Check if processing period has ended
      if (nowSec >= endTimeSec) {
        // Processing completed - transfer accumulated reward to balance
        await this.completeProcessingSession(userId);
        return;
      }

      // Calculate current progress
      const elapsedSec = nowSec - startTimeSec;
      const progressPercentage = Math.min(1, elapsedSec / processingDuration);

      // SMART BOOST: Get locked boost from database instead of recalculating
      let boostMultiplier = 1.0;
      try {
        const boostResult = await pool.query(
          'SELECT COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost FROM users WHERE id = $1',
          [userId]
        );
        if (boostResult.rows.length > 0) {
          boostMultiplier = parseFloat(boostResult.rows[0].locked_boost || 1.0);
        }
      } catch (error) {
        console.warn(`Error getting locked boost for user ${userId}, using default 1.0`);
        boostMultiplier = 1.0;
      }

      // Calculate current accumulated reward
      const baseReward = 0.25;
      const boostedReward = baseReward * boostMultiplier;
      // استخدام دالة التقريب لدقة الحساب
      const currentAccumulated = roundReward(boostedReward * progressPercentage);

      // Get connection with timeout
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 3000)
        )
      ]);

      // Update database with timeout
      await Promise.race([
        pool.query(
          `UPDATE users 
           SET accumulatedReward = $1, 
               last_server_update = $2
           WHERE id = $3`,
          [currentAccumulated, nowSec, userId]
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Update timeout')), 5000)
        )
      ]);

      // Only log major milestones to reduce noise
      if (progressPercentage >= 0.95 || progressPercentage % 0.1 < 0.01) {
        console.log(`[SERVER-SIDE PROCESSING] User ${userId}: ${currentAccumulated.toFixed(8)} ACCESS (${(progressPercentage * 100).toFixed(1)}%)`);
      }

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn(`[SERVER-SIDE PROCESSING] Timeout for user ${userId}, skipping update`);
      } else {
        console.error(`[SERVER-SIDE PROCESSING] Error updating user ${userId}:`, error.message);
      }
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError.message);
        }
      }
    }
  }

  /**
   * Calculate referral boost multiplier for a user with enhanced timeout protection
   */
  async calculateReferralBoost(userId, nowSec) {
    let client;
    try {
      // Get connection with longer timeout
      client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 8000)
        )
      ]);

      // Query with longer timeout and simplified query
      const referralsResponse = await Promise.race([
        client.query(
          `SELECT r.id, u.processing_active, u.processing_end_time, u.is_active 
           FROM referrals r
           JOIN users u ON r.referee_id = u.id
           WHERE r.referrer_id = $1
           LIMIT 10`, // Reduce limit further to speed up query
          [userId]
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 15000)
        )
      ]);

      let activeReferralCount = 0;
      const nowMs = nowSec * 1000;

      referralsResponse.rows.forEach(ref => {
        const processingActive = parseInt(ref.processing_active) || 0;
        const isActive = parseInt(ref.is_active) || 0;
        const endTime = parseInt(ref.processing_end_time) || 0;
        const isActivelyProcessing = (processingActive === 1 || isActive === 1 || (endTime > nowMs));

        if (isActivelyProcessing) {
          activeReferralCount++;
        }
      });

      // Get user's ad boost status and calculate boost multiplier
      const { computeHashrateMultiplier, getAdBoostStatus } = await import('./db.js');
      const adBoostStatus = await getAdBoostStatus(userId);

      // Calculate boost multiplier using centralized function
      const hashrateCalc = computeHashrateMultiplier(activeReferralCount, adBoostStatus.boostActive);
      return hashrateCalc.multiplier;

    } catch (error) {
      if (error.message.includes('timeout')) {
        console.warn(`Referral boost calculation timeout for user ${userId}, using default`);
      } else {
        console.error(`Error calculating referral boost for user ${userId}:`, error.message);
      }
      return 1.0; // Default to no boost on error
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing client:', releaseError.message);
        }
      }
    }
  }

  /**
   * Complete a processing session and transfer rewards (no history logging here)
   */
  async completeProcessingSession(userId) {
    try {
      console.log(`[SERVER-SIDE PROCESSING] Completing processing session for user ${userId}`);

      // AUTO-CLEANUP: حذف "Collecting..." من التاريخ عند توقف التعدين
      try {
        const cleanupResult = await pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 
           AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
          [userId]
        );
        if (cleanupResult.rowCount > 0) {
          console.log(`[AUTO-CLEANUP] Removed ${cleanupResult.rowCount} "Collecting..." entries for user ${userId}`);
        }
      } catch (cleanupError) {
        console.error(`[AUTO-CLEANUP] Error removing Collecting entries:`, cleanupError.message);
      }

      // Import completion function
      const { handleSimplifiedProcessingAPI } = await import('./countdown_simplifier.js');

      // Get current user data including all reward fields
      const userResult = await pool.query(
        `SELECT accumulatedReward, current_processing_reward, accumulated_processing_reward, 
                COALESCE(session_locked_boost, processing_boost_multiplier, 1.0) as locked_boost, 
                processing_start_time, processing_end_time, coins
         FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length > 0) {
        const userData = userResult.rows[0];

        // Get all possible accumulated values
        const accumulatedReward = parseFloat(userData.accumulatedreward || 0);
        const currentProcessingReward = parseFloat(userData.current_processing_reward || 0);
        const accumulatedProcessingReward = parseFloat(userData.accumulated_processing_reward || 0);

        // SMART BOOST: استخدام المضاعف المثبت من بداية الجلسة
        const finalBoostMultiplier = parseFloat(userData.locked_boost || 1.0);

        // Get the highest accumulated value
        const highestAccumulated = Math.max(
          accumulatedReward,
          currentProcessingReward,
          accumulatedProcessingReward
        );

        // Calculate minimum guaranteed reward (0.25 with boost)
        const baseReward = 0.25;
        const guaranteedMinimum = roundReward(baseReward * finalBoostMultiplier);

        // Final reward is the higher of accumulated or guaranteed minimum - مع التقريب
        const finalReward = roundReward(Math.max(highestAccumulated, guaranteedMinimum));

        console.log(`[PROCESSING COMPLETION] User ${userId}: Final reward ${finalReward.toFixed(8)} ACCESS (boost: ${finalBoostMultiplier.toFixed(2)}x) - reward will be logged when user starts new session`);

        // Use the simplified countdown completion system (no history logging)
        const mockReq = {
          method: 'POST',
          url: '/api/processing/countdown/complete',
          on: (event, callback) => {
            if (event === 'data') {
              callback(JSON.stringify({ userId, finalReward }));
            } else if (event === 'end') {
              callback();
            }
          }
        };

        const mockRes = {
          writeHead: () => {},
          end: (data) => {
            const result = JSON.parse(data);
            if (result.success) {
              console.log(`[SERVER-SIDE PROCESSING] Processing completed for user ${userId}: ${finalReward.toFixed(8)} ACCESS stored for next session start`);
            } else {
              console.error(`[SERVER-SIDE PROCESSING] Failed to complete processing for user ${userId}: ${result.error}`);
            }
          }
        };

        // Use simplified processing API for completion
        await handleSimplifiedProcessingAPI(mockReq, mockRes, '/api/processing/countdown/complete', 'POST');
      }

    } catch (error) {
      console.error(`[SERVER-SIDE PROCESSING] Error completing processing for user ${userId}:`, error);
    }
  }
}

// Create and export singleton instance
export const serverSideProcessingSync = new ServerSideProcessingSync();

// Auto-start when module is imported
serverSideProcessingSync.start();

// Graceful shutdown on process termination
process.on('SIGINT', () => {
  console.log('[SERVER-SIDE PROCESSING] Shutting down...');
  serverSideProcessingSync.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[SERVER-SIDE PROCESSING] Shutting down...');
  serverSideProcessingSync.stop();
  process.exit(0);
});