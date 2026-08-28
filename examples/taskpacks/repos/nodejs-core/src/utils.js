const { slugify } = require("./slugify");

function capitalizeWords(value) {
  if (!value) return value;
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function reverse(value) {
  if (!value) return value;
  return value.split("").reverse().join("");
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

module.exports = { capitalizeWords, reverse, slugify, truncate };
