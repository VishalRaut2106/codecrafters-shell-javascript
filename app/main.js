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
  if (!command.trim()) return [];

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
  if (!tokens.length) return [[]];

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
    } catch {}
  }

  return commandMap;
}

function resolveExternalCommand(command) {
  const externalCommands = getExternalCommands();
  return externalCommands[command] || null;
}

// ✅ FIXED COMPLETER
function completer(line) {
  const externalCommands = getExternalCommands();
  const completions = [...BUILTIN_COMMANDS, ...Object.keys(externalCommands)];

  const hits = [...new Set(completions)]
    .filter((c) => c.startsWith(line))
    .sort();

  if (hits.length === 0) {
    process.stdout.write("\x07");
    return [[], line];
  }

  // ✅ single match → add space
  if (hits.length === 1) {
    return [[hits[0] + " "], line];
  }

  // ✅ multiple → common prefix
  let commonPrefix = hits[0];
  for (let i = 1; i < hits.length; i++) {
    while (!hits[i].startsWith(commonPrefix)) {
      commonPrefix = commonPrefix.slice(0, -1);
    }
  }

  if (commonPrefix === line) {
    process.stdout.write("\x07");
  }

  return [hits, line];
}

const commandHistory = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer,
  terminal: true,
});

rl.prompt();

rl.on("line", async (command) => {
  commandHistory.push(command);

  const tokens = tokenizeCommand(command);
  const groupedTokens = groupTokens(tokens);

  let stdin = null;

  for (let i = 0; i < groupedTokens.length; i++) {
    const isFinal = i === groupedTokens.length - 1;
    const result = await mainFn(groupedTokens[i], stdin, isFinal);
    stdin = result;
  }

  rl.prompt();
});

async function mainFn(words, stdin, isFinalCommand = false) {
  const outStream = new PassThrough();
  if (isFinalCommand) outStream.pipe(process.stdout);

  let outputFd = 0;
  const outputIdx = words.findIndex((w) =>
    [">", "1>", ">>", "1>>"].includes(w)
  );

  if (outputIdx > -1) {
    const file = computeAbsolutePath(words[outputIdx + 1]);
    outputFd =
      words[outputIdx].includes(">>")
        ? fs.openSync(file, "a")
        : fs.openSync(file, "w");

    words = words.slice(0, outputIdx);
  }

  const out = outputFd || outStream;

  let errorFd = 0;
  const errorIdx = words.findIndex((w) => ["2>", "2>>"].includes(w));

  if (errorIdx > -1) {
    const file = computeAbsolutePath(words[errorIdx + 1]);
    errorFd =
      words[errorIdx] === "2>>"
        ? fs.openSync(file, "a")
        : fs.openSync(file, "w");

    words = words.slice(0, errorIdx);
  }

  switch (words[0]) {
    case "exit":
      process.exit();

    case "pwd":
      logger.log(process.cwd(), out);
      break;

    case "cd":
      const p = computeAbsolutePath(words[1]);
      if (fs.existsSync(p)) process.chdir(p);
      else logger.error(`cd: ${words[1]}: No such file or directory`, errorFd);
      break;

    case "echo":
      logger.log(words.slice(1).join(" "), out);
      break;

    case "type":
      if (BUILTIN_COMMANDS.includes(words[1])) {
        logger.log(`${words[1]} is a shell builtin`, out);
      } else {
        const cmd = resolveExternalCommand(words[1]);
        cmd
          ? logger.log(`${words[1]} is ${cmd}`, out)
          : logger.error(`${words[1]}: not found`, errorFd);
      }
      break;

    case "history":
      const count = words[1]
        ? parseInt(words[1], 10)
        : commandHistory.length;

      const start = Math.max(0, commandHistory.length - count);
      const history = commandHistory
        .slice(start)
        .map((cmd, i) => `${(start + i + 1).toString().padStart(5)}  ${cmd}`)
        .join("\n");

      if (history) logger.log(history, out);
      break;

    default:
      try {
        const child = spawn(words[0], words.slice(1), {
          stdio: ["pipe", isFinalCommand ? "inherit" : "pipe", "inherit"],
          cwd: process.cwd(),
          env: process.env,
        });

        child.on("error", () =>
          logger.error(`${words.join(" ")}: command not found`, errorFd)
        );

        if (stdin && child.stdin) stdin.pipe(child.stdin);

        if (isFinalCommand) {
          await new Promise((res) => child.on("close", res));
        }

        return child.stdout || outStream;
      } catch {
        logger.error(`${words.join(" ")}: command not found`, errorFd);
      }
  }

  outStream.end();
  return outStream;
}