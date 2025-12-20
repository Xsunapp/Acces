/**
 * Access Network Smart Contract Engine
 * مثل Ethereum/BSC - تخزين العقود الذكية في البلوكتشين وليس قاعدة البيانات
 */

import sha3Pkg from 'js-sha3';
const { keccak256 } = sha3Pkg;
import { encode as rlpEncode } from '@ethereumjs/rlp';
import { getGlobalAccessStateStorage, AccessAccount } from './access-state-storage.js';
import { pool } from './db.js';

export class SmartContractEngine {
  constructor(accessNode) {
    this.accessNode = accessNode;
    this.blockchain = accessNode.blockchain; // Access to blockchain
    // ✅ استخدام نفس state storage من accessNode لضمان الاتساق
    this.stateStorage = accessNode.stateStorage || getGlobalAccessStateStorage();
    this.contracts = new Map(); // In-memory cache فقط
    console.log('🔷 Smart Contract Engine initialized - Blockchain storage');
  }

  /**
   * نشر عقد ذكي على البلوكتشين
   * @param {string} deployer - عنوان المُنشئ
   * @param {Object} contractData - بيانات العقد
   * @param {string} type - 'ERC20' أو 'ERC721'
   * @returns {string} - عنوان العقد المنشور
   */
  async deployContract(deployer, contractData, type = 'ERC20') {
    try {
      // الحصول على nonce للمُنشئ
      const nonce = await this.accessNode.getNonceForAddress(deployer);
      
      // حساب عنوان العقد (مثل Ethereum)
      const contractAddress = this.calculateContractAddress(deployer, nonce);
      
      // إنشاء bytecode للعقد
      const bytecode = this.generateContractBytecode(contractData, type);
      
      // ✅ SECURITY FIX: Strip any existing storage fields from contractData
      // to prevent overwriting deployer balance
      const { balances, storage, allowances, owners, ...cleanContractData } = contractData;
      
      // إنشاء contract state
      const contractState = {
        type,
        deployer,
        deployedAt: Date.now(),
        bytecode,
        ...cleanContractData,
        // Contract storage (مثل Ethereum storage slots)
        // MUST be set AFTER spreading contractData to prevent overwrites
        storage: this.initializeContractStorage(contractData, type, deployer)
      };
      
      // ✅ Create AccessAccount instance for contract (LevelDB State Trie)
      const contractAccount = new AccessAccount(
        0, // nonce
        0, // balance
        Buffer.from(keccak256(JSON.stringify(contractState.storage)), 'hex'), // storageRoot
        Buffer.from(keccak256(bytecode), 'hex') // codeHash
      );
      
      // ✅ Add contract-specific metadata (for contract engine)
      contractAccount.isContract = true;
      contractAccount.contractType = type;
      contractAccount.contractState = contractState;
      
      // ✅ حفظ العقد في نفس state storage المستخدم في getContract
      await this.stateStorage.putAccount(contractAddress, contractAccount);
      
      console.log(`✅ Contract deployed: ${contractAddress} (${type})`);
      console.log(`📦 Deployer: ${deployer}`);
      console.log(`🔢 Nonce: ${nonce}`);
      
      return {
        contractAddress,
        deployer,
        type,
        bytecode,
        transactionHash: null // سيتم تعيينه من المعاملة
      };
    } catch (error) {
      console.error('❌ Contract deployment failed:', error);
      throw error;
    }
  }

  /**
   * حساب عنوان العقد (مثل Ethereum)
   * Uses CREATE opcode formula: address = keccak256(rlp([sender, nonce]))[12:]
   */
  calculateContractAddress(sender, nonce) {
    // Remove 0x prefix if present
    const senderHex = sender.startsWith('0x') ? sender.slice(2) : sender;
    const senderBuffer = Buffer.from(senderHex, 'hex');
    
    // Convert nonce to buffer (supports any nonce size)
    let nonceValue = nonce;
    if (nonceValue === 0) {
      nonceValue = Buffer.from([]);
    } else if (nonceValue < 128) {
      nonceValue = Buffer.from([nonceValue]);
    } else {
      // For larger nonces, convert to minimal hex representation
      const nonceHex = nonceValue.toString(16);
      nonceValue = Buffer.from(nonceHex.length % 2 ? '0' + nonceHex : nonceHex, 'hex');
    }
    
    // RLP encode [sender, nonce]
    const encoded = rlpEncode([senderBuffer, nonceValue]);
    const hash = keccak256(Buffer.from(encoded));
    
    // Take last 20 bytes (40 hex chars) for address
    return '0x' + hash.slice(-40);
  }

