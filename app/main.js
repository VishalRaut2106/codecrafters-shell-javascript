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

const backgroundJobs = [];
const shellVariables = Object.create(null);

// Store completion rules: map of command -> completer script path
const completionRules = {};

function isValidIdentifier(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function expandToken(token) {
  let result = "";

  for (let i = 0; i < token.length; i++) {
    const char = token[i];

    if (char !== "$") {
      result += char;
      continue;
    }

    if (token[i + 1] === "{") {
      const closeBraceIndex = token.indexOf("}", i + 2);
      if (closeBraceIndex === -1) {
        result += char;
        continue;
      }

      const variableName = token.slice(i + 2, closeBraceIndex);
      if (isValidIdentifier(variableName)) {
        result += shellVariables[variableName] || "";
        i = closeBraceIndex;
        continue;
      }

      result += token.slice(i, closeBraceIndex + 1);
      i = closeBraceIndex;
      continue;
    }

    let variableName = "";
    let j = i + 1;
    while (j < token.length && /[A-Za-z0-9_]/.test(token[j])) {
      variableName += token[j];
      j++;
    }

    if (variableName && /^[A-Za-z_]/.test(variableName)) {
      result += shellVariables[variableName] || "";
      i = j - 1;
      continue;
    }

    result += char;
  }

  return result;
}

function expandWords(words) {
  return words
    .map((word) => expandToken(word))
    .filter((word) => word !== "");
}

function getNextJobNumber() {
  let nextJobNumber = 1;
  while (backgroundJobs.some((job) => job.number === nextJobNumber)) {
    nextJobNumber++;
  }
  return nextJobNumber;
}

function getJobMarker(job, sortedJobs) {
  if (sortedJobs.length === 1) {
    return "+";
  }

  const latestJob = sortedJobs[sortedJobs.length - 1];
  if (job.number === latestJob.number) {
    return "+";
  }

  const previousJob = sortedJobs[sortedJobs.length - 2];
  if (previousJob && job.number === previousJob.number) {
    return "-";
  }

  return " ";
}

function formatJobLine(job, sortedJobs) {
  const marker = getJobMarker(job, sortedJobs);
  const status = job.status.padEnd(24);
  const command = job.status === "Running" ? `${job.command} &` : job.command;
  return `[${job.number}]${marker}  ${status}${command}`;
}

function removeCompletedJobs() {
  for (let i = backgroundJobs.length - 1; i >= 0; i--) {
    if (backgroundJobs[i].status === "Done") {
      backgroundJobs.splice(i, 1);
    }
  }
}

function renderBackgroundJobLines(includeRunning) {
  const sortedJobs = backgroundJobs.slice().sort((left, right) => left.number - right.number);
  const lines = [];

  for (const job of sortedJobs) {
    if (!includeRunning && job.status !== "Done") {
      continue;
    }

    lines.push(formatJobLine(job, sortedJobs));
  }

  return lines;
}

async function reapJobsBeforePrompt() {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    if (renderBackgroundJobLines(false).length > 0) {
      break;
    }
  }

  const doneLines = renderBackgroundJobLines(false);
  if (doneLines.length > 0) {
    process.stdout.write(`${doneLines.join("\n")}\n`);
    removeCompletedJobs();
  }
}

