const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");

const BUILTIN_COMMANDS = ["exit", "echo", "type", "pwd", "cd", "history"];

function loggerWrite(message, out = process.stdout) {
  const text = `${message}\n`;
  if (typeof out === "number") {
    fs.writeSync(out, text);
  } else {
    out.write(text);
  }
}

const logger = {
  log: (message, out = process.stdout) => loggerWrite(message, out),
  error: (message, out = process.stderr) => loggerWrite(message, out),
};

function computeAbsolutePath(inputPath = "") {
  if (!inputPath || inputPath === "~") {
    return process.env.HOME || process.env.USERPROFILE || process.cwd();
  }

  if (inputPath.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
    return path.resolve(home, inputPath.slice(2));
  }

  return path.resolve(process.cwd(), inputPath);
}

function tokenizeCommand(command = "") {
  if (!command.trim()) {
    return [];
  }

  // Matches unquoted words, single-quoted strings, and double-quoted strings.
  const tokens = [];
  const regex = /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'|\S+/g;
  let match;

  while ((match = regex.exec(command)) !== null) {
    const raw = match[0];
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      tokens.push(raw.slice(1, -1));
    } else {
      tokens.push(raw);
    }
  }

  return tokens;
}

function groupTokens(tokens = []) {
  if (!tokens.length) {
    return [[]];
  }

  const groups = [[]];
  for (const token of tokens) {
    if (token === "|") {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1].push(token);
  }

  return groups;
}

function getExternalCommands() {
  const envPath = process.env.PATH || "";
  const commandMap = {};

  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        commandMap[entry.name] = path.join(dir, entry.name);
      }
    } catch (_err) {
      // Ignore unreadable PATH entries.
    }
  }

  return commandMap;
}

function resolveExternalCommand(command) {
  const externalCommands = getExternalCommands();
  if (command in externalCommands) {
    return externalCommands[command];
  }

  return null;
}

function completer(line) {
  const externalCommands = getExternalCommands();
  const completions = [...BUILTIN_COMMANDS, ...Object.keys(externalCommands)];
  const hits = [...new Set(completions)]
    .filter((completion) => completion.startsWith(line))
    .sort()
    .map((hit) => hit + " ");

  if (hits.length === 0) {
    process.stdout.write("\x07");
    return [[], line];
  }

  if (hits.length > 1) {
    let commonPrefix = hits[0];
    for (let i = 1; i < hits.length; i++) {
      while (hits[i].indexOf(commonPrefix) !== 0) {
        commonPrefix = commonPrefix.slice(0, -1);
      }
    }
    if (commonPrefix.trim() === line) {
      process.stdout.write("\x07");
    }
  }

  return [hits, line];
}

const commandHistory = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: completer,
  terminal: true,
});

rl.prompt();

rl.on("line", async (command) => {
  commandHistory.push(command);
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
        const resolvedCommand = resolveExternalCommand(words[1]);

        if (resolvedCommand) {
          logger.log(`${words[1]} is ${resolvedCommand}`, out);
        } else {
          logger.error(`${words[1]}: not found`, errorFd);
        }
      }
      break;
    case "history":
      const count = words[1] ? parseInt(words[1], 10) : commandHistory.length;
      const sliceStart = Math.max(0, commandHistory.length - count);
      const historyToShow = commandHistory.slice(sliceStart);
      const formattedHistory = historyToShow
        .map((cmd, index) => {
          const actualIndex = sliceStart + index + 1;
          return `${actualIndex.toString().padStart(5, " ")}  ${cmd}`;
        })
        .join("\n");

      if (formattedHistory) {
        logger.log(formattedHistory, out);
      }
      break;
    default:
      try {
        const spawnOptions = {
          stdio: ["pipe", isFinalCommand ? "inherit" : "pipe", "inherit"],
          cwd: process.cwd(),
          env: process.env,
        };

        if (outputFd) {
          spawnOptions.stdio[1] = outputFd;
        }
        if (errorFd) {
          spawnOptions.stdio[2] = errorFd;
        }

        const childProcess = spawn(words[0], words.slice(1), spawnOptions);
        let spawnFailed = false;

        childProcess.once("error", (err) => {
          if (err && err.code === "ENOENT") {
            logger.error(`${words.join(" ")}: command not found`, errorFd);
            spawnFailed = true;
          }
        });

        // preventing pipeing during first iteration since it causes all sorts of edge cases
        if (stdin && childProcess.stdin) {
          stdin.pipe(childProcess.stdin);
        }

        if (outputFd) {
          fs.closeSync(spawnOptions.stdio[1]);
        }
        if (errorFd) {
          fs.closeSync(spawnOptions.stdio[2]);
        }

        if (isFinalCommand) {
          await new Promise((resolve) => {
            childProcess.once("close", () => {
              resolve();
            });
          });
        }

        if (spawnFailed) {
          outStream.end();
          return outStream;
        }

        return childProcess.stdout || outStream;
      } catch (_error) {
        logger.error(`${words.join(" ")}: command not found`, errorFd);
      }
      break;
  }

  outStream.end();
  return outStream;
}