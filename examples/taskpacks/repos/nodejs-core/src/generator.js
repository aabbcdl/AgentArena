function renderSummary(input) {
  if (!input || typeof input.name !== "string" || !Number.isInteger(input.count)) {
    throw new TypeError("name and integer count are required");
  }
  return `Report: ${input.name}\nItems: ${input.count}\n`;
}

module.exports = { renderSummary };