function printJobsAndReapCompleted() {
  const lines = renderBackgroundJobLines(true);
  if (lines.length > 0) {
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  removeCompletedJobs();
}

let lastTabLine = "";
let tabCount = 0;

// Create readline with a proper completer and history enabled
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  historySize: 1000, // Enable history with size limit
  completer: (line) => {
    const spaceIndex = line.indexOf(" ");
    const isArgCompletion = spaceIndex !== -1;

    let prefixToMatch;
    let getCandidates;
    let commandName = "";

    if (!isArgCompletion) {
      // First word: complete against available commands
      prefixToMatch = line;
      getCandidates = () => getAvailableCommands().filter(cmd => cmd.startsWith(prefixToMatch));
    } else {
      // Subsequent argument: check if command has a registered completer
      commandName = line.substring(0, spaceIndex);
      
      // If completer is registered for this command, use it
      if (commandName in completionRules) {
        const completerScript = completionRules[commandName];
        const lastSpaceIdx = line.lastIndexOf(" ");
        const currentWord = line.slice(lastSpaceIdx + 1);
        const previousWord = line.substring(0, lastSpaceIdx).split(" ").slice(-1)[0] || "";
        
        getCandidates = () => {
          try {
            const { spawnSync } = require("child_process");
            const env = Object.assign({}, process.env, {
              COMP_LINE: line,
              COMP_POINT: line.length.toString(),
            });
            
            const result = spawnSync(completerScript, [commandName, currentWord, previousWord], {
              encoding: "utf8",
              env: env,
            });
            
            if (result.error || result.status !== 0) {
              return [];
            }
            
            const output = result.stdout;
            if (!output) {
              return [];
            }
            
            const candidates = output.split("\n").filter(line => line.trim() !== "");
            return candidates.map(candidate => candidate + " ");
          } catch (err) {
            return [];
          }
        };
        
        prefixToMatch = line.slice(line.lastIndexOf(" ") + 1);
      } else {
        // Fallback to file/directory completion
        // Extract the last word (text after the last space)
        const lastSpaceIdx = line.lastIndexOf(" ");
        prefixToMatch = line.slice(lastSpaceIdx + 1);

        // Split prefix into directory part and filename part
        const nodePath = require("path");
        const lastSlashIdx = prefixToMatch.lastIndexOf("/");
        const dirPart = lastSlashIdx !== -1 ? prefixToMatch.slice(0, lastSlashIdx + 1) : "";
        const filePart = lastSlashIdx !== -1 ? prefixToMatch.slice(lastSlashIdx + 1) : prefixToMatch;
        const searchDir = dirPart
          ? nodePath.resolve(process.cwd(), dirPart)
          : process.cwd();

        getCandidates = () => {
          let entries;
          try {
            entries = fs.readdirSync(searchDir);
          } catch (_) {
            return [];
          }
          return entries
            .filter(e => e.startsWith(filePart))
            .map(e => {
              try {
                const stat = fs.statSync(nodePath.join(searchDir, e));
                return dirPart + e + (stat.isDirectory() ? "/" : " ");
              } catch (_) {
                return dirPart + e + " ";
              }
            });
        };
      }
    }

    const hits = getCandidates();

    if (hits.length === 0) {
      // No matches - ring bell
      process.stdout.write("\x07");
      tabCount = 0;
      lastTabLine = "";
      return [[], prefixToMatch];
    }

    if (hits.length === 1) {
      // Single match - return it (suffix already added: space or /)
      tabCount = 0;
      lastTabLine = "";
      if (!isArgCompletion) {
        return [[hits[0] + " "], prefixToMatch];
      }
      return [[hits[0]], prefixToMatch];
    }

    // Multiple matches - find common prefix (strip trailing suffix for comparison)
    const hitsRaw = hits.map(h => h.replace(/[ /]$/, ""));
    const commonPrefix = hitsRaw.reduce((prefix, cmd) => {
      let i = 0;
      while (i < prefix.length && i < cmd.length && prefix[i] === cmd[i]) i++;
      return prefix.substring(0, i);
    }, hitsRaw[0]);

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

    // Second tab - show completions (display without trailing space, keep / for dirs)
    const displayHits = hits.map(h => h.replace(/ $/, "")).sort();
    process.stdout.write("\n" + displayHits.join("  ") + "\n");
    tabCount = 0;
    // Redraw prompt + current line manually, then sync readline's cursor
    process.stdout.write("$ " + line);
    // Move readline's internal cursor to end of line so next keypress appends correctly
    rl.line = line;
    rl.cursor = line.length;

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
    // Mark all loaded entries as already "appended" so history -a only writes new ones
    lastAppendedIndex = commandHistory.length;
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
  const runInBackground = tokens[tokens.length - 1] === "&";
  if (runInBackground) {
    tokens.pop();
  }
  const groupedTokens = groupTokens(expandWords(tokens));

  let stdin = null;
  let childStdout = null;

  for (let i = 0; i < groupedTokens.length; i++) {
    if (i === groupedTokens.length - 1) {
      childStdout = await mainFn(groupedTokens[i], stdin, true, runInBackground, command);
      break;
    }

    childStdout = await mainFn(groupedTokens[i], stdin);
    stdin = childStdout;
  }

  await reapJobsBeforePrompt();
  rl.prompt();
});

