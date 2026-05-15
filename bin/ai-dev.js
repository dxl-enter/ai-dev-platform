#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

// 检查是否已构建
const distPath = path.join(__dirname, '..', 'dist', 'index.js');

if (fs.existsSync(distPath)) {
  require(distPath);
} else {
  // 开发模式，使用ts-node
  require('ts-node').register({
    project: path.join(__dirname, '..', 'tsconfig.json')
  });
  require(path.join(__dirname, '..', 'src', 'index.ts'));
}
