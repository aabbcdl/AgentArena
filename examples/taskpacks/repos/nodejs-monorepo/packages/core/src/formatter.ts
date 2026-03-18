import { getUserData, UserData } from "./user-service";

/**
 * Formats the output of getUserData for display.
 */
export function formatOutput(data: UserData): string {
  return `[${data.role}] ${data.name} <${data.email}>`;
}

/**
 * Fetches and formats user data in one call.
 * Uses getUserData internally.
 */
export async function getFormattedUser(userId: string): Promise<string> {
  const data = await getUserData(userId);
  return formatOutput(data);
}
