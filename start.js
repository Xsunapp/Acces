// Entry point wrapper for the Access Rewards application
// This script is in the root directory and delegates to the actual start.js in the Acces directory

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import and execute the actual start script from the Acces subdirectory
const actualStartPath = join(__dirname, 'Acces', 'start.js');

console.log('Starting Access Rewards application...');
console.log(`Loading main entry point from: ${actualStartPath}`);

// Dynamic import to execute the actual start.js
import(actualStartPath).catch(error => {
  console.error('Failed to start the application:', error);
  process.exit(1);
});
