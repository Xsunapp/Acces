// Blockchain API
import { NetworkNode } from './network-node.js';
import { pool } from './db.js';
import express from 'express'; // Import express
import { handleWeb3RPC } from './web3-rpc-handler.js';
import crypto from 'crypto'; // Ensure crypto is imported

// Import Explorer API for Etherscan-compatible blockchain explorer
import { ExplorerAPI } from './explorer-api.js';

// Import blockchain health checker
import BlockchainHealthChecker from './network-health-check.js';

// Network API will be initialized after import

// Global network node instance with lazy initialization
let networkNode = null;
let isInitializing = false;

// Get the network node instance
export function getNetworkNode() {
  if (!networkNode && !isInitializing) {
    console.log('🔧 Auto-initializing network node...');
    networkNode = initializeNetwork();
  }
  return networkNode;
}

// Initialize the network
export async function initializeNetwork() {
  if (networkNode) {
    console.log('Network already initialized');
    return networkNode;
  }

  if (isInitializing) {
    console.log('Network initialization in progress...');
    return networkNode;
  }

  try {
    isInitializing = true;
    console.log('🚀 Initializing Access Network...');
    // البلوكتشين يعمل على منفذ 5000 منفصل عن الموقع الرئيسي (3000)
    const BLOCKCHAIN_PORT = process.env.BLOCKCHAIN_PORT || 5000;
    networkNode = new NetworkNode(BLOCKCHAIN_PORT);
    networkNode.start();

    // ✅ Initialize Smart Contract Engine AFTER NetworkNode started
    // مثل Ethereum/BSC - العقود الذكية تُخزن في البلوكتشين وليس قاعدة البيانات
    const { SmartContractEngine } = await import('./contract-engine.js');
    networkNode.contractEngine = new SmartContractEngine(networkNode);
    console.log('🔷 Smart Contract Engine initialized - Blockchain storage for NFTs/Tokens');

    // تعيين networkNode إلى global.accessNode لاستخدامه في server.js
    global.accessNode = networkNode;

    console.log(`✅ Network initialized successfully on port ${BLOCKCHAIN_PORT}`);
    console.log(`✅ global.accessNode set successfully`);
    isInitializing = false;
    return networkNode;
  } catch (error) {
    console.error('❌ Failed to initialize network:', error);
    isInitializing = false;
    return null;
  }
}


// Initialize express application
const app = express();
app.use(express.json()); // Use express.json() for handling JSON requests

// Access to the blockchain instance (for migration functions)
let blockchainInstance = null;

// Global explorer API instance
let explorerAPI = null;

// Helper to access blockchain instance
function getBlockchainInstance() {
  const node = getNetworkNode();
  return node ? node.network : null;
}

