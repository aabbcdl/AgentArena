/**
 * Runner entry point - runs tasks with user data
 * Runner 入口点 - 使用用户数据运行任务
 */

import { getUserData, validateUserData, type UserData } from '@test-monorepo/core';
import { createLogger } from './logger.js';

const logger = createLogger('TaskRunner');

export interface TaskResult {
  success: boolean;
  data?: UserData;
  error?: string;
}

/**
 * Runs a task for a specific user
 * 为特定用户运行任务
 */
export async function runUserTask(userId: string): Promise<TaskResult> {
  logger.info(`Running task for user: ${userId}`);
  
  const userData = await getUserData(userId);
  
  if (!userData) {
    logger.warn('User not found');
    return { success: false, error: 'User not found' };
  }
  
  if (!validateUserData(userData)) {
    logger.error('Invalid user data');
    return { success: false, error: 'Invalid user data' };
  }
  
  logger.info('Task completed successfully');
  return { success: true, data: userData };
}

export { getUserData, validateUserData };
