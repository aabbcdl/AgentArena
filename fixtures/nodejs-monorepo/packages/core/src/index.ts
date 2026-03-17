/**
 * User data service - provides user information
 * 用户数据服务 - 提供用户信息
 */

export interface UserData {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

/**
 * Fetches user data from the server
 * 从服务器获取用户数据
 * @param userId - The user identifier
 * @returns User data object
 */
export async function getUserData(userId: string): Promise<UserData | null> {
  // TODO: Implement actual API call
  // 待实现：实际的 API 调用
  console.log(`Fetching user data for: ${userId}`);
  
  return {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
    createdAt: new Date()
  };
}

/**
 * Validates user data before saving
 * 保存前验证用户数据
 */
export function validateUserData(data: Partial<UserData>): boolean {
  if (!data.id || !data.email) {
    return false;
  }
  return data.email.includes('@');
}

// Re-export for convenience
export { getUserData as fetchUser };
