const readline = require("readline");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  computeAbsolutePath,
  tokenizeCommand,
  groupTokens,
} = require("./utility");
const { BUILTIN_COMMANDS, EXTERNAL_COMMANDS } = require("./constants");
const logger = require("./logger");
const { PassThrough } = require("stream");
const { KNOWN_COMMANDS } = require("./functions/type");

let cachedCommands = null;
let lastPathEnv = null;

function findInPath(cmd) {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;
  const dirs = pathEnv.split(process.platform === "win32" ? ";" : ":");
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === cmd) {
          const fullPath = require("path").join(dir, file);
          try {
            fs.accessSync(fullPath, fs.constants.X_OK);
            return fullPath;
          } catch (_) {
            // not executable, keep searching
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

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

const commandHistory = [];
let lastAppendedIndex = 0; // tracks how many entries have been appended to file via history -a

let lastTabLine = "";
let tabCount = 0;

// Create readline with a proper completer and history enabled
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  historySize: 1000, // Enable history with size limit
  completer: (line) => {
    // Extract the prefix to match (just the command part, not the whole line)
    const prefixToMatch = line;
    const availableCommands = getAvailableCommands();
    const hits = availableCommands.filter((cmd) => cmd.startsWith(prefixToMatch));
    
    if (hits.length === 0) {
      // No matches - ring bell
      process.stdout.write("\x07");
      tabCount = 0;
      lastTabLine = "";
      return [[], prefixToMatch];
    }
    
    if (hits.length === 1) {
      // Single match - return it with space
      tabCount = 0;
      lastTabLine = "";
      return [[hits[0] + " "], prefixToMatch];
    }
    
    // Multiple matches - find common prefix
    const commonPrefix = hits.reduce((prefix, cmd) => {
      let i = 0;
      while (i < prefix.length && i < cmd.length && prefix[i] === cmd[i]) {
        i++;
      }
      return prefix.substring(0, i);
    }, hits[0]);
    
    // If common prefix is longer than what user typed, complete to it
    if (commonPrefix.length > prefixToMatch.length) {
      tabCount = 0;
      lastTabLine = "";
      return [[commonPrefix], prefixToMatch];
    }
    
    // Common prefix same as input - handle double-tab to show list
    if (line === lastTabLine) {
      tabCount++;
    } else {
      lastTabLine = line;
      tabCount = 1;
    }
    
    if (tabCount === 1) {
      // First tab - ring bell (no more to complete)
      process.stdout.write("\x07");
      return [[], prefixToMatch];
    }
    
    // Second tab - show completions
    const lineToRestore = line;
    process.stdout.write("\n" + hits.join("  ") + "\n");
    // Write the prompt and line content
    rl.prompt();
    process.stdout.write(lineToRestore);
    tabCount = 0;
    
    return [[], prefixToMatch];
  },
  terminal: true,
});

rl.prompt();

// Load history from HISTFILE on startup
if (process.env.HISTFILE) {
  try {
    const content = require("fs").readFileSync(process.env.HISTFILE, "utf8");
    const lines = content.split("\n").filter(line => line.trim() !== "");
    for (const line of lines) {
      commandHistory.push(line);
      rl.history = rl.history || [];
      rl.history.push(line); // push (not unshift) to keep oldest-first for up-arrow
    }
    // rl.history needs to be newest-first for readline navigation
    rl.history.reverse();
  } catch (_) {
    // HISTFILE doesn't exist yet, that's fine
  }
}

rl.on("line", async (command) => {
  commandHistory.push(command);
  // Manually add to readline's internal history for up-arrow recall
  // (needed when stdin is not a TTY, e.g. in test environments)
  if (command.trim()) {
    rl.history = rl.history || [];
    rl.history.unshift(command);
    if (rl.history.length > 1000) {
      rl.history.pop();
    }
  }
  const tokens = tokenizeCommand(command);
  const groupedTokens = groupTokens(tokens);

  let stdin = null;
  let childStdout = null;

  for (let i = 0; i < groupedTokens.length; i++) {
    if (i === groupedTokens.length - 1) {
      childStdout = await mainFn(groupedTokens[i], stdin, true);
      break;
    }

    childStdout = await mainFn(groupedTokens[i], stdin);
    stdin = childStdout;
  }

  rl.prompt();
});

