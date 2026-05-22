#!/usr/bin/env node

/**
 * Port Cleanup Script
 * Kills any process using port 3000 and optionally starts the server
 */

const { exec } = require('child_process');
const net = require('net');

const PORT = 3000;

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(true);
      else resolve(false);
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

async function killPort(port) {
  return new Promise((resolve, reject) => {
    exec(`lsof -i :${port} | grep LISTEN | awk '{print $2}' | xargs kill -9 2>/dev/null`, 
      (error, stdout, stderr) => {
        if (error && error.code !== 1) {
          reject(error);
        } else {
          resolve(true);
        }
      }
    );
  });
}

async function main() {
  console.log(`\n🔍 Checking port ${PORT}...\n`);

  const inUse = await isPortInUse(PORT);

  if (inUse) {
    console.log(`⚠️  Port ${PORT} is in use. Attempting to free it...\n`);
    try {
      await killPort(PORT);
      console.log(`✅ Port ${PORT} has been freed!\n`);
      
      // Wait a moment for the port to fully release
      await new Promise(r => setTimeout(r, 1000));
      
      // Check if user wants to start the server
      if (process.argv[2] === '--start') {
        console.log('🚀 Starting server...\n');
        exec('npm start', { stdio: 'inherit' });
      }
    } catch (err) {
      console.error(`❌ Error freeing port: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    console.log(`✅ Port ${PORT} is available!\n`);
  }
}

main().catch(console.error);
