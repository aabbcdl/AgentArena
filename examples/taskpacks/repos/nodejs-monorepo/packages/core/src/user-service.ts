export interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * getUserData fetches user information from the data store.
 * @param userId - The unique identifier for the user
 * @returns The user data object
 */
export async function getUserData(userId: string): Promise<UserData> {
  // Simulate fetching getUserData from a database
  const userData: UserData = {
    id: userId,
    name: `User ${userId}`,
    email: `user-${userId}@example.com`,
    role: "member",
  };
  return userData;
}

/**
 * Validates that getUserData returns a well-formed object.
 */
export function validateUserData(data: UserData): boolean {
  return !!(data.id && data.name && data.email);
}
