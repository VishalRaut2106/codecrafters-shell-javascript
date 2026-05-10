const fs = require("fs");

const BUILTIN_COMMANDS = ["exit", "pwd", "cd", "echo", "type", "history"];

// External commands - would be populated from system PATH
const EXTERNAL_COMMANDS = {};

// Populate EXTERNAL_COMMANDS from system PATH
const pathEnv = process.env.PATH;
if (pathEnv) {
  const paths = pathEnv.split(process.platform === "win32" ? ";" : ":");
  for (const dir of paths) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        // Add command without extension on Unix, with common extensions on Windows
        if (process.platform === "win32") {
          if (file.endsWith(".exe") || file.endsWith(".bat") || file.endsWith(".cmd")) {
            const cmdName = file.substring(0, file.lastIndexOf("."));
            EXTERNAL_COMMANDS[cmdName] = `${dir}/${file}`;
          }
        } else {
          EXTERNAL_COMMANDS[file] = `${dir}/${file}`;
        }
      }
    } catch (err) {
      // Ignore errors reading directories
    }
  }
}

module.exports = { BUILTIN_COMMANDS, EXTERNAL_COMMANDS };