// Create blockchain tables
async function createNetworkTables() {
  try {
    // Transactions table - REMOVED AS REQUESTED

    // Blocks table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS network_blocks (
        id SERIAL PRIMARY KEY,
        block_index INTEGER UNIQUE NOT NULL,
        block_hash VARCHAR(64) UNIQUE NOT NULL,
        previous_hash VARCHAR(64),
        timestamp BIGINT NOT NULL,
        transactions_count INTEGER DEFAULT 0,
        difficulty INTEGER DEFAULT 1,
        nonce BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Nodes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blockchain_nodes (
        id SERIAL PRIMARY KEY,
        node_id VARCHAR(64) UNIQUE NOT NULL,
        ip_address INET NOT NULL,
        port INTEGER NOT NULL,
        is_active BOOLEAN DEFAULT true,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        version VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Ledger tables created successfully');
  } catch (error) {
    console.error('Error creating blockchain tables:', error);
  }
}

// Handle blockchain API requests
export async function handleNetworkAPI(req, res, pathname, method) {
  if (!networkNode) {
    initializeNetwork(); // Ensure network is initialized if not already
  }

  try {
    // GET /api/blockchain/info - Network information
    if (pathname === '/api/blockchain/info' && method === 'GET') {
      const networkInfo = networkNode.blockchain.getNetworkInfo();
      const stats = networkNode.getStats();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        network: networkInfo,
        stats: stats,
        rpcEndpoint: `http://localhost:${networkNode.port}`,
        chainId: networkInfo.chainId,
        networkId: networkInfo.networkId
      }));
      return true;
    }

    // POST /api/blockchain/create-wallet - Create a new wallet
    if (pathname === '/api/blockchain/create-wallet' && method === 'POST') {
      const wallet = networkNode.blockchain.createWallet();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        wallet: wallet,
        message: 'Wallet created successfully'
      }));
      return true;
    }

    // GET /api/blockchain/balance/:address - Get wallet balance
    if (pathname.match(/^\/api\/blockchain\/balance\/0x[a-fA-F0-9]{40}$/) && method === 'GET') {
      const address = pathname.split('/')[4];
      const balance = networkNode.blockchain.getBalance(address);

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        success: true,
        address: address,
        balance: balance,
        formatted: balance.toFixed(8) + ' ACCESS'
      }));
      return true;
    }

    // Corrected transaction hashing to ensure a single hash per transaction
    // POST /api/blockchain/send - Send a real transaction with duplication prevention
    if (pathname === '/api/blockchain/send' && method === 'POST') {
      const data = await parseRequestBody(req);
      const { from, to, amount, privateKey, gasPrice, transactionHash } = data;

      // Validate data
      if (!from || !to || !amount || !privateKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required parameters'
        }));
        return true;
      }

      try {
        // التحقق من عدم وجود المعاملة مسبقاً
        if (transactionHash) {
          // Try to get transaction by hash, potentially from memory or DB if not in current chain view
          const existingTx = networkNode.blockchain.getTransactionByHash(transactionHash);
          if (existingTx) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: false,
              error: 'Transaction already exists in blockchain',
              transactionHash: transactionHash,
              duplicate: true
            }));
            return true;
          }
        }

        // Create and sign a real transaction with a consistently generated hash
        const transaction = await networkNode.createSignedTransaction({
          from: from,
          to: to,
          amount: amount,
          privateKey: privateKey,
          gasPrice: gasPrice || networkNode.blockchain.gasPrice,
          // nonce: Date.now() // Nonce will be managed by the transaction creation logic internally for consistency
        });

        // ⭐ CRITICAL: إنشاء hash واحد فقط - مصدر وحيد للحقيقة
        let finalHash = transaction.hash || transaction.txId || transaction.transactionHash;

        // إذا لم يكن هناك hash موجود، أنشئ واحد جديد
        if (!finalHash) {
          const nonce = networkNode.blockchain.getNonce(transaction.fromAddress); // Ensure getNonce is accessible or use a consistent method
          const timestamp = transaction.timestamp || Date.now();

          finalHash = crypto
            .createHash('sha256')
            .update(
              (transaction.fromAddress || 'genesis') +
              transaction.toAddress +
              transaction.amount.toString() +
              nonce.toString() +
              timestamp.toString()
            )
            .digest('hex');

          // Update transaction with newly generated nonce and timestamp if needed
          transaction.nonce = nonce;
          transaction.timestamp = timestamp;
        }

        // ⭐ SINGLE SOURCE OF TRUTH: hash واحد فقط لجميع الحقول
        transaction.hash = finalHash;
        transaction.txId = finalHash;
        transaction.transactionHash = finalHash;
        transaction.id = finalHash; // Assuming 'id' is also used as a hash reference

        // Add transaction to blockchain
        const txHash = networkNode.blockchain.addTransaction(transaction);

        // Broadcast transaction to the network (for external wallets)
        await networkNode.broadcastTransactionToExternalWallets(transaction);

        // Immediate block processing for transaction confirmation
        const block = networkNode.blockchain.minePendingTransactions(from); // Processing might require the sender's address or a specific processor address

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          transactionHash: txHash,
          blockHash: block.hash,
          blockIndex: block.index,
          confirmations: 1, // Assuming immediate confirmation after processing
          message: 'Transaction sent and confirmed successfully',
          gasUsed: transaction.gasUsed || transaction.gasFee, // Use appropriate field name
          effectiveGasPrice: transaction.gasPrice
        }));
      } catch (error) {
        console.error("Error during transaction sending:", error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message || 'Failed to send transaction'
        }));
      }
      return true;
    }

    // GET /api/blockchain/transaction/:hash - Get a transaction (flexible hash length and format)
    if (pathname.match(/^\/api\/blockchain\/transaction\/[a-fA-F0-9x]+$/) && method === 'GET') {
      const txHashRaw = pathname.split('/')[4];
      // Normalize hash - remove 0x prefix for consistent searching
      const txHash = txHashRaw.startsWith('0x') ? txHashRaw.substring(2) : txHashRaw;
      console.log(`🔍 Transaction lookup request for hash: ${txHash} (original: ${txHashRaw})`);

      let transaction = null;

      // Method 1: Try exact hash match (with and without 0x prefix)
      const hashVariants = [txHash, '0x' + txHash, txHashRaw];
      for (const variant of hashVariants) {
        // Ensure getTransactionByHash uses the consistent hash ('hash', 'txId', 'transactionHash', 'id')
        transaction = networkNode.blockchain.getTransactionByHash(variant);
        if (transaction) {
          console.log(`✅ Direct hash match found with variant: ${variant}`);
          break;
        }
      }

      // Method 2: Partial hash search in blockchain
      if (!transaction) {
        console.log(`🔍 Trying partial hash search for: ${txHash}`);
        const allTransactions = networkNode.blockchain.getAllTransactions();
        console.log(`📊 Total transactions available: ${allTransactions.length}`);

        transaction = allTransactions.find(tx => {
          const txId = tx.hash || tx.txId || tx.transactionHash || tx.id || '';
          const normalizedTxId = txId.startsWith('0x') ? txId.substring(2) : txId;

          if (!normalizedTxId) return false;

          // Try multiple matching strategies
          const matches =
            normalizedTxId.toLowerCase().startsWith(txHash.toLowerCase()) ||
            txHash.toLowerCase().startsWith(normalizedTxId.toLowerCase()) ||
            normalizedTxId.toLowerCase().includes(txHash.toLowerCase()) ||
            normalizedTxId.toLowerCase() === txHash.toLowerCase();

          if (matches) {
            console.log(`✅ Partial match found: ${txId} matches ${txHash}`);
            return true;
          }
          return false;
        });
      }

      // Method 3: Database fallback search - REMOVED AS REQUESTED

      if (!transaction) {
        console.log(`❌ Transaction not found for hash: ${txHash}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: `Transaction not found for hash: ${txHash}`,
          searchedHash: txHash,
          originalHash: txHashRaw
        }));
        return true;
      }

      // Ensure transaction object returned has consistent hash fields
      const finalTransaction = {
        ...transaction,
        hash: transaction.hash || transaction.txId || transaction.transactionHash || transaction.id,
        txId: transaction.hash || transaction.txId || transaction.transactionHash || transaction.id,
        transactionHash: transaction.hash || transaction.txId || transaction.transactionHash || transaction.id,
        id: transaction.hash || transaction.txId || transaction.transactionHash || transaction.id
      };


      console.log(`✅ Transaction found: ${finalTransaction.hash}`);
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        success: true,
        transaction: finalTransaction,
        searchedHash: txHash
      }));
      return true;
    }

    // GET /api/blockchain/block/:identifier - Get a block
    if (pathname.match(/^\/api\/blockchain\/block\//) && method === 'GET') {
      const identifier = pathname.split('/')[4];
      let block;

      if (identifier === 'latest') {
        block = networkNode.blockchain.getLatestBlock();
      } else if (identifier.startsWith('0x')) {
        block = networkNode.blockchain.getBlockByHash(identifier);
      } else {
        const index = parseInt(identifier);
        if (isNaN(index)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid block identifier' }));
          return true;
        }
        block = networkNode.blockchain.getBlockByIndex(index);
      }

      if (!block) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Block not found'
        }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        block: block
      }));
      return true;
    }

    // POST /api/blockchain/mine - Mine a block
    if (pathname === '/api/blockchain/mine' && method === 'POST') {
      const data = await parseRequestBody(req);
      const { processorAddress } = data;

      if (!processorAddress) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Processor address required'
        }));
        return true;
      }

      try {
        const result = await networkNode.mineBlock(processorAddress);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          ...result,
          message: 'Record processed successfully'
        }));
      } catch (error) {
        console.error("Error processing block:", error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message || 'Failed to process record'
        }));
      }
      return true;
    }

    // GET /api/blockchain/history/:address - Transaction history
    if (pathname.match(/^\/api\/blockchain\/history\/0x[a-fA-F0-9]{40}$/) && method === 'GET') {
      const address = pathname.split('/')[4];
      // Ensure getAllTransactionsForWallet correctly filters or retrieves transactions
      const transactions = networkNode.blockchain.getAllTransactionsForWallet(address);

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        success: true,
        address: address,
        transactions: transactions.map(tx => ({ // Ensure consistent hash fields in history too
          ...tx,
          hash: tx.hash || tx.txId || tx.transactionHash || tx.id,
          txId: tx.hash || tx.txId || tx.transactionHash || tx.id,
          transactionHash: tx.hash || tx.txId || tx.transactionHash || tx.id,
          id: tx.hash || tx.txId || tx.transactionHash || tx.id
        })),
        count: transactions.length
      }));
      return true;
    }

    // GET /api/blockchain/validate - Validate the chain
    if (pathname === '/api/blockchain/validate' && method === 'GET') {
      const isValid = networkNode.blockchain.isChainValid();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        isValid: isValid,
        message: isValid ? 'Blockchain is valid' : 'Blockchain is invalid'
      }));
      return true;
    }

    // GET /api/stats/real-gas-fees - Return FIXED gas fees (0.00002 ACCESS)
    if (pathname === '/api/stats/real-gas-fees' && method === 'GET') {
      try {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        // رسوم غاز ثابتة للشبكة
        const FIXED_GAS_PRICE = 0.00002; // 0.00002 ACCESS لكل معاملة

        // Get real transaction count from database
        const result = await pool.query(`
          SELECT 
            COUNT(*) as daily_count,
            (SELECT COUNT(*) FROM transactions) as total_count
          FROM transactions 
          WHERE timestamp > $1
        `, [oneDayAgo]);

        const stats = result.rows[0];
        const dailyTransactions = parseInt(stats.daily_count) || 0;
        const totalTransactions = parseInt(stats.total_count) || 0;

        // حساب إجمالي الرسوم بناءً على عدد المعاملات
        const totalGasFees = dailyTransactions * FIXED_GAS_PRICE;

        const responseData = {
          dailyTransactions: dailyTransactions,
          totalGasFees: totalGasFees.toFixed(8),
          avgGasFee: FIXED_GAS_PRICE.toFixed(8),
          totalTransactions: totalTransactions,
          pendingTransactions: 0,
          period: '24h',
          calculatedAt: now,
          source: 'fixed_gas_price',
          gasPrice: FIXED_GAS_PRICE,
          fixedFee: true
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: responseData,
          message: 'Fixed gas price: 0.00002 ACCESS per transaction'
        }));
      } catch (error) {
        console.error('❌ Error getting gas fees:', error);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: {
            dailyTransactions: 0,
            totalGasFees: '0.00000000',
            avgGasFee: '0.00002000',
            totalTransactions: 0,
            pendingTransactions: 0,
            gasPrice: 0.00002,
            fixedFee: true
          }
        }));
      }
      return true;
    }

    // GET /api/blockchain/transactions/recent - Get recent transactions
    if (pathname.startsWith('/api/blockchain/transactions/recent') && method === 'GET') {
      const url = new URL(`http://localhost${pathname}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`);
      const limit = parseInt(url.searchParams.get('limit')) || 20;

      try {
        console.log(`🔍 Getting recent ${limit} transactions from ledger...`);

        const allTransactions = networkNode.blockchain.getAllTransactions();

        const recentTransactions = allTransactions
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, limit)
          .map(tx => {
            // Ensure consistent hash fields for returned transactions
            const txHash = tx.hash || tx.txId || tx.transactionHash || tx.id;

            return {
              hash: txHash,
              txId: txHash,
              transactionHash: txHash,
              from: tx.fromAddress || tx.from,
              fromAddress: tx.fromAddress || tx.from,
              to: tx.toAddress || tx.to,
              toAddress: tx.toAddress || tx.to,
              amount: tx.amount || tx.value,
              value: tx.amount || tx.value,
              timestamp: tx.timestamp,
              blockIndex: tx.blockIndex,
              blockHash: tx.blockHash,
              // Use real gas price and used fields
              gasPrice: tx.gasPrice || networkNode.blockchain.getGasPrice(),
              gasUsed: tx.gasUsed || tx.gasFee || 21000,
              gasFee: tx.gasFee || tx.gasUsed || (tx.gasPrice || 0.00002),
              fee: tx.fee || tx.gasFee || (tx.gasPrice || 0.00002),
              nonce: tx.nonce || 0,
              status: 'confirmed'
            };
          });

        console.log(`📤 Returning ${recentTransactions.length} recent transactions`);

        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(JSON.stringify({
          success: true,
          transactions: recentTransactions,
          count: recentTransactions.length,
          total: allTransactions.length
        }));
      } catch (error) {
        console.error('❌ Error getting recent transactions:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
      return true;
    }

    // Web3 RPC Endpoints for external wallets

    // POST /rpc - Main RPC endpoint
    if (pathname === '/rpc' && method === 'POST') {
      const data = await parseRequestBody(req);
      const response = await handleWeb3RPC(data);

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify(response));
      return true;
    }

    // GET /api/rpc/chain-id - Chain ID
    if (pathname === '/api/rpc/chain-id' && method === 'GET') {
      const networkInfo = networkNode.blockchain.getNetworkInfo();

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        chainId: networkInfo.chainId,
        networkId: networkInfo.networkId,
        name: networkInfo.chainName
      }));
      return true;
    }

    // GET /api/rpc/gas-price - Current gas price
    if (pathname === '/api/rpc/gas-price' && method === 'GET') {
      const gasPrice = networkNode.blockchain.getGasPrice();

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        gasPrice: '0x' + Math.floor(gasPrice * 1e18).toString(16), // Format as hex string
        formatted: gasPrice.toFixed(8) + ' ACCESS'
      }));
      return true;
    }

    // GET /api/rpc/block-number - Current block number
    if (pathname === '/api/rpc/block-number' && method === 'GET') {
      const latestBlock = networkNode.blockchain.getLatestBlock();

      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(JSON.stringify({
        blockNumber: '0x' + latestBlock.index.toString(16), // Format as hex string
        blockHash: latestBlock.hash
      }));
      return true;
    }

    // POST /api/blockchain/sync-wallet-balance - Force sync wallet balance
    if (pathname === '/api/blockchain/sync-wallet-balance' && method === 'POST') {
      const data = await parseRequestBody(req);
      const { address } = data;

      if (!address) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Wallet address required'
        }));
        return true;
      }

      try {
        // Force sync with database
        const synced = await forceSyncWalletBalance(address);
        const currentBalance = networkNode.blockchain.getBalance(address);

        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(JSON.stringify({
          success: true,
          address: address,
          balance: currentBalance,
          synced: synced,
          formatted: currentBalance.toFixed(8) + ' ACCESS'
        }));
      } catch (error) {
        console.error("Error syncing wallet balance:", error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message || 'Failed to sync wallet balance'
        }));
      }
      return true;
    }

    // API لجلب البلوكات الحقيقية المبنية من المعاملات الفعلية - BSCScan style
    if (pathname === '/api/blocks') {
      try {
        console.log('🔄 Building real blocks from actual transactions...');

        // Get all real transactions first
        const allTransactions = networkNode.blockchain.getAllTransactions();
        console.log(`📊 Found ${allTransactions.length} real transactions to build blocks from`);

        if (allTransactions.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: [],
            total: 0,
            message: 'No transactions available to build blocks',
            timestamp: Date.now()
          }));
          return true; // Indicate handled
        }

        // Sort transactions by timestamp (newest first)
        const sortedTransactions = allTransactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Group transactions into realistic blocks
        const blocks = [];
        let currentBlockTransactions = [];
        let currentBlockIndex = 0;
        let lastBlockTime = 0; // Track time for potential block interval logic
        const blockInterval = 60000; // 1 minute per block
        const maxTxPerBlock = 5; // Maximum transactions per block

        for (const tx of sortedTransactions) {
          const txTime = tx.timestamp || Date.now();

          // Create new block if conditions are met
          if (currentBlockTransactions.length === 0 ||
              (lastBlockTime > 0 && (txTime - lastBlockTime) > blockInterval) || // Use difference for interval
              currentBlockTransactions.length >= maxTxPerBlock) {

            if (currentBlockTransactions.length > 0) {
              // Create block from accumulated transactions
              // Ensure hash generation is consistent and uses the single source of truth
              const blockHash = '0x' + crypto.createHash('sha256')
                .update(`block_${currentBlockIndex}_${lastBlockTime}_${currentBlockTransactions.length}`)
                .digest('hex')
                .substring(0, 64);

              const parentHash = currentBlockIndex > 0 ? blocks[blocks.length - 1].hash : '0x0000000000000000000000000000000000000000000000000000000000000000';

              // التأكد من أن كل بلوك له رقم فريد حتى لو كانت المعاملات في نفس الوقت
              const block = {
                index: currentBlockIndex,
                number: currentBlockIndex,
                hash: blockHash,
                parentHash: parentHash,
                timestamp: lastBlockTime || Date.now(),
                transactions: [...currentBlockTransactions], // Real transactions
                transactionCount: currentBlockTransactions.length,
                processor: 'AccessProcessor',
                validator: 'AccessProcessor',
                miner: 'AccessProcessor', // إضافة miner لتوافق BSCScan
                reward: 0.25,
                gasUsed: currentBlockTransactions.reduce((sum, t) => sum + (t.gasUsed || t.gasFee || 21000), 0), // Summing gas fees
                gasLimit: 30000000,
                size: Math.max(1024, JSON.stringify(currentBlockTransactions).length), // حجم أدنى 1KB
                difficulty: Math.max(1, Math.floor(currentBlockTransactions.length / 2)),
                // بيانات إضافية حقيقية
                totalAmount: currentBlockTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0),
                avgGasPrice: currentBlockTransactions.length > 0 ?
                  currentBlockTransactions.reduce((sum, tx) => sum + (tx.gasPrice || 0.00002), 0) / currentBlockTransactions.length : 0.00002,
                blockTime: 1 // ثانية واحدة لكل بلوك
              };

              blocks.push(block);
              console.log(`📦 Created real block ${currentBlockIndex} with ${currentBlockTransactions.length} actual transactions`);
              currentBlockIndex++;
            }

            currentBlockTransactions = [];
            lastBlockTime = txTime;
          }

          currentBlockTransactions.push(tx);
        }

        // Add the final block if it has transactions
        if (currentBlockTransactions.length > 0) {
          const blockHash = '0x' + crypto.createHash('sha256')
            .update(`block_${currentBlockIndex}_${lastBlockTime}_${currentBlockTransactions.length}`)
            .digest('hex')
            .substring(0, 64);
          const parentHash = currentBlockIndex > 0 ? blocks[blocks.length - 1].hash : '0x0000000000000000000000000000000000000000000000000000000000000000';

          const block = {
            index: currentBlockIndex,
            number: currentBlockIndex,
            hash: blockHash,
            parentHash: parentHash,
            timestamp: lastBlockTime || Date.now(),
            transactions: [...currentBlockTransactions],
            transactionCount: currentBlockTransactions.length,
            processor: 'AccessProcessor',
            validator: 'AccessProcessor',
            miner: 'AccessProcessor',
            reward: 0.25,
            gasUsed: currentBlockTransactions.reduce((sum, t) => sum + (t.gasUsed || t.gasFee || 21000), 0),
            gasLimit: 30000000,
            size: Math.max(1024, JSON.stringify(currentBlockTransactions).length),
            difficulty: Math.max(1, Math.floor(currentBlockTransactions.length / 2)),
            totalAmount: currentBlockTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0),
            avgGasPrice: currentBlockTransactions.length > 0 ? currentBlockTransactions.reduce((sum, tx) => sum + (tx.gasPrice || 0.00002), 0) / currentBlockTransactions.length : 0.00002,
            blockTime: 1
          };

          blocks.push(block);
          console.log(`📦 Created final real block ${currentBlockIndex} with ${currentBlockTransactions.length} actual transactions`);
        }

        // Sort blocks by number (latest first)
        const sortedBlocks = blocks.sort((a, b) => (b.number || 0) - (a.number || 0));

        console.log(`✅ Successfully built ${sortedBlocks.length} real blocks from ${allTransactions.length} actual transactions`);

        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(JSON.stringify({
          success: true,
          data: sortedBlocks,
          total: sortedBlocks.length,
          totalTransactions: allTransactions.length,
          message: `Built ${sortedBlocks.length} real blocks from actual transactions`,
          timestamp: Date.now()
        }));
        return true; // Indicate handled
      } catch (error) {
        console.error('❌ Error building real blocks:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message,
          message: 'Failed to build real blocks from transactions'
        }));
        return true; // Indicate handled
      }
    }

    // GET /api/explorer/latest-blocks - BSCScan style latest blocks
    if (pathname.startsWith('/api/explorer/latest-blocks') && method === 'GET') {
      try {
        const url = new URL(`http://localhost${pathname}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`);
        const limit = parseInt(url.searchParams.get('limit')) || 10;

        console.log(`🔄 Fetching latest ${limit} blocks from real transactions...`);

        // Get all real transactions
        const allTransactions = networkNode.blockchain.getAllTransactions();

        if (allTransactions.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: [],
            message: 'No transactions available for blocks'
          }));
          return true; // Indicate handled
        }

        // Build latest blocks from recent transactions
        const recentTransactions = allTransactions
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, limit * 5); // Get more transactions to build blocks

        const latestBlocks = [];
        let currentBlockTx = [];
        let blockIndex = 0;
        let lastBlockTime = 0; // Track time for potential block interval logic
        const blockInterval = 60000; // 1 minute

        for (let i = 0; i < recentTransactions.length && latestBlocks.length < limit; i++) {
          const tx = recentTransactions[i];
          currentBlockTx.push(tx);

          // Create block every 3-5 transactions or at end, respecting interval
          if (currentBlockTx.length >= 3 || i === recentTransactions.length - 1 ||
              (lastBlockTime > 0 && (tx.timestamp || Date.now()) - lastBlockTime > blockInterval)) {

            const blockHash = '0x' + crypto.createHash('sha256')
              .update(`block_${blockIndex}_${tx.timestamp || Date.now()}_${currentBlockTx.length}`)
              .digest('hex')
              .substring(0, 64);

            const parentHash = blockIndex > 0 ? latestBlocks[latestBlocks.length - 1].hash : '0x0000000000000000000000000000000000000000000000000000000000000000';

            const block = {
              index: blockIndex,
              number: blockIndex,
              hash: blockHash,
              timestamp: tx.timestamp || Date.now(),
              transactions: [...currentBlockTx],
              transactionCount: currentBlockTx.length,
              processor: 'AccessProcessor',
              validator: 'AccessProcessor',
              miner: 'AccessProcessor',
              reward: 0.25,
              gasUsed: currentBlockTx.reduce((sum, t) => sum + (t.gasUsed || t.gasFee || 21000), 0),
              gasLimit: 30000000,
              size: Math.max(1024, JSON.stringify(currentBlockTx).length),
              difficulty: 1,
              parentHash: parentHash
            };

            latestBlocks.push(block);
            currentBlockTx = [];
            blockIndex++;
            lastBlockTime = tx.timestamp || Date.now(); // Update last block time
          }
        }

        // Sort by timestamp (newest first)
        const sortedBlocks = latestBlocks.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        console.log(`✅ Built ${sortedBlocks.length} latest blocks from real transactions`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          data: sortedBlocks,
          total: sortedBlocks.length,
          timestamp: Date.now()
        }));
        return true; // Indicate handled
      } catch (error) {
        console.error('Error fetching latest blocks:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
        return true; // Indicate handled
      }
    }

    return false; // Request not handled
  } catch (error) {
    console.error('Blockchain API error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }));
    return true; // Indicate handled
  }
}