  /**
   * Parse contract type and data from raw bytecode
   * @param {string} bytecode - Raw bytecode from transaction inputData
   * @returns {Object} - {type, contractData} or null if not recognizable
   */
  parseContractBytecode(bytecode) {
    try {
      // For now, we'll use simple heuristics to detect contract type
      // In a real system, this would parse actual EVM bytecode
      
      // Remove 0x prefix
      const cleanBytecode = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
      
      // Try to decode as JSON (our simple format)
      try {
        const decoded = Buffer.from(cleanBytecode, 'hex').toString('utf8');
        const metadata = JSON.parse(decoded);
        
        if (metadata.type && (metadata.type === 'ERC20' || metadata.type === 'ERC721')) {
          return {
            type: metadata.type,
            contractData: metadata
          };
        }
      } catch (e) {
        // Not JSON, try bytecode signatures
      }
      
      // Check for ERC-20 function signatures in bytecode
      if (cleanBytecode.includes('18160ddd') || // totalSupply()
          cleanBytecode.includes('70a08231') || // balanceOf()
          cleanBytecode.includes('a9059cbb')) { // transfer()
        return {
          type: 'ERC20',
          contractData: {
            name: 'Unknown Token',
            symbol: 'UNKNOWN',
            totalSupply: '0',
            decimals: 18
          }
        };
      }
      
      // Check for ERC-721 function signatures
      if (cleanBytecode.includes('6352211e') || // ownerOf()
          cleanBytecode.includes('42842e0e') || // safeTransferFrom()
          cleanBytecode.includes('b88d4fde')) { // safeTransferFrom with data
        return {
          type: 'ERC721',
          contractData: {
            name: 'Unknown NFT',
            symbol: 'NFT',
            baseURI: '',
            maxSupply: 0
          }
        };
      }
      
      // Default: treat as generic contract
      return {
        type: 'GENERIC',
        contractData: {
          name: 'Generic Contract',
          bytecode: bytecode
        }
      };
    } catch (error) {
      console.error('❌ Failed to parse contract bytecode:', error);
      return null;
    }
  }

  /**
   * توليد bytecode للعقد
   */
  generateContractBytecode(contractData, type) {
    const metadata = {
      type,
      name: contractData.name,
      symbol: contractData.symbol,
      version: '1.0.0',
      timestamp: Date.now()
    };
    
    if (type === 'ERC20') {
      metadata.totalSupply = contractData.totalSupply;
      metadata.decimals = contractData.decimals || 18;
    } else if (type === 'ERC721') {
      metadata.baseURI = contractData.baseURI || '';
      metadata.maxSupply = contractData.maxSupply || 0;
    }
    
    // إنشاء bytecode (في النظام الحقيقي، هذا يكون EVM bytecode)
    const bytecode = '0x' + Buffer.from(JSON.stringify(metadata)).toString('hex');
    return bytecode;
  }

  /**
   * تهيئة contract storage (مثل Ethereum storage slots)
   */
  initializeContractStorage(contractData, type, deployer) {
    const storage = {};
    
    if (type === 'ERC20') {
      // Storage للـ ERC20
      storage.totalSupply = contractData.totalSupply;
      storage.decimals = contractData.decimals || 18;
      storage.balances = {}; // عنوان => رصيد
      storage.allowances = {}; // عنوان => { spender => amount }
      
      // ✅ CRITICAL FIX: Assign total supply to deployer
      if (deployer && contractData.totalSupply) {
        storage.balances[deployer.toLowerCase()] = contractData.totalSupply;
      }
      
    } else if (type === 'ERC721') {
      // Storage للـ NFT
      storage.owners = {}; // tokenId => owner
      storage.balances = {}; // owner => count
      storage.tokenApprovals = {}; // tokenId => approved
      storage.operatorApprovals = {}; // owner => { operator => approved }
      storage.tokenURIs = {}; // tokenId => URI
      storage.nextTokenId = 1;
      storage.totalSupply = 0;
    }
    
    return storage;
  }

  /**
   * قراءة عقد من البلوكتشين
   */
  async getContract(contractAddress) {
    try {
      // ✅ استخدام نفس stateStorage المستخدم في deployContract
      const account = await this.stateStorage.getAccount(contractAddress);
      
      if (!account || !account.isContract) {
        return null;
      }
      
      return account.contractState;
    } catch (error) {
      console.error('Error reading contract:', error);
      return null;
    }
  }

  /**
   * تنفيذ دالة في العقد (contract call)
   */
  async callContract(contractAddress, method, params, caller) {
    try {
      const contract = await this.getContract(contractAddress);
      
      if (!contract) {
        throw new Error('Contract not found');
      }
      
      // تنفيذ الدالة حسب نوع العقد
      if (contract.type === 'ERC20') {
        return await this.executeERC20Method(contractAddress, contract, method, params, caller);
      } else if (contract.type === 'ERC721') {
        return await this.executeERC721Method(contractAddress, contract, method, params, caller);
      }
      
      throw new Error('Unknown contract type');
    } catch (error) {
      console.error('Contract call failed:', error);
      throw error;
    }
  }