async function mainFn(words, stdin, isFinalCommand = false, runInBackground = false, originalCommand = "") {
  const outStream = new PassThrough();
  if (isFinalCommand && !runInBackground) {
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
      // Save new history entries to HISTFILE before exiting
      if (process.env.HISTFILE) {
        try {
          const newEntries = commandHistory.slice(lastAppendedIndex);
          if (newEntries.length > 0) {
            fs.appendFileSync(process.env.HISTFILE, newEntries.join("\n") + "\n", "utf8");
          }
        } catch (_) {}
      }
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
    case "jobs":
      printJobsAndReapCompleted();
      break;
    case "complete":
      // complete -C <script> <command>: register a completer script for a command
      if (words[1] === "-C" && words[2] && words[3]) {
        const completerScript = words[2];
        const commandName = words[3];
        completionRules[commandName] = completerScript;
        break;
      }
      // complete -r <command>: remove completion rule for a command
      if (words[1] === "-r" && words[2]) {
        const commandName = words[2];
        delete completionRules[commandName];
        break;
      }
      // complete -p <command>: print completion rule for a command
      if (words[1] === "-p" && words[2]) {
        const commandName = words[2];
        if (commandName in completionRules) {
          logger.log(`complete -C '${completionRules[commandName]}' ${commandName}`, out);
        } else {
          logger.error(`complete: ${commandName}: no completion specification`, errorFd);
        }
        break;
      }
      break;
    case "declare": {
      if (words[1] === "-p" && words[2]) {
        const variableName = words[2];
        if (Object.prototype.hasOwnProperty.call(shellVariables, variableName)) {
          logger.log(`declare -- ${variableName}="${shellVariables[variableName]}"`, out);
        } else {
        }
          logger.error(`declare: ${variableName}: not found`, errorFd);
        break;
      }

      for (const argument of words.slice(1)) {
        const equalsIndex = argument.indexOf("=");
        if (equalsIndex === -1) {
          continue;
        }

        const variableName = argument.slice(0, equalsIndex);
        const variableValue = argument.slice(equalsIndex + 1);
        if (!isValidIdentifier(variableName)) {
          logger.error(`declare: \`${argument}\': not a valid identifier`, errorFd);
          continue;
        }

        shellVariables[variableName] = variableValue;
      }

      break;
    }
    default:
      const result = words[0] in EXTERNAL_COMMANDS;
      try {
        // Don't use shell mode - pass the executable name directly
        // The tokenizer should have properly parsed quoted strings
        const spawnOptions = {
          stdio: [
            "pipe",
            runInBackground ? "inherit" : "pipe",
            runInBackground ? "inherit" : "pipe",
          ],
          cwd: process.cwd(),
        };

        if (outputFd) {
          spawnOptions.stdio[1] = outputFd;
        }
        if (errorFd) {
          spawnOptions.stdio[2] = errorFd;
        }

        const childProcess = spawn(words[0], words.slice(1), spawnOptions);

        if (runInBackground) {
          const jobNumber = getNextJobNumber();
          const commandText = originalCommand.replace(/\s*&\s*$/, "").trimEnd();
          const backgroundJob = {
            number: jobNumber,
            pid: childProcess.pid,
            command: commandText,
            status: "Running",
          };

          backgroundJobs.push(backgroundJob);
          console.log(`[${jobNumber}] ${childProcess.pid}`);

          childProcess.once("exit", () => {
            backgroundJob.status = "Done";
          });
        }

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

        if (!runInBackground) {
          // Pipe stderr to parent's stderr unless redirected
          if (!errorFd) {
            childProcess.stderr.pipe(process.stderr);
          }
        }

        // For the final command, pipe stdout to parent stdout
        if (isFinalCommand && !runInBackground) {
          if (!outputFd) {
            childProcess.stdout.pipe(process.stdout);
          }
          await new Promise((resolve) => {
            childProcess.once("close", resolve);
            childProcess.once("error", resolve);
          });
          return outStream;
        }

        if (runInBackground) {
          return null;
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
