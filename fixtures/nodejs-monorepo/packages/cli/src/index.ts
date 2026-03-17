/**
 * CLI entry point - demonstrates getUserData usage
 * CLI 入口点 - 演示 getUserData 的使用
 */

import { getUserData, type UserData } from '@test-monorepo/core';
import { createLogger } from './logger.js';

const logger = createLogger('Main');

/**
 * Main CLI function that fetches user data
 * 获取用户数据的主 CLI 函数
 */
export async function main(userId: string): Promise<void> {
  logger.info('Starting user data fetch...');
  
  try {
    const userData = await getUserData(userId);
    if (userData) {
      logger.info('User data retrieved successfully');
      console.log(JSON.stringify(userData, null, 2));
    } else {
      logger.warn('No user data found');
    }
  } catch (error) {
    logger.error('Failed to fetch user data', error);
    process.exit(1);
  }
}

// CLI usage example:
// npx @test-monorepo/cli <userId>
if (process.argv[2]) {
  main(process.argv[2]);
}