async function mainFn(words, stdin, isFinalCommand = false) {
  const outStream = new PassThrough();
  if (isFinalCommand) {
    outStream.pipe(process.stdout);
  }

  let outputFd = 0;
  const outputIdx = words.findIndex(
    (word) => word === ">" || word === "1>" || word === ">>" || word === "1>>",
  );
  if (outputIdx > -1) {
    const outputFile = computeAbsolutePath(words[outputIdx + 1]);

    if (words[outputIdx] === ">" || words[outputIdx] === "1>") {
      outputFd = fs.openSync(outputFile, "w");
    } else {
      outputFd = fs.openSync(outputFile, "a");
    }

    words = words.slice(0, outputIdx);
  }

  const out = outputFd ? outputFd : outStream;

  let errorFd = 0;
  const errorIdx = words.findIndex((word) => word === "2>" || word === "2>>");
  if (errorIdx > -1) {
    const errorFile = computeAbsolutePath(words[errorIdx + 1]);

    if (words[errorIdx] === "2>") {
      errorFd = fs.openSync(errorFile, "w");
    } else {
      errorFd = fs.openSync(errorFile, "a");
    }

    words = words.slice(0, errorIdx);
  }

  switch (words[0]) {
    case "exit":
      process.exit();
    case "pwd":
      logger.log(process.cwd(), out);
      break;
    case "cd":
      const absolutePath = computeAbsolutePath(words[1]);

      if (fs.existsSync(absolutePath)) {
        process.chdir(absolutePath);
      } else {
        logger.error(`cd: ${words[1]}: No such file or directory`, errorFd);
      }

      break;
    case "echo":
      logger.log(words.slice(1).join(" "), out);
      break;
    case "type":
      if (BUILTIN_COMMANDS.includes(words[1])) {
        logger.log(`${words[1]} is a shell builtin`, out);
      } else {
        const typePath = findInPath(words[1]);
        if (typePath) {
          logger.log(`${words[1]} is ${typePath}`, out);
        } else {
          logger.error(`${words[1]}: not found`, errorFd);
        }
      }
      break;
    case "history": {
      // history -r <path> - read history from file and append to in-memory history
      if (words[1] === "-r" && words[2]) {
        const filePath = computeAbsolutePath(words[2]);
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const lines = content.split("\n").filter(line => line.trim() !== "");
          for (const line of lines) {
            commandHistory.push(line);
            rl.history = rl.history || [];
            rl.history.unshift(line);
          }
        } catch (err) {
          logger.error(`history: ${words[2]}: cannot read file`, errorFd);
        }
        break;
      }
      // history -w <path> - write in-memory history to file
      if (words[1] === "-w" && words[2]) {
        const filePath = computeAbsolutePath(words[2]);
        try {
          const content = commandHistory.join("\n") + "\n";
          fs.writeFileSync(filePath, content, "utf8");
        } catch (err) {
          logger.error(`history: ${words[2]}: cannot write file`, errorFd);
        }
        break;
      }
      // history -a <path> - append new commands (since last -a) to file
      if (words[1] === "-a" && words[2]) {
        const filePath = computeAbsolutePath(words[2]);
        try {
          const newEntries = commandHistory.slice(lastAppendedIndex);
          if (newEntries.length > 0) {
            fs.appendFileSync(filePath, newEntries.join("\n") + "\n", "utf8");
          }
          lastAppendedIndex = commandHistory.length;
        } catch (err) {
          logger.error(`history: ${words[2]}: cannot append to file`, errorFd);
        }
        break;
      }
      const n = words[1] ? parseInt(words[1], 10) : null;
      const entries = n ? commandHistory.slice(-n) : commandHistory;
      const startIndex = commandHistory.length - entries.length;
      const formatted = entries.map((cmd, i) => {
        const num = startIndex + i + 1;
        return `    ${num}  ${cmd}`;
      });
      logger.log(formatted.join("\n"), out);
      break;
    }
    default:
      const result = words[0] in EXTERNAL_COMMANDS;
      try {
        // Don't use shell mode - pass the executable name directly
        // The tokenizer should have properly parsed quoted strings
        const spawnOptions = {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: process.cwd(),
        };

        if (outputFd) {
          spawnOptions.stdio[1] = outputFd;
        }
        if (errorFd) {
          spawnOptions.stdio[2] = errorFd;
        }

        const childProcess = spawn(words[0], words.slice(1), spawnOptions);

        // Handle ENOENT - command not found (async error event)
        childProcess.on("error", (err) => {
          if (err.code === "ENOENT") {
            logger.error(`${words[0]}: command not found`, errorFd);
          }
          outStream.end();
        });

        // Pipe stdin if provided
        if (stdin) {
          stdin.pipe(childProcess.stdin);
        } else {
          // Close stdin if no input is being piped
          childProcess.stdin.end();
        }

        // Pipe stderr to parent's stderr unless redirected
        if (!errorFd) {
          childProcess.stderr.pipe(process.stderr);
        }

        // For the final command, pipe stdout to parent stdout
        if (isFinalCommand) {
          if (!outputFd) {
            childProcess.stdout.pipe(process.stdout);
          }
          await new Promise((resolve) => {
            childProcess.once("close", resolve);
            childProcess.once("error", resolve);
          });
          return outStream;
        }

        // For non-final commands, return the stdout stream
        return childProcess.stdout;
      } catch (error) {
        logger.error(`${words.join(" ")}: command not found`, errorFd);
        outStream.end();
        return outStream;
      }
  }

  outStream.end();
  return outStream;
}