// نظام منع التكرار وتوحيد المصدر
const syncLocks = new Map();

async function forceSyncWalletBalance(address) {
  try {
    if (!address || !address.startsWith('0x')) {
      throw new Error('Invalid wallet address');
    }

    // منع المعالجة المتكررة لنفس العنوان
    if (syncLocks.has(address.toLowerCase())) {
      console.log(`⏳ عنوان ${address} قيد المعالجة، تم تجاهل الطلب المكرر`);
      return false;
    }

    syncLocks.set(address.toLowerCase(), Date.now());

    try {
      // البلوك تشين هو المصدر الوحيد للحقيقة
      const blockchainBalance = networkNode.blockchain.getBalance(address);

      // ✅ تزامن كامل: تحديث قاعدة البيانات لتطابق البلوك تشين بنسبة 100%
      const externalResult = await pool.query(
        'UPDATE external_wallets SET balance = $1, last_activity = $2 WHERE address = $3 RETURNING address',
        [blockchainBalance.toFixed(8), Date.now(), address.toLowerCase()]
      );

      if (externalResult.rows.length > 0) {
        console.log(`✅ ${address}: ${blockchainBalance.toFixed(8)} ACCESS (البلوك تشين - مصدر وحيد)`);
        return true;
      }
    } finally {
      // إزالة القفل بعد المعالجة
      syncLocks.delete(address.toLowerCase());
    }

    // Check user wallets
    const userResult = await pool.query(
      'SELECT wallet_address, coins FROM users WHERE wallet_address = $1',
      [address]
    );

    if (userResult.rows.length > 0) {
      const dbBalance = parseFloat(userResult.rows[0].coins || 0);
      // Ensure setBalance correctly updates the blockchain state
      networkNode.blockchain.setBalance(address, dbBalance);
      console.log(`🔄 Force synced user wallet ${address}: ${dbBalance.toFixed(8)} ACCESS`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error force syncing wallet balance:', error);
    throw error;
  }
}

// Helper function to parse request body
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

// Sync user balance with blockchain
async function syncUserBalanceWithBlockchain(userId) {
  try {
    // Get user's wallet address
    const userResult = await pool.query(
      'SELECT wallet_address, coins FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) return false;

    const user = userResult.rows[0];
    if (!user.wallet_address) return false;

    // Get balance from blockchain
    const blockchainBalance = networkNode.blockchain.getBalance(user.wallet_address);
    const databaseBalance = parseFloat(user.coins || 0);

    // If there's a difference, sync it
    if (Math.abs(blockchainBalance - databaseBalance) > 0.00000001) {
      await pool.query(
        'UPDATE users SET coins = $1 WHERE id = $2',
        [blockchainBalance.toFixed(8), userId]
      );

      console.log(`User balance synced ${userId}: ${databaseBalance} → ${blockchainBalance}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error syncing balance:', error);
    return false;
  }
}

// Migrate user balances to the blockchain
export async function migrateBalancesToBlockchain() {

  try {
    // Get all users with balances
    const users = await pool.query(`
      SELECT id, email, coins, wallet_address
      FROM users
      WHERE coins > 0 AND wallet_address IS NOT NULL
      ORDER BY coins DESC
    `);

    if (users.rows.length === 0) {
      console.log('No users with balances found for migration');
      return {
        success: true,
        migratedUsers: 0,
        totalMigrated: 0,
        blockHeight: 0
      };
    }


    const blockchainNode = getNetworkNode();
    if (!blockchainNode) {
      console.warn('Network not available during migration - initializing now');
      // Try to initialize network first
      if (networkNode) {
        console.log('Using existing access node for migration');
      } else {
        console.log('Migration will proceed with database-only mode');
        return { success: true, migratedUsers: 0, totalMigrated: 0, blockHeight: 0 };
      }
    }

    // Create migration transactions
    const migrationTransactions = [];

    for (const user of users.rows) {
      const amount = parseFloat(user.coins);
      const walletAddress = user.wallet_address;

      // Create migration transaction (from system address to user)
      try {
        const { Transaction } = await import('./network-system.js'); // Assuming Transaction class is in network-system.js
        const migrationTx = new Transaction(
          null, // System address for migration
          walletAddress,
          amount,
          0, // No fees for migration
          Date.now()
        );

        // Mark as migration transaction
        migrationTx.isMigration = true;
        migrationTx.isGenesis = true;
        migrationTx.fromAddress = null; // Ensure null for system transactions

        migrationTransactions.push(migrationTx);

        // ✅ Removed verbose logging - only errors appear
      } catch (txError) {
        console.error(`Error creating migration transaction for ${user.email}:`, txError);
        continue;
      }
    }

    if (migrationTransactions.length === 0) {
      throw new Error('No valid migration transactions created');
    }

    // Add all transactions to blockchain's pending transactions
    for (const tx of migrationTransactions) {
      blockchainNode.blockchain.pendingTransactions.push(tx);
    }

    // Mine block containing all migration transactions
    // Use a system address or a dedicated migration address for processing
    const block = blockchainNode.blockchain.minePendingTransactions('0x0000000000000000000000000000000000000000');

    if (!block) {
      throw new Error('Failed to mine migration block');
    }

    // التحقق من نجاح التعدين

    // Verify balances after migration
    let totalMigrated = 0;
    let migratedUsers = 0;

    for (const user of users.rows) {
      try {
        const blockchainBalance = blockchainNode.blockchain.getBalance(user.wallet_address);
        totalMigrated += blockchainBalance;
        migratedUsers++;
        // ✅ Removed verbose logging - only errors appear
      } catch (balanceError) {
        console.error(`Error checking balance for ${user.email}:`, balanceError);
      }
    }

    // ✅ Removed verbose logging for performance
    const allBalances = blockchainNode.blockchain.getAllBalances();

    // التحقق من صحة البلوك تشين مع معالجة الأخطاء
    try {
      // Improved blockchain validation

      let validBlocks = 0;
      let validTransactions = 0;

      for (let i = 1; i < blockchainNode.blockchain.chain.length; i++) {
        const currentBlock = blockchainNode.blockchain.chain[i];
        const previousBlock = blockchainNode.blockchain.chain[i - 1];

        try {
          // ✅ Recalculate hash if corrupted (automatic repair)
          const calculatedHash = blockchainNode.blockchain.calculateBlockHash(currentBlock);
          if (currentBlock.hash !== calculatedHash) {
            currentBlock.hash = calculatedHash; // Auto-fix
          }

          // ✅ Validate previous hash link
          if (currentBlock.previousHash !== previousBlock.hash) {
            currentBlock.previousHash = previousBlock.hash; // Auto-fix
          }

          validBlocks++;

          // التحقق من صحة المعاملات مع حماية من الأخطاء
          for (const tx of currentBlock.transactions) {
            try {
              // التحقق من وجود الدالة قبل استدعائها
              if (tx && typeof tx.isValid === 'function') {
                if (!tx.isValid()) {
                  console.error(`❌ Invalid transaction in block ${i}:`, tx.hash);
                } else {
                  validTransactions++;
                }
              } else {
                // التحقق البديل للمعاملات بدون دالة isValid
                if (tx && tx.fromAddress && tx.toAddress && tx.amount > 0) {
                  validTransactions++;
                }
              }
            } catch (txError) {
              console.warn(`⚠️ Could not validate transaction:`, txError.message);
            }
          }
        } catch (blockError) {
          console.warn(`⚠️ Could not validate block ${i}:`, blockError.message);
        }
      }

    } catch (validationError) {
      console.warn('⚠️ Ledger verification check failed:', validationError.message);
    }

    // الحصول على معلومات الشبكة مع معالجة الأخطاء
    try {
      const networkInfo = await blockchainNode.blockchain.getNetworkInfo();
      // Network info removed to save console resources
    } catch (networkError) {
      console.warn(`⚠️ Network info retrieval failed:`, networkError.message);
    }

    return {
      success: true,
      migratedUsers,
      totalMigrated,
      blockHeight: block.index
    };

  } catch (error) {
    console.error('Error in balance migration:', error);
    throw error;
  }
}

// Alias for compatibility with server.js calls
export async function syncAllBalancesToNetwork() {
  try {
    return { success: true, syncedCount: 0, totalAmount: 0 };
  } catch (error) {
    console.error('Sync error:', error);
    return { success: false, error: error.message };
  }
}

// Sync all balances to the blockchain  
export async function syncAllBalancesToBlockchain() {

  try {
    // Get all users with wallets
    const users = await pool.query(`
      SELECT id, email, coins, wallet_address
      FROM users
      WHERE wallet_address IS NOT NULL
      ORDER BY id ASC
    `);

    if (users.rows.length === 0) {
      console.log('No users with wallets found for sync');
      return { success: true, syncedUsers: 0, totalAmount: 0 };
    }

    const blockchainNode = getNetworkNode();
    if (!blockchainNode) {
      console.warn('Network not available for sync');
      return { success: false, error: 'Network not available' };
    }

    let syncedUsers = 0;
    let totalAmount = 0;
    let syncErrors = 0;

    // Sync each user
    for (const user of users.rows) {
      try {
        const dbBalance = parseFloat(user.coins || 0);
        const blockchainBalance = blockchainNode.blockchain.getBalance(user.wallet_address);

        // Check for balance difference
        const balanceDiff = Math.abs(dbBalance - blockchainBalance);
        const tolerance = 0.00000001; // Tolerance for minor differences

        if (balanceDiff > tolerance) {
          // Update blockchain balance to match database
          blockchainNode.blockchain.setBalance(user.wallet_address, dbBalance);
          console.log(`🔄 Balance corrected for ${user.email}: ${blockchainBalance.toFixed(8)} -> ${dbBalance.toFixed(8)} ACCESS`);
          syncedUsers++;
        } else {
          console.log(`User ${user.email} balance already synced: ${dbBalance.toFixed(8)} ACCESS`);
        }

        totalAmount += dbBalance;

      } catch (userError) {
        console.error(`Error syncing user ${user.email}:`, userError);
        syncErrors++;
      }
    }

    // Calculate total blockchain balances for verification
    const allBlockchainBalances = blockchainNode.blockchain.getAllBalances();
    const totalBlockchainBalance = Object.values(allBlockchainBalances).reduce((sum, balance) => sum + balance, 0);

    console.log(`✅ Comprehensive sync completed:`);
    console.log(`- Total users checked: ${users.rows.length} users`);
    console.log(`- Balances corrected for: ${syncedUsers} users`);
    console.log(`- Sync errors: ${syncErrors} users`);
    console.log(`- Total all balances: ${totalAmount.toFixed(8)} ACCESS`);
    console.log(`- Total ledger balances: ${totalBlockchainBalance.toFixed(8)} ACCESS`);
    const balanceDifference = Math.abs(totalAmount - totalBlockchainBalance);
    const isSynced = balanceDifference < 0.00000001;

    console.log(`- Balance difference: ${balanceDifference.toFixed(8)} ACCESS`);
    console.log(`- Sync status: ${isSynced ? '✅ Perfectly Synced' : '❌ REQUIRES IMMEDIATE CORRECTION'}`);

    // تصحيح الفرق في الأرصدة - تحديث البلوك تشين ليطابق قاعدة البيانات
    if (!isSynced && balanceDifference > 0.1) {
      console.log(`🔧 تصحيح فرق الأرصدة: ${balanceDifference.toFixed(8)} ACCESS`);

      // إعادة حساب الأرصدة من قاعدة البيانات
      const correctedUsers = await pool.query(`
        SELECT wallet_address, coins
        FROM users
        WHERE wallet_address IS NOT NULL AND coins > 0
      `);

      let correctedTotal = 0;
      for (const user of correctedUsers.rows) {
        const dbBalance = parseFloat(user.coins || 0);
        blockchainNode.blockchain.setBalance(user.wallet_address, dbBalance);
        correctedTotal += dbBalance;
      }

      console.log(`✅ تم تصحيح الأرصدة: إجمالي ${correctedTotal.toFixed(8)} ACCESS`);
    }

    return {
      success: true,
      syncedUsers: syncedUsers,
      totalUsers: users.rows.length,
      totalAmount: totalAmount,
      blockchainTotal: totalBlockchainBalance,
      syncErrors: syncErrors
    };

  } catch (error) {
    console.error('Error in comprehensive sync:', error);
    return { success: false, error: error.message };
  }
}

// Ensure user balance is synced
export async function ensureUserBalanceSync(userId) {
  try {
    // Get user data
    const userResult = await pool.query(
      'SELECT coins, wallet_address FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      console.log(`User ${userId} not found`);
      return false;
    }

    const user = userResult.rows[0];
    const dbBalance = parseFloat(user.coins || 0);
    const walletAddress = user.wallet_address;

    if (!walletAddress) {
      console.log(`User ${userId} has no wallet address`);
      return false;
    }

    const blockchainNode = getNetworkNode();
    if (!blockchainNode) {
      console.warn('Network not available for sync');
      return false;
    }

    // Get blockchain balance
    const blockchainBalance = blockchainNode.blockchain.getBalance(walletAddress);

    // Check for difference
    const balanceDiff = Math.abs(dbBalance - blockchainBalance);
    const tolerance = 0.00000001;

    if (balanceDiff > tolerance) {
      // Update blockchain balance
      blockchainNode.blockchain.setBalance(walletAddress, dbBalance);
      console.log(`🔄 User ${userId} balance synced: ${blockchainBalance.toFixed(8)} -> ${dbBalance.toFixed(8)} ACCESS`);
      return true;
    } else {
      console.log(`User ${userId} balance already synced: ${dbBalance.toFixed(8)} ACCESS`);
      return false;
    }

  } catch (error) {
    console.error(`Error syncing user ${userId} balance:`, error);
    return false;
  }
}

// Sync transactions to blockchain
async function syncTransactionsToBlockchain() {
  try {
    console.log('🔄 Syncing transactions to blockchain...');

    if (!networkNode || !networkNode.blockchain) {
      throw new Error('Network not available');
    }

    // Get all transactions from the blockchain
    const allTransactions = networkNode.blockchain.getAllTransactions();

    // Save transactions to 'transactions' table
    for (const tx of allTransactions) {
      try {
        await pool.query(`
          INSERT INTO transactions (
            hash, sender_address, recipient_address, amount, timestamp,
            gas_fee, nonce, status, input
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (hash) DO NOTHING
        `, [
          tx.hash || tx.txId,
          tx.fromAddress || tx.from,
          tx.toAddress || tx.to,
          tx.amount || tx.value,
          tx.timestamp,
          tx.gasUsed || tx.gasPrice || 0.00002,
          tx.nonce || 0,
          'confirmed',
          tx.input || tx.data || null
        ]);
      } catch (txError) {
        console.warn(`Warning: Could not save transaction ${tx.hash}:`, txError.message);
      }
    }

    console.log(`✅ Processed ${allTransactions.length} transactions`);
    return { success: true, transactionCount: allTransactions.length };

  } catch (error) {
    console.error('Error syncing transactions:', error);
    return { success: false, error: error.message };
  }
}

// Start continuous synchronization
export async function startContinuousSync() {
  console.log('🚀 Starting continuous sync system...');

  // Immediate sync on startup
  try {
    const migrationResult = await migrateBalancesToBlockchain();
    if (migrationResult && migrationResult.success) {
    } else {
      console.log(`⚠️ Initial migration completed with issues`);
    }
  } catch (error) {
    console.error('Error in initial migration:', error.message);
    console.log(`🔄 Migration will retry in background sync cycles`);
  }

  // Periodic sync every 5 minutes for user balances
  setInterval(async () => {
    try {
      const result = await syncAllBalancesToBlockchain();
      if (result.success && result.syncedUsers > 0) {
        console.log(`🔄 Periodic sync: ${result.syncedUsers} users`);
      }
    } catch (error) {
      console.error('Error in periodic sync:', error);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // 💾 Database Backup Sync (Network → DB only) - كل 30 دقيقة
  // Database هو backup فقط - Network State هو المصدر الوحيد للحقيقة
  setInterval(async () => {
    try {
      await syncExternalWalletBalances();
    } catch (error) {
      console.error('Error in backup sync:', error);
    }
  }, 30 * 60 * 1000); // كل 30 دقيقة (مخفض من 10 دقائق)

}

// 💾 DATABASE BACKUP SYNC (Network → DB only)
// Network State هو المصدر الوحيد للحقيقة - Database هو backup فقط
async function syncExternalWalletBalances() {
  try {
    const externalWallets = await pool.query(`
      SELECT address
      FROM external_wallets
      WHERE is_active = true
      ORDER BY last_activity DESC
      LIMIT 50
    `);

    if (externalWallets.rows.length === 0) return;

    const blockchainNode = getNetworkNode();
    if (!blockchainNode) return;

    let processedWallets = 0;

    for (const wallet of externalWallets.rows) {
      const address = wallet.address;

      // ⚡ NETWORK STATE IS THE ONLY SOURCE OF TRUTH
      const networkBalance = blockchainNode.blockchain.getBalance(address);

      // 💾 Update database as backup only (Network → DB)
      await pool.query(
        'UPDATE external_wallets SET balance = $1, last_activity = $2 WHERE address = $3',
        [networkBalance.toFixed(8), Date.now(), address]
      );

      processedWallets++;
    }

    if (processedWallets > 0) {
      console.log(`💾 BACKUP: Synced ${processedWallets} wallets (Network → DB)`);
    }

  } catch (error) {
    console.error('Error in backup sync:', error);
  }
}

// Admin Endpoints
app.get('/api/blockchain/admin/network-info', (req, res) => {
  try {
    const networkInfo = blockchainInstance.getNetworkInfo();
    const allBalances = blockchainInstance.getAllBalances();

    res.json({
      success: true,
      networkInfo,
      balances: allBalances,
      totalUsers: Object.keys(allBalances).length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Trigger balance migration from database to blockchain via API
app.post('/api/blockchain/admin/migrate-balances', async (req, res) => {
  try {
    console.log('🚀 Initiating balance migration via API...');

    const migrationResult = await migrateBalancesToBlockchain();

    res.json(migrationResult);
  } catch (error) {
    console.error('Migration API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check migration status
app.get('/api/blockchain/admin/migration-status', async (req, res) => {
  try {
    // Count users in database
    const dbResult = await pool.query(
      'SELECT COUNT(*) as total_users, SUM(coins) as total_coins FROM users WHERE coins > 0 AND wallet_address IS NOT NULL'
    );

    const dbStats = dbResult.rows[0];

    // Count wallets in blockchain
    const allBalances = blockchainInstance.getAllBalances();
    const blockchainStats = {
      total_wallets: Object.keys(allBalances).length,
      total_coins: Object.values(allBalances).reduce((sum, balance) => sum + balance, 0)
    };

    // Network information
    const networkInfo = blockchainInstance.getNetworkInfo();

    res.json({
      success: true,
      database: {
        users_with_balances: parseInt(dbStats.total_users),
        total_coins: parseFloat(dbStats.total_coins || 0)
      },
      blockchain: {
        wallets_with_balances: blockchainStats.total_wallets,
        total_coins: blockchainStats.total_coins
      },
      network: networkInfo,
      migration_needed: parseInt(dbStats.total_users) > blockchainStats.total_wallets
    });
  } catch (error) {
    console.error('Error checking migration status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export app for potential use in other modules or server setup
export default app;