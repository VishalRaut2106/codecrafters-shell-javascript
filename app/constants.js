const fs = require("fs");

const BUILTIN_COMMANDS = ["exit", "pwd", "cd", "echo", "type", "history", "jobs", "complete", "declare"];

// External commands will be discovered dynamically
const EXTERNAL_COMMANDS = {};

module.exports = { BUILTIN_COMMANDS, EXTERNAL_COMMANDS };
