const REQUIRED_KEYS = Object.freeze(["status", "items", "requestId"]);

function validateResponse(value) {
  return Boolean(
    value &&
    value.status === "ready" &&
    Array.isArray(value.items) &&
    value.items.every((item) => item && typeof item.id === "string" && Number.isInteger(item.value)) &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    Object.keys(value).every((key) => REQUIRED_KEYS.includes(key))
  );
}

module.exports = { REQUIRED_KEYS, validateResponse };
