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

rl.on("line", async (command) => {
  commandHistory.push(`\t${commandHistory.length + 1} ${command}`);
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
        const result = words[1] in EXTERNAL_COMMANDS;

        if (result) {
          logger.log(`${words[1]} is ${EXTERNAL_COMMANDS[words[1]]}`, out);
        } else {
          logger.error(`${words[1]}: not found`, errorFd);
        }
      }
      break;
    case "history":
      logger.log(commandHistory.slice(-words[1]).join("\n"), out);
      break;
    default:
      const result = words[0] in EXTERNAL_COMMANDS;
      try {
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
          await new Promise((resolve, reject) => {
            childProcess.once("close", () => {
              resolve();
            });
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
