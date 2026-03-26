const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PassThrough } = require("stream");

const BUILTIN_COMMANDS = ["exit", "echo", "type", "pwd", "cd", "history"];

function loggerWrite(message, out = process.stdout) {
  const text = `${message}\n`;
  if (typeof out === "number") fs.writeSync(out, text);
  else out.write(text);
}

const logger = {
  log: (msg, out) => loggerWrite(msg, out),
  error: (msg, out = process.stderr) => loggerWrite(msg, out),
};

function computeAbsolutePath(p = "") {
  if (!p || p === "~") return process.env.HOME || process.cwd();
  if (p.startsWith("~/")) return path.resolve(process.env.HOME, p.slice(2));
  return path.resolve(process.cwd(), p);
}

function tokenizeCommand(cmd = "") {
  if (!cmd.trim()) return [];
  const tokens = [];
  const regex = /"([^"]*)"|'([^']*)'|\S+/g;
  let match;
  while ((match = regex.exec(cmd))) {
    tokens.push(match[1] || match[2] || match[0]);
  }
  return tokens;
}

function groupTokens(tokens = []) {
  const groups = [[]];
  for (const t of tokens) {
    if (t === "|") groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  return groups;
}

function getExternalCommands() {
  const envPath = process.env.PATH || "";
  const map = {};
  for (const dir of envPath.split(path.delimiter)) {
    try {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        map[file] = path.join(dir, file);
      }
    } catch {}
  }
  return map;
}

function resolveExternalCommand(cmd) {
  return getExternalCommands()[cmd] || null;
}

function completer(line) {
  const cmds = [...BUILTIN_COMMANDS, ...Object.keys(getExternalCommands())];
  const hits = [...new Set(cmds)].filter(c => c.startsWith(line)).sort();

  if (hits.length === 0) {
    process.stdout.write("\x07");
    return [[], line];
  }

  if (hits.length === 1) return [[hits[0] + " "], line];

  let prefix = hits[0];
  for (let i = 1; i < hits.length; i++) {
    while (!hits[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }

  if (prefix === line) {
    process.stdout.write("\x07");
    process.stdout.write(hits.join("  ") + "\n");
    process.stdout.write(`$ ${line}`);
  }

  return [hits, line];
}

const history = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer,
  terminal: true,
});

rl.prompt();

rl.on("line", async (input) => {
  history.push(input);

  const groups = groupTokens(tokenizeCommand(input));
  let stdin = null;

  for (let i = 0; i < groups.length; i++) {
    stdin = await runCommand(groups[i], stdin, i === groups.length - 1);
  }

  rl.prompt();
});

async function runCommand(words, stdin, isFinal) {
  const outStream = new PassThrough();
  if (isFinal) outStream.pipe(process.stdout);

  let stdoutFd = null;
  let stderrFd = null;

  // stdout redirect
  let i = words.findIndex(w => [">", ">>", "1>", "1>>"].includes(w));
  if (i !== -1) {
    const file = computeAbsolutePath(words[i + 1]);
    stdoutFd = words[i].includes(">>")
      ? fs.openSync(file, "a")
      : fs.openSync(file, "w");
    words.splice(i, 2);
  }

  // stderr redirect
  i = words.findIndex(w => ["2>", "2>>"].includes(w));
  if (i !== -1) {
    const file = computeAbsolutePath(words[i + 1]);
    stderrFd = words[i] === "2>>"
      ? fs.openSync(file, "a")
      : fs.openSync(file, "w");
    words.splice(i, 2);
  }

  const out = stdoutFd ?? outStream;
  const err = stderrFd ?? process.stderr;

  switch (words[0]) {
    case "exit":
      process.exit();

    case "pwd":
      logger.log(process.cwd(), out);
      break;

    case "cd":
      const p = computeAbsolutePath(words[1]);
      if (fs.existsSync(p)) process.chdir(p);
      else logger.error(`cd: ${words[1]}: No such file or directory`, err);
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
          : logger.error(`${words[1]}: not found`, err);
      }
      break;

    case "history":
      const count = words[1] ? parseInt(words[1], 10) : history.length;
      const start = Math.max(0, history.length - count);

      const output = history
        .slice(start)
        .map((c, i) => `${(start + i + 1).toString().padStart(5)}  ${c}`)
        .join("\n");

      if (output) logger.log(output, out);
      break;

    default:
      try {
        const child = spawn(words[0], words.slice(1), {
          stdio: [
            "pipe",
            stdoutFd !== null ? stdoutFd : (isFinal ? "inherit" : "pipe"),
            stderrFd !== null ? stderrFd : "inherit",
          ],
        });

        child.on("error", () => {
          logger.error(`${words.join(" ")}: command not found`, err);
        });

        if (stdin && child.stdin) stdin.pipe(child.stdin);

        if (isFinal) {
          await new Promise(res => child.on("close", res));
        }

        if (stdoutFd !== null) fs.closeSync(stdoutFd);
        if (stderrFd !== null) fs.closeSync(stderrFd);

        return child.stdout || outStream;

      } catch {
        logger.error(`${words.join(" ")}: command not found`, err);
      }
  }

  outStream.end();
  return outStream;
}