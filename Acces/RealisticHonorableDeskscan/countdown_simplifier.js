import { pool } from './db.js';
import { initializeActivityCountdownTables, startProcessingCountdown, getProcessingCountdownStatus, completeProcessingCountdown } from './activity_countdown_system.js';

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

// Initialize the countdown system when module loads
initializeActivityCountdownTables().catch(err => {
  console.error('Error initializing processing countdown tables:', err);
});

export async function handleSimplifiedProcessingAPI(req, res, pathname, method) {
  // GET /api/processing/countdown/status/:userId
  if (pathname.match(/^\/api\/processing\/countdown\/status\/\d+$/) && method === 'GET') {
    try {
      const userId = parseInt(pathname.split('/')[5]);

      // Get processing status from database
      const userStatus = await pool.query(
        `SELECT 
           processing_active, 
           processing_end_time,
           processing_start_time,
           processing_start_time_seconds,
           last_payout,
           COALESCE(accumulatedReward, 0) as accumulated_processing_reward,
           COALESCE(completed_processing_reward, 0) as completed_processing_reward
         FROM users 
         WHERE id = $1`,
        [userId]
      );

      if (!userStatus.rows[0]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'User not found' }));
        return true;
      }

      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const user = userStatus.rows[0];

      // Use seconds-based system if available
      const startTimeSec = parseInt(user.processing_start_time_seconds) || 0;
      const processingDuration = 24 * 60 * 60; // 24 hours in seconds
      const endTimeSec = startTimeSec > 0 ? startTimeSec + processingDuration : 0;

      // Calculate remaining time
      const remainingSec = Math.max(0, endTimeSec - nowSec);
      const processing_active = remainingSec > 0 ? 1 : 0;

      // عند انتهاء الجلسة، إرجاع completed_processing_reward إذا كانت موجودة
      // وإلا إرجاع accumulated - هذا يضمن بقاء المكافأة ظاهرة في جميع الأوقات
      let displayedAccumulated;
      const completedReward = parseFloat(user.completed_processing_reward || 0);
      const accumulatedReward = parseFloat(user.accumulated_processing_reward || 0);
      
      if (processing_active === 0 && completedReward > 0) {
        // الجلسة منتهية وتم حفظ المكافأة المكتملة - أظهرها
        displayedAccumulated = completedReward;
      } else {
        // الجلسة نشطة أو منتهية لكن لم يتم حفظ المكافأة بعد - أظهر المتراكم
        displayedAccumulated = accumulatedReward;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        processing_active: processing_active,
        remaining_seconds: remainingSec,
        duration_seconds: processingDuration,
        start_time: startTimeSec,
        end_time: endTimeSec,
        current_time: nowSec,
        accumulated_reward: displayedAccumulated,
        can_mine: processing_active === 0,
        is_completed: processing_active === 0
      }));
      return true;
    } catch (error) {
      console.error('Error getting processing countdown status:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return true;
    }
  }

  // POST /api/processing/countdown/complete
  if (pathname === '/api/processing/countdown/complete' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const { userId, finalReward } = body;

      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
        return true;
      }

      // Get current user data including completed_processing_reward
      const userResult = await pool.query(
        'SELECT coins, accumulatedReward, completed_processing_reward FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'User not found' }));
        return true;
      }

      const currentBalance = parseFloat(userResult.rows[0].coins || 0);
      const storedAccumulated = parseFloat(userResult.rows[0].accumulatedreward || 0);
      const completedReward = parseFloat(userResult.rows[0].completed_processing_reward || 0);

      // حساب المكافأة النهائية بدقة - مع ضمان الحد الأدنى
      let finalRewardAmount = 0;

      // أولاً: استخدام القيمة المكتملة المخزنة (الأولوية)
      if (completedReward > 0) {
        finalRewardAmount = roundReward(completedReward);
      } else if (storedAccumulated > 0) {
        finalRewardAmount = roundReward(storedAccumulated);
      } else if (finalReward && parseFloat(finalReward) > 0) {
        finalRewardAmount = roundReward(parseFloat(finalReward));
      }

      // ضمان الحد الأدنى 0.25 للمكافأة المكتملة
      if (finalRewardAmount < 0.25) {
        finalRewardAmount = 0.25;
        console.log(`ضمان الحد الأدنى للمكافأة للمستخدم ${userId}: تم تعيين ${finalRewardAmount.toFixed(8)} ACCESS`);
      }
      
      // تقريب نهائي للتأكد من الدقة
      finalRewardAmount = roundReward(finalRewardAmount);

      console.log(`✅ إكمال التعدين للمستخدم ${userId}: حفظ ${finalRewardAmount.toFixed(8)} في completed_processing_reward (لن يُنقل للرصيد الآن)`);

      // ✅ Save completed reward WITHOUT transferring to balance
      // ✅ لا نحذف المكافأة المتراكمة - تبقى ظاهرة حتى بدء جلسة جديدة
      await pool.query('BEGIN');

      try {
        // ✅ حفظ المكافأة المكتملة في completed_processing_reward
        // ✅ نحافظ على accumulatedReward و accumulated_processing_reward كما هي
        // ✅ سيتم مسحها فقط عند بدء جلسة جديدة (في /api/processing/countdown/start)
        await pool.query(
          `UPDATE users SET 
           processing_active = 0,
           processing_start_time = NULL,
           processing_start_time_seconds = NULL,
           processing_boost_multiplier = 1.0,
           last_server_sync = NULL,
           completed_processing_reward = $1::numeric(10,8)
           WHERE id = $2`,
          [finalRewardAmount, userId]
        );

        // Clean up processing history - remove collecting entries ONLY (don't add final entry here)
        await pool.query(
          `DELETE FROM processing_history 
           WHERE user_id = $1 AND (user_name = 'Collecting...' OR user_name LIKE '%Collecting%')`,
          [userId]
        );

        await pool.query('COMMIT');

        // دالة تنسيق ذكية على الخادم
        function formatNumberSmartServer(number) {
          if (typeof number !== 'number') {
            number = parseFloat(number) || 0;
          }

          let formatted = number.toFixed(8);
          formatted = formatted.replace(/\.?0+$/, '');

          if (!formatted.includes('.')) {
            return parseFloat(formatted);
          }

          return parseFloat(formatted);
        }

        res.end(JSON.stringify({
          success: true,
          message: 'تم حفظ المكافأة المكتملة - سيتم نقلها عند بدء نشاط جديد',
          reward_amount: formatNumberSmartServer(finalRewardAmount),
          saved_in_completed: true,
          balance_unchanged: true
        }));
        return true;

      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('Error completing processing countdown:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return true;
    }
  }

  // POST /api/processing/countdown/start - Add completed processing reward to history when starting new session
  if (pathname === '/api/processing/countdown/start' && method === 'POST') {
    try {
      const body = await parseRequestBody(req);
      const { userId } = body;

      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Missing userId' }));
        return true;
      }

      const now = Math.floor(Date.now() / 1000);
      const processingDuration = 24 * 60 * 60; // 24 hours in seconds

      // ✅ Get ALL reward fields to find the highest value for transfer
      const userCheck = await pool.query(
        `SELECT coins, completed_processing_reward, 
                COALESCE(accumulatedReward, 0) as accumulatedreward,
                COALESCE(accumulated_processing_reward, 0) as accumulated_processing_reward
         FROM users WHERE id = $1`,
        [userId]
      );

      if (userCheck.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'User not found' }));
        return true;
      }

      const currentBalance = parseFloat(userCheck.rows[0].coins || 0);
      const completedReward = parseFloat(userCheck.rows[0].completed_processing_reward || 0);
      const storedAccumulated = parseFloat(userCheck.rows[0].accumulatedreward || 0);
      const altAccumulated = parseFloat(userCheck.rows[0].accumulated_processing_reward || 0);
      
      // ✅ Take the HIGHEST value among all reward fields to prevent any loss
      const maxReward = roundReward(Math.max(completedReward, storedAccumulated, altAccumulated));
      console.log(`[START] User ${userId}: completed=${completedReward}, accumulated=${storedAccumulated}, alt=${altAccumulated}, max=${maxReward}`);

      // ✅ Calculate new balance ONLY if there's a reward to transfer
      let newBalance = currentBalance;
      if (maxReward > 0) {
        newBalance = roundReward(currentBalance + maxReward);
        console.log(`✅ نقل المكافأة ${maxReward.toFixed(8)} للمستخدم ${userId} إلى الرصيد. الرصيد الجديد: ${newBalance.toFixed(8)}`);
      }

      await pool.query('BEGIN');

      try {
        // ✅ Transfer max reward to balance if exists
        if (maxReward > 0) {
          // Update balance
          await pool.query(
            'UPDATE users SET coins = $1::numeric(20,8) WHERE id = $2',
            [newBalance.toFixed(8), userId]
          );
          
          // Add to history
          await pool.query(
            'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5)',
            [userId, maxReward, now * 1000, `مكافأة التعدين: +${maxReward.toFixed(8)} ACCESS`, new Date(now * 1000).toISOString()]
          );
          console.log(`✅ تم إضافة سجل المكافأة للمستخدم ${userId}: ${maxReward.toFixed(8)} ACCESS`);
        }

        // Start new processing session
        // ✅ ONLY reset reward fields if we transferred a reward (maxReward > 0)
        // ✅ If no reward was transferred, keep accumulated fields intact
        if (maxReward > 0) {
          await pool.query(
            `UPDATE users 
             SET processing_active = 1,
                 processing_start_time_seconds = $1,
                 processing_start_time = $2,
                 processing_end_time = $3,
                 accumulatedReward = 0,
                 accumulated_processing_reward = 0,
                 completed_processing_reward = 0
             WHERE id = $4`,
            [now, now * 1000, (now + processingDuration) * 1000, userId]
          );
        } else {
          // No transfer, just start new session without resetting reward fields
          await pool.query(
            `UPDATE users 
             SET processing_active = 1,
                 processing_start_time_seconds = $1,
                 processing_start_time = $2,
                 processing_end_time = $3
             WHERE id = $4`,
            [now, now * 1000, (now + processingDuration) * 1000, userId]
          );
        }

        // Add "Collecting..." entry to processing history
        await pool.query(
          'INSERT INTO processing_history (user_id, amount, timestamp, user_name, date) VALUES ($1, $2, $3, $4, $5)',
          [userId, 0, now * 1000, 'Collecting...', new Date(now * 1000).toISOString()]
        );

        await pool.query('COMMIT');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          processing_active: 1,
          remaining_seconds: processingDuration,
          start_time: now,
          end_time: now + processingDuration,
          coins: newBalance, // ✅ Return NEW balance after transfer
          processing_accumulated: 0, // Start fresh at zero
          previous_reward_transferred: maxReward > 0 ? maxReward : null,
          new_balance: newBalance,
          message: maxReward > 0 
            ? `بدأ التعدين. تم إضافة ${maxReward.toFixed(8)} ACCESS إلى رصيدك.`
            : 'بدأ التعدين بنجاح'
        }));
        return true;

      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('Error starting processing countdown:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message }));
      return true;
    }
  }

  return false;
}

// Helper function to parse JSON body from request
async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        resolve(data);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}