import { getUserData, validateUserData } from "./user-service";

describe("getUserData", () => {
  it("should return user data for a valid userId", async () => {
    const data = await getUserData("test-1");
    expect(data.id).toBe("test-1");
    expect(data.name).toBe("User test-1");
    expect(data.email).toBe("user-test-1@example.com");
  });

  it("should return valid user data", async () => {
    const data = await getUserData("test-2");
    expect(validateUserData(data)).toBe(true);
  });
});