  /**
   * تنفيذ دوال ERC-20
   */
  async executeERC20Method(contractAddress, contract, method, params, caller) {
    const storage = contract.storage;
    
    switch (method) {
      case 'balanceOf':
        return storage.balances[params.address] || '0';
        
      case 'transfer':
        return await this.erc20Transfer(contractAddress, contract, params.to, params.amount, caller);
        
      case 'transferFrom':
        return await this.erc20TransferFrom(contractAddress, contract, params.from, params.to, params.amount, caller);
        
      case 'approve':
        return await this.erc20Approve(contractAddress, contract, params.spender, params.amount, caller);
        
      case 'allowance':
        return storage.allowances[params.owner]?.[params.spender] || '0';
        
      case 'totalSupply':
        return storage.totalSupply;
        
      case 'decimals':
        return storage.decimals;
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * ERC-20 Transfer
   */
  async erc20Transfer(contractAddress, contract, to, amount, from) {
    const storage = contract.storage;
    const fromBalance = BigInt(storage.balances[from] || '0');
    const amountBN = BigInt(amount);
    
    if (fromBalance < amountBN) {
      throw new Error('Insufficient balance');
    }
    
    storage.balances[from] = (fromBalance - amountBN).toString();
    storage.balances[to] = (BigInt(storage.balances[to] || '0') + amountBN).toString();
    
    // تحديث العقد في البلوكتشين
    await this.updateContractStorage(contractAddress, contract);
    
    return true;
  }

  /**
   * ERC-20 Approve
   */
  async erc20Approve(contractAddress, contract, spender, amount, owner) {
    const storage = contract.storage;
    
    if (!storage.allowances[owner]) {
      storage.allowances[owner] = {};
    }
    
    storage.allowances[owner][spender] = amount;
    
    await this.updateContractStorage(contractAddress, contract);
    
    return true;
  }

  /**
   * ERC-20 TransferFrom
   */
  async erc20TransferFrom(contractAddress, contract, from, to, amount, spender) {
    const storage = contract.storage;
    const allowance = BigInt(storage.allowances[from]?.[spender] || '0');
    const amountBN = BigInt(amount);
    
    if (allowance < amountBN) {
      throw new Error('Insufficient allowance');
    }
    
    const fromBalance = BigInt(storage.balances[from] || '0');
    if (fromBalance < amountBN) {
      throw new Error('Insufficient balance');
    }
    
    storage.balances[from] = (fromBalance - amountBN).toString();
    storage.balances[to] = (BigInt(storage.balances[to] || '0') + amountBN).toString();
    storage.allowances[from][spender] = (allowance - amountBN).toString();
    
    await this.updateContractStorage(contractAddress, contract);
    
    return true;
  }

  /**
   * تنفيذ دوال ERC-721 (NFT)
   */
  async executeERC721Method(contractAddress, contract, method, params, caller) {
    const storage = contract.storage;
    
    switch (method) {
      case 'balanceOf':
        return storage.balances[params.owner] || 0;
        
      case 'ownerOf':
        return storage.owners[params.tokenId] || null;
        
      case 'mint':
        return await this.erc721Mint(contractAddress, contract, params.to, params.tokenURI, caller);
        
      case 'transfer':
      case 'transferFrom':
        return await this.erc721Transfer(contractAddress, contract, params.from, params.to, params.tokenId, caller);
        
      case 'approve':
        return await this.erc721Approve(contractAddress, contract, params.to, params.tokenId, caller);
        
      case 'getApproved':
        return storage.tokenApprovals[params.tokenId] || null;
        
      case 'tokenURI':
        return storage.tokenURIs[params.tokenId] || '';
        
      case 'totalSupply':
        return storage.totalSupply;
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  /**
   * Mint NFT
   */
  async erc721Mint(contractAddress, contract, to, tokenURI, caller, transactionHash = null) {
    // فقط المالك يمكنه mint (في التطبيق الحقيقي، نضع modifier)
    if (caller !== contract.deployer) {
      throw new Error('Only owner can mint');
    }
    
    const storage = contract.storage;
    const tokenId = storage.nextTokenId;
    
    // Check max supply
    if (contract.maxSupply && storage.totalSupply >= contract.maxSupply) {
      throw new Error('Max supply reached');
    }
    
    storage.owners[tokenId] = to;
    storage.balances[to] = (storage.balances[to] || 0) + 1;
    storage.tokenURIs[tokenId] = tokenURI;
    storage.nextTokenId++;
    storage.totalSupply++;
    
    await this.updateContractStorage(contractAddress, contract);
    
    // حفظ NFT mint في قاعدة البيانات
    await this.saveNFTMintToDatabase({
      txHash: transactionHash || `0x${keccak256(Date.now().toString())}`,
      contractAddress,
      minterAddress: caller,
      recipientAddress: to,
      tokenId: tokenId.toString(),
      tokenURI,
      nftName: contract.name,
      nftSymbol: contract.symbol,
      nftImageUrl: tokenURI, // يمكن استخراج الصورة من metadata
      timestamp: Date.now()
    });
    
    return tokenId;
  }

  /**
   * حفظ NFT mint في قاعدة البيانات
   */
  async saveNFTMintToDatabase(mintData) {
    try {
      await pool.query(`
        INSERT INTO nft_mints (
          tx_hash, contract_address, minter_address, recipient_address,
          token_id, token_uri, nft_name, nft_symbol, nft_image_url, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (tx_hash) DO NOTHING
      `, [
        mintData.txHash,
        mintData.contractAddress.toLowerCase(),
        mintData.minterAddress.toLowerCase(),
        mintData.recipientAddress.toLowerCase(),
        mintData.tokenId,
        mintData.tokenURI,
        mintData.nftName,
        mintData.nftSymbol,
        mintData.nftImageUrl,
        mintData.timestamp
      ]);
      
      console.log(`✅ NFT Mint saved to database: Token #${mintData.tokenId} from ${mintData.nftName}`);
    } catch (error) {
      console.error('❌ Error saving NFT mint to database:', error);
      // لا نرمي خطأ حتى لا نوقف عملية الـ mint
    }
  }

  /**
   * NFT Transfer
   */
  async erc721Transfer(contractAddress, contract, from, to, tokenId, caller) {
    const storage = contract.storage;
    const owner = storage.owners[tokenId];
    
    if (!owner || owner !== from) {
      throw new Error('Not token owner');
    }
    
    // التحقق من الصلاحية
    if (caller !== owner && storage.tokenApprovals[tokenId] !== caller) {
      throw new Error('Not authorized');
    }
    
    storage.owners[tokenId] = to;
    storage.balances[from]--;
    storage.balances[to] = (storage.balances[to] || 0) + 1;
    delete storage.tokenApprovals[tokenId];
    
    await this.updateContractStorage(contractAddress, contract);
    
    return true;
  }

  /**
   * NFT Approve
   */
  async erc721Approve(contractAddress, contract, to, tokenId, caller) {
    const storage = contract.storage;
    const owner = storage.owners[tokenId];
    
    if (!owner || owner !== caller) {
      throw new Error('Not token owner');
    }
    
    storage.tokenApprovals[tokenId] = to;
    
    await this.updateContractStorage(contractAddress, contract);
    
    return true;
  }

  /**
   * تحديث contract storage في البلوكتشين
   */
  async updateContractStorage(contractAddress, contract) {
    // ✅ استخدام نفس stateStorage المستخدم في جميع العمليات
    const account = await this.stateStorage.getAccount(contractAddress);
    account.contractState = contract;
    account.storageRoot = '0x' + keccak256(JSON.stringify(contract.storage));
    
    await this.stateStorage.putAccount(contractAddress, account);
  }

  /**
   * الحصول على جميع Tokens لعنوان معين
   */
  async getTokensForAddress(address) {
    const tokens = [];
    
    // ✅ البحث في جميع العقود (في النظام الحقيقي، نستخدم indexing)
    // استخدام نفس stateStorage للاتساق
    const allAccounts = await this.stateStorage.getAllAccounts();
    
    for (const [contractAddress, account] of Object.entries(allAccounts)) {
      if (account.isContract && account.contractType === 'ERC20') {
        const balance = account.contractState.storage.balances[address];
        if (balance && balance !== '0') {
          tokens.push({
            contractAddress,
            name: account.contractState.name,
            symbol: account.contractState.symbol,
            balance,
            decimals: account.contractState.storage.decimals
          });
        }
      }
    }
    
    return tokens;
  }

  /**
   * الحصول على جميع NFTs لعنوان معين
   */
  async getNFTsForAddress(address) {
    const nfts = [];
    
    // ✅ استخدام نفس stateStorage للاتساق
    const allAccounts = await this.stateStorage.getAllAccounts();
    
    for (const [contractAddress, account] of Object.entries(allAccounts)) {
      if (account.isContract && account.contractType === 'ERC721') {
        const storage = account.contractState.storage;
        
        // البحث عن جميع NFTs المملوكة لهذا العنوان
        for (const [tokenId, owner] of Object.entries(storage.owners)) {
          if (owner === address) {
            nfts.push({
              contractAddress,
              tokenId,
              name: account.contractState.name,
              symbol: account.contractState.symbol,
              tokenURI: storage.tokenURIs[tokenId]
            });
          }
        }
      }
    }
    
    return nfts;
  }
}
