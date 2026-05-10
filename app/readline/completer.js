const fs = require("fs");
const path = require("path");
const { KNOWN_COMMANDS } = require("../functions/type");

let cachedCommands = null;
let lastPathEnv = null;

function getAvailableCommands() {
  const pathEnv = process.env.PATH;
  
  // Only refresh if PATH has changed or cache is empty
  if (cachedCommands && pathEnv === lastPathEnv) {
    return cachedCommands;
  }
  
  const commands = new Set(KNOWN_COMMANDS);
  lastPathEnv = pathEnv;
  
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
              commands.add(cmdName);
            }
          } else {
            commands.add(file);
          }
        }
      } catch (err) {
        // Ignore errors reading directories
      }
    }
  }
  
  cachedCommands = Array.from(commands).sort();
  return cachedCommands;
}

let lastTabLine = "";
let tabCount = 0;

const completer = (line) => {
  const availableCommands = getAvailableCommands();
  let hits = availableCommands.filter((cmd) => cmd.startsWith(line));
  
  if (hits.length === 0) {
    process.stdout.write("\x07"); // bell
    tabCount = 0;
    lastTabLine = "";
    return [[], line];
  }
  
  if (hits.length === 1) {
    // Single match - append space for completion
    tabCount = 0;
    lastTabLine = "";
    return [[hits[0] + " "], line];
  }
  
  // Multiple matches - need to handle double-tab behavior
  if (line === lastTabLine) {
    tabCount++;
  } else {
    lastTabLine = line;
    tabCount = 1;
  }
  
  if (tabCount === 1) {
    // First tab - just ring bell
    process.stdout.write("\x07");
    return [[], line];
  }
  
  // Second tab - show completions manually and redraw prompt
  process.stdout.write("\n" + hits.join("  ") + "\n");
  tabCount = 0;
  
  // Return empty array to prevent readline from displaying completions again
  return [[], line];
};

module.exports = { completer, getAvailableCommands };
